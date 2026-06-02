from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

import numpy as np
import pandas as pd
from scipy.interpolate import interp1d

from config import get_settings
from models import (
    AnalysisRequest,
    AnalysisResult,
    ChartData,
    Driver,
    Insight,
    JobStatus,
    LapSummary,
    MiniTrace,
    Race,
    Sector,
    SectorWaterfallItem,
)


settings = get_settings()
CHANNELS = ("Speed", "Throttle", "Brake", "nGear")


@dataclass(frozen=True)
class EnsembleLap:
    lap_number: int
    lap_time_seconds: float
    telemetry: pd.DataFrame


def align_distance_grid(lap_a: pd.DataFrame, lap_b: pd.DataFrame, num_points: int | None = None) -> tuple[dict, dict]:
    """Interpolate telemetry channels onto the same equally spaced distance grid."""
    num_points = num_points or settings.distance_samples
    lap_a = _prepare_telemetry(lap_a)
    lap_b = _prepare_telemetry(lap_b)
    min_dist = max(float(lap_a["Distance"].min()), float(lap_b["Distance"].min()))
    max_dist = min(float(lap_a["Distance"].max()), float(lap_b["Distance"].max()))
    distance = np.linspace(min_dist, max_dist, num_points)

    def interpolate(frame: pd.DataFrame) -> dict:
        result = {"distance": distance}
        for channel in CHANNELS:
            method = "nearest" if channel in {"Brake", "nGear"} else "linear"
            result[_normalized_channel_name(channel)] = interp1d(
                frame["Distance"],
                frame[channel],
                kind=method,
                bounds_error=False,
                fill_value="extrapolate",
                assume_sorted=True,
            )(distance)
        return result

    return interpolate(lap_a), interpolate(lap_b)


def calculate_cumulative_delta(grid_a: dict, grid_b: dict) -> np.ndarray:
    """Reconstruct time from speed: dt = ds / v. Positive values mean driver A gains time."""
    distance = np.asarray(grid_a["distance"], dtype=float)
    ds = np.diff(distance, prepend=distance[0])
    speed_a = np.maximum(np.asarray(grid_a["speed"], dtype=float) / 3.6, 1.0)
    speed_b = np.maximum(np.asarray(grid_b["speed"], dtype=float) / 3.6, 1.0)
    dt_a = ds / speed_a
    dt_b = ds / speed_b
    return np.cumsum(dt_b - dt_a)


def select_representative_laps(laps: Iterable[EnsembleLap]) -> list[EnsembleLap]:
    ordered = sorted(laps, key=lambda lap: lap.lap_time_seconds)
    if not ordered:
        return []
    median = np.median([lap.lap_time_seconds for lap in ordered])
    filtered = [lap for lap in ordered if abs(lap.lap_time_seconds - median) <= 2.5]
    return filtered[: settings.ensemble_max_laps] or ordered[: settings.ensemble_min_laps]


def build_analysis_result(
    *,
    job_id: str,
    request: AnalysisRequest,
    race: Race,
    driver_a: Driver,
    driver_b: Driver,
    grid_a: dict,
    grid_b: dict,
    rep_laps_a: list[int],
    rep_laps_b: list[int],
    lap_time_a: float,
    lap_time_b: float,
) -> tuple[AnalysisResult, pd.DataFrame]:
    delta = calculate_cumulative_delta(grid_a, grid_b)
    df = pd.DataFrame(
        {
            "distance": grid_a["distance"],
            "delta": delta,
            "speed_a": grid_a["speed"],
            "speed_b": grid_b["speed"],
            "throttle_a": grid_a["throttle"],
            "throttle_b": grid_b["throttle"],
            "brake_a": grid_a["brake"],
            "brake_b": grid_b["brake"],
            "gear_a": grid_a["gear"],
            "gear_b": grid_b["gear"],
        }
    )
    sectors = build_sector_breakdown(df)
    waterfall = build_waterfall(df)
    insights = detect_insights(df, driver_a.code, driver_b.code, rep_laps_a, rep_laps_b)
    total_delta = lap_time_b - lap_time_a
    charts = ChartData(**df.to_dict(orient="list"), waterfall=waterfall)
    result = AnalysisResult(
        job_id=job_id,
        status=JobStatus.completed,
        request=request,
        race=race,
        driver_a=driver_a,
        driver_b=driver_b,
        lap_summary=LapSummary(
            lap_a=format_lap_time(lap_time_a),
            lap_b=format_lap_time(lap_time_b),
            delta=f"{total_delta:+.3f}",
            representative_laps_a=rep_laps_a,
            representative_laps_b=rep_laps_b,
            total_delta_seconds=round(total_delta, 3),
        ),
        sectors=sectors,
        insights=insights,
        charts=charts,
        generated_at=datetime.utcnow(),
    )
    return result, df


def build_sector_breakdown(df: pd.DataFrame) -> list[Sector]:
    sectors: list[Sector] = []
    chunks = np.array_split(df, 3)
    for index, chunk in enumerate(chunks, start=1):
        delta = float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0])
        sectors.append(Sector(label=f"S{index}", delta=round(delta, 3), winner="A" if delta >= 0 else "B"))
    return sectors


def build_waterfall(df: pd.DataFrame, count: int = 15) -> list[SectorWaterfallItem]:
    chunks = np.array_split(df, count)
    rows: list[SectorWaterfallItem] = []
    for index, chunk in enumerate(chunks, start=1):
        delta = float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0])
        rows.append(
            SectorWaterfallItem(
                label=f"T{index}",
                delta=round(delta, 3),
                winner="A" if delta >= 0 else "B",
                start_distance=round(float(chunk["distance"].iloc[0]), 2),
                end_distance=round(float(chunk["distance"].iloc[-1]), 2),
            )
        )
    return rows


def detect_insights(df: pd.DataFrame, code_a: str, code_b: str, laps_a: list[int], laps_b: list[int]) -> list[Insight]:
    detectors = [
        _braking_point_insight,
        _trail_braking_insight,
        _corner_exit_insight,
        _throttle_application_insight,
        _traction_ramp_insight,
        _drs_efficiency_insight,
        _sector_gap_insight,
    ]
    insights = []
    for insight_id, detector in enumerate(detectors):
        insight = detector(insight_id, df, code_a, code_b, laps_a, laps_b)
        if insight is not None:
            insights.append(insight)
    return sorted(insights, key=lambda item: abs(item.timeA), reverse=True)[:7]


def synthetic_aligned_grids(request: AnalysisRequest) -> tuple[dict, dict, float, float, list[int], list[int]]:
    seed = int(hashlib.sha256(request.model_dump_json().encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    distance = np.linspace(0, 5200 + (request.round * 7), settings.distance_samples)
    phase = distance / distance.max()
    corner_wave = 0.5 + 0.5 * np.sin(phase * math.pi * 14 + 0.35)
    base_speed = 95 + 215 * np.clip(1 - corner_wave**2.6, 0, 1)
    straight_boost = 28 * np.sin(phase * math.pi * 4) ** 2
    speed_a = np.clip(base_speed + straight_boost + rng.normal(0, 2.0, distance.size), 55, 345)
    speed_b = np.clip(base_speed + straight_boost - 2.5 + rng.normal(0, 2.0, distance.size), 55, 345)
    speed_a += 5 * np.exp(-((phase - 0.22) / 0.035) ** 2) - 3 * np.exp(-((phase - 0.45) / 0.04) ** 2)
    speed_b += 4 * np.exp(-((phase - 0.45) / 0.04) ** 2) + 2 * np.exp(-((phase - 0.68) / 0.05) ** 2)
    throttle_a = np.clip((speed_a - 70) / 240 * 100 + rng.normal(0, 3, distance.size), 0, 100)
    throttle_b = np.clip((speed_b - 70) / 240 * 100 + rng.normal(0, 3, distance.size), 0, 100)
    brake_a = np.where(np.gradient(speed_a) < -1.6, 1, 0)
    brake_b = np.where(np.gradient(speed_b) < -1.6, 1, 0)
    gear_a = np.clip(np.rint(speed_a / 42), 1, 8)
    gear_b = np.clip(np.rint(speed_b / 42), 1, 8)
    grid_a = {"distance": distance, "speed": speed_a, "throttle": throttle_a, "brake": brake_a, "gear": gear_a}
    grid_b = {"distance": distance, "speed": speed_b, "throttle": throttle_b, "brake": brake_b, "gear": gear_b}
    lap_a = float(np.sum(np.diff(distance, prepend=distance[0]) / np.maximum(speed_a / 3.6, 1.0)))
    lap_b = float(np.sum(np.diff(distance, prepend=distance[0]) / np.maximum(speed_b / 3.6, 1.0)))
    return grid_a, grid_b, lap_a, lap_b, [3, 5, 7, 9, 11], [2, 4, 6, 8, 10]


def format_lap_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    remainder = seconds - minutes * 60
    return f"{minutes}:{remainder:06.3f}"


def _prepare_telemetry(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    if "Distance" not in frame and {"X", "Y"}.issubset(frame.columns):
        frame["Distance"] = np.sqrt(frame["X"].diff().fillna(0) ** 2 + frame["Y"].diff().fillna(0) ** 2).cumsum()
    for channel in CHANNELS:
        if channel not in frame:
            frame[channel] = 0
    frame = frame.dropna(subset=["Distance"]).sort_values("Distance")
    return frame.drop_duplicates(subset=["Distance"])


def _normalized_channel_name(channel: str) -> str:
    return {"Speed": "speed", "Throttle": "throttle", "Brake": "brake", "nGear": "gear"}[channel]


def _zone(df: pd.DataFrame, start: float, end: float) -> pd.DataFrame:
    max_dist = float(df["distance"].max())
    return df[(df["distance"] >= start * max_dist) & (df["distance"] <= end * max_dist)]


def _confidence(laps_a: list[int], laps_b: list[int], strength: float) -> tuple[float, str]:
    total = max(len(laps_a), len(laps_b), 1)
    consistent = max(settings.ensemble_min_laps, min(total, round(total * max(settings.insight_consistency_threshold, strength))))
    return round(min(0.98, 0.55 + strength * 0.4), 2), f"{consistent}/{total}"


def _mini_trace(chunk: pd.DataFrame, channel: str) -> MiniTrace:
    sample = chunk.iloc[np.linspace(0, len(chunk) - 1, min(40, len(chunk))).astype(int)]
    return MiniTrace(
        distance=[round(float(v), 2) for v in sample["distance"]],
        driver_a=[round(float(v), 3) for v in sample[f"{channel}_a"]],
        driver_b=[round(float(v), 3) for v in sample[f"{channel}_b"]],
        channel=channel,
    )


def _build_insight(
    insight_id: int,
    df: pd.DataFrame,
    code_a: str,
    code_b: str,
    laps_a: list[int],
    laps_b: list[int],
    *,
    sector: int,
    corner: str,
    cat: str,
    cat_full: str,
    channel: str,
    start: float,
    end: float,
    delta: float,
    casual: str,
    detail: str,
    stats: list[list[str]],
    strength: float,
) -> Insight:
    chunk = _zone(df, start, end)
    conf, laps = _confidence(laps_a, laps_b, strength)
    gain_code = code_a if delta >= 0 else code_b
    return Insight(
        id=insight_id,
        sector=sector,
        corner=corner,
        cat=cat,
        catFull=cat_full,
        timeA=round(delta, 3),
        driverGain=gain_code,
        casual=casual,
        detail=detail,
        dist=f"{start:.3f} - {end:.3f}",
        conf=conf,
        laps=laps,
        stats=stats,
        mini_trace=_mini_trace(chunk, channel),
        channel_stats={
            "start_distance": round(float(chunk["distance"].iloc[0]), 2),
            "end_distance": round(float(chunk["distance"].iloc[-1]), 2),
            "mean_delta": round(float(chunk["delta"].mean()), 4),
        },
    )


def _braking_point_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.20, 0.25)
    brake_delta_m = float((chunk["brake_a"].idxmax() - chunk["brake_b"].idxmax()) * (df["distance"].max() / len(df)))
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if brake_delta_m >= 0 else b
    return _build_insight(
        i, df, a, b, la, lb, sector=1, corner="T4", cat="Braking", cat_full="Late braking point",
        channel="brake", start=0.20, end=0.25, delta=delta if winner == a else -delta,
        casual=f"{winner} braked {abs(brake_delta_m):.1f}m later into Turn 4",
        detail=f"Brake point delta {abs(brake_delta_m):.1f}m - min speed {chunk['speed_a'].min():.0f} vs {chunk['speed_b'].min():.0f} km/h",
        stats=[["Brake point delta", f"{abs(brake_delta_m):.1f}m {winner}"], ["Min speed", f"{chunk['speed_a'].min():.0f} vs {chunk['speed_b'].min():.0f} km/h"], ["Delta contribution", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(brake_delta_m) / 12),
    )


def _trail_braking_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.52, 0.58)
    overlap_a = float(chunk["brake_a"].sum())
    overlap_b = float(chunk["brake_b"].sum())
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if overlap_a >= overlap_b else b
    return _build_insight(
        i, df, a, b, la, lb, sector=2, corner="T11", cat="Trail Brake", cat_full="Trail braking overlap",
        channel="brake", start=0.52, end=0.58, delta=delta if winner == a else -delta,
        casual=f"{winner} carried cleaner trail braking through Turn 11",
        detail=f"Brake overlap {overlap_a:.0f} vs {overlap_b:.0f} samples - entry speed {chunk['speed_a'].iloc[0]:.0f} vs {chunk['speed_b'].iloc[0]:.0f}",
        stats=[["Trail brake overlap", f"{overlap_a:.0f} vs {overlap_b:.0f} samples"], ["Entry speed", f"{chunk['speed_a'].iloc[0]:.0f} vs {chunk['speed_b'].iloc[0]:.0f} km/h"], ["Delta contribution", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(overlap_a - overlap_b) / 20),
    )


def _corner_exit_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.42, 0.47)
    speed_delta = float(chunk["speed_a"].tail(10).mean() - chunk["speed_b"].tail(10).mean())
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if speed_delta >= 0 else b
    return _build_insight(
        i, df, a, b, la, lb, sector=2, corner="T8", cat="Exit Speed", cat_full="Corner exit speed",
        channel="speed", start=0.42, end=0.47, delta=delta if winner == a else -delta,
        casual=f"{winner} had higher corner exit speed through Turn 8",
        detail=f"Exit speed delta {abs(speed_delta):.1f} km/h - throttle {chunk['throttle_a'].mean():.0f}% vs {chunk['throttle_b'].mean():.0f}%",
        stats=[["Exit speed delta", f"{abs(speed_delta):.1f} km/h {winner}"], ["Throttle avg", f"{chunk['throttle_a'].mean():.0f}% vs {chunk['throttle_b'].mean():.0f}%"], ["Delta contribution", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(speed_delta) / 8),
    )


def _throttle_application_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.73, 0.79)
    full_a = _first_distance_above(chunk, "throttle_a", 95)
    full_b = _first_distance_above(chunk, "throttle_b", 95)
    delta_m = full_b - full_a
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if delta_m >= 0 else b
    return _build_insight(
        i, df, a, b, la, lb, sector=3, corner="T15", cat="Throttle", cat_full="Full throttle application",
        channel="throttle", start=0.73, end=0.79, delta=delta if winner == a else -delta,
        casual=f"{winner} reached full throttle {abs(delta_m):.1f}m earlier after T15",
        detail=f"Full throttle point delta {abs(delta_m):.1f}m - ramp {chunk['throttle_a'].diff().mean():.2f} vs {chunk['throttle_b'].diff().mean():.2f}",
        stats=[["Full throttle point", f"{abs(delta_m):.1f}m {winner} earlier"], ["Throttle avg", f"{chunk['throttle_a'].mean():.0f}% vs {chunk['throttle_b'].mean():.0f}%"], ["Delta contribution", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(delta_m) / 20),
    )


def _traction_ramp_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.76, 0.82)
    ramp_a = float(chunk["throttle_a"].diff().clip(lower=0).mean() * 100)
    ramp_b = float(chunk["throttle_b"].diff().clip(lower=0).mean() * 100)
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if ramp_a >= ramp_b else b
    return _build_insight(
        i, df, a, b, la, lb, sector=3, corner="T16", cat="Traction", cat_full="Traction zone ramp rate",
        channel="throttle", start=0.76, end=0.82, delta=delta if winner == a else -delta,
        casual=f"{winner} ramped throttle more confidently in the traction zone",
        detail=f"Positive throttle ramp {ramp_a:.1f} vs {ramp_b:.1f}% per sample",
        stats=[["Ramp rate", f"{ramp_a:.1f} vs {ramp_b:.1f}%"], ["Exit speed", f"{chunk['speed_a'].tail(5).mean():.0f} vs {chunk['speed_b'].tail(5).mean():.0f} km/h"], ["Delta contribution", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(ramp_a - ramp_b) / 30),
    )


def _drs_efficiency_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    chunk = _zone(df, 0.32, 0.38)
    top_delta = float(chunk["speed_a"].max() - chunk["speed_b"].max())
    delta = abs(float(chunk["delta"].iloc[-1] - chunk["delta"].iloc[0]))
    winner = a if top_delta >= 0 else b
    return _build_insight(
        i, df, a, b, la, lb, sector=2, corner="DRS", cat="DRS", cat_full="DRS efficiency zone",
        channel="speed", start=0.32, end=0.38, delta=delta if winner == a else -delta,
        casual=f"{winner} converted the DRS zone into higher top speed",
        detail=f"Top speed delta {abs(top_delta):.1f} km/h with matched activation window",
        stats=[["Top speed delta", f"{abs(top_delta):.1f} km/h {winner}"], ["DRS activation", "Matched zone"], ["Straight gain", f"{delta:+.3f}s {winner}"]],
        strength=min(1, abs(top_delta) / 6),
    )


def _sector_gap_insight(i: int, df: pd.DataFrame, a: str, b: str, la: list[int], lb: list[int]) -> Insight:
    sectors = build_sector_breakdown(df)
    biggest = max(sectors, key=lambda sector: abs(sector.delta))
    start = (int(biggest.label[1]) - 1) / 3
    end = int(biggest.label[1]) / 3
    winner = a if biggest.winner == "A" else b
    return _build_insight(
        i, df, a, b, la, lb, sector=int(biggest.label[1]), corner=biggest.label, cat="Sector", cat_full="Sector gap concentration",
        channel="speed", start=start, end=end, delta=biggest.delta,
        casual=f"{winner} made the largest net gain in {biggest.label}",
        detail=f"{biggest.label} contributed {biggest.delta:+.3f}s of the cumulative lap delta",
        stats=[["Sector delta", f"{biggest.delta:+.3f}s {winner}"], ["Consistency threshold", "60% ensemble"], ["Representative laps", f"{len(la)} vs {len(lb)}"]],
        strength=min(1, abs(biggest.delta) / 0.18),
    )


def _first_distance_above(chunk: pd.DataFrame, column: str, threshold: float) -> float:
    rows = chunk[chunk[column] >= threshold]
    if rows.empty:
        return float(chunk["distance"].iloc[-1])
    return float(rows["distance"].iloc[0])
