from __future__ import annotations

import gc
import os
import time
from datetime import datetime
import logging
import psutil

import pandas as pd
from celery import Celery
from sqlalchemy import select

from analysis_engine import align_distance_grid, build_analysis_result, synthetic_aligned_grids
from config import get_settings
from data_sources import get_race, resolve_session_drivers
from database import SessionLocal, dumps_json, write_parquet
from models import AnalysisJobORM, AnalysisRequest, JobStatus

settings = get_settings()
logger = logging.getLogger(__name__)
celery_app = Celery("pitwall", broker=settings.redis_url, backend=settings.effective_celery_backend)
celery_app.conf.update(task_track_started=True, result_expires=86400)


# ── Memory instrumentation ────────────────────────────────────────────────

def _log_memory(label: str) -> None:
    """Log RSS and VMS memory for the current process."""
    try:
        process = psutil.Process(os.getpid())
        mem = process.memory_info()
        logger.info(
            "[MEMORY] %s — RSS: %.1f MB, VMS: %.1f MB",
            label, mem.rss / (1024 * 1024), mem.vms / (1024 * 1024),
        )
    except Exception:
        logger.exception("Memory logging failed")


# ── Celery task ───────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="pitwall.run_telemetry_analysis")
def run_telemetry_analysis(self, job_id: str) -> dict:
    _log_memory(f"job {job_id} — start")
    t_start = time.perf_counter()

    # ── Session 1: Read metadata, mark RUNNING, close immediately ─────
    # The DB session must NOT stay open during the long FastF1 download.
    db = SessionLocal()
    try:
        job = db.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
        if job is None:
            raise RuntimeError(f"Unknown analysis job {job_id}")
        job.status = JobStatus.running.value
        job.progress = 0.1
        job.updated_at = datetime.utcnow()
        db.commit()

        request = AnalysisRequest(
            year=job.season,
            round=job.round,
            session=job.session,
            driver_a=job.driver_a,
            driver_b=job.driver_b,
        )
        race = get_race(db, request.year, request.round)
        if not race:
            raise RuntimeError("Race metadata is unavailable")
    finally:
        db.close()

    # ── No DB session open: resolve drivers (may hit FastF1 cache) ────
    driver_a, driver_b = resolve_session_drivers(
        request.year, request.round, request.session, request.driver_a, request.driver_b
    )

    # ── No DB session open: heavy FastF1 download + analysis ──────────
    try:
        grid_a, grid_b, lap_a, lap_b, rep_a, rep_b = _fastf1_grids(request)

        # Brief session to update progress
        db2 = SessionLocal()
        try:
            job = db2.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
            if job is not None:
                job.progress = 0.65
                job.updated_at = datetime.utcnow()
                db2.commit()
        finally:
            db2.close()

        _log_memory(f"job {job_id} — before build_analysis_result")
        t_build = time.perf_counter()

        result, telemetry_df = build_analysis_result(
            job_id=job_id,
            request=request,
            race=race,
            driver_a=driver_a,
            driver_b=driver_b,
            grid_a=grid_a,
            grid_b=grid_b,
            rep_laps_a=rep_a,
            rep_laps_b=rep_b,
            lap_time_a=lap_a,
            lap_time_b=lap_b,
        )

        logger.info("build_analysis_result took %.1fs", time.perf_counter() - t_build)

        # ── Session 2: Write results ──────────────────────────────────
        parquet_path = write_parquet(telemetry_df, job_id)
        db3 = SessionLocal()
        try:
            job = db3.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
            if job is not None:
                job.status = JobStatus.completed.value
                job.progress = 1.0
                job.parquet_path = str(parquet_path)
                job.result_json = result.model_dump_json()
                job.completed_at = datetime.utcnow()
                job.updated_at = datetime.utcnow()
                db3.commit()
        finally:
            db3.close()

        elapsed = time.perf_counter() - t_start
        _log_memory(f"job {job_id} — completed in {elapsed:.1f}s")
        logger.info("Analysis job %s completed in %.1fs", job_id, elapsed)

        return {"job_id": job_id, "status": JobStatus.completed.value}

    except Exception as exc:
        logger.exception("Analysis job %s FAILED", job_id)
        # ── Error session: mark job as FAILED ─────────────────────────
        db_err = SessionLocal()
        try:
            job = db_err.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
            if job is not None:
                job.status = JobStatus.failed.value
                job.error = str(exc)
                job.updated_at = datetime.utcnow()
                job.result_json = dumps_json({"job_id": job_id, "status": JobStatus.failed.value, "error": str(exc)})
                db_err.commit()
        finally:
            db_err.close()
        raise
    finally:
        gc.collect()
        _log_memory(f"job {job_id} — after gc.collect")


# ── FastF1 data loading ──────────────────────────────────────────────────

def _fastf1_grids(
    request: AnalysisRequest,
) -> tuple[dict, dict, float, float, list[int], list[int]]:
    """Load FastF1 session data and build aligned distance grids.

    FastF1 architecture:
        session.load(telemetry=True)  populates session.car_data + session.pos_data
        Lap.get_telemetry()           slices session.car_data + session.pos_data by lap
        Lap.get_car_data()            slices session.car_data by lap
        Lap.get_pos_data()            slices session.pos_data by lap

    telemetry=False makes get_telemetry() raise DataNotLoadedError because the
    session-level DataFrames it reads from were never populated.

    Memory strategy:
        1. session.load(telemetry=True)   — peak: ~300-800 MB for Race sessions
        2. Extract 2 fastest laps' telemetry  — ~5 MB each
        3. del session + gc.collect()     — frees the ~800 MB bulk data
        4. Continue with ~10 MB of extracted data
    """
    import fastf1

    fastf1.Cache.enable_cache(str(settings.fastf1_cache_dir))
    session_code = "Q" if request.session in {"Q1", "Q2", "Q3"} else request.session
    session = fastf1.get_session(request.year, request.round, session_code)

    # ── Step 1: Load session with telemetry (required for get_telemetry) ──
    _log_memory("before session.load")
    t0 = time.perf_counter()
    session.load(telemetry=True, weather=False, messages=False, laps=True)
    load_time = time.perf_counter() - t0
    logger.info(
        "session.load(telemetry=True) for %s R%d %s took %.1fs",
        request.year, request.round, session_code, load_time,
    )
    _log_memory("after session.load (peak)")

    # ── Step 2: Pick fastest laps ─────────────────────────────────────────
    # Try quick laps first; fall back to all valid laps for drivers who
    # completed laps but none within the "quick" threshold (e.g. 107%).
    laps_a = session.laps.pick_driver(request.driver_a).pick_quicklaps()
    if len(laps_a) == 0:
        all_laps_a = session.laps.pick_driver(request.driver_a)
        laps_a = all_laps_a[all_laps_a["LapTime"].notna()]
        if len(laps_a) > 0:
            logger.warning(
                "%s has no quick laps — falling back to %d valid laps",
                request.driver_a, len(laps_a),
            )

    laps_b = session.laps.pick_driver(request.driver_b).pick_quicklaps()
    if len(laps_b) == 0:
        all_laps_b = session.laps.pick_driver(request.driver_b)
        laps_b = all_laps_b[all_laps_b["LapTime"].notna()]
        if len(laps_b) > 0:
            logger.warning(
                "%s has no quick laps — falling back to %d valid laps",
                request.driver_b, len(laps_b),
            )

    if len(laps_a) == 0 or len(laps_b) == 0:
        missing = []
        if len(laps_a) == 0:
            missing.append(request.driver_a)
        if len(laps_b) == 0:
            missing.append(request.driver_b)
        raise RuntimeError(
            f"Driver(s) {', '.join(missing)} retired before recording a representative lap."
        )

    fastest_a = laps_a.pick_fastest()
    fastest_b = laps_b.pick_fastest()

    # ── Step 3: Extract telemetry for the 2 fastest laps only ─────────────
    _log_memory("before get_telemetry")
    t1 = time.perf_counter()

    is_race = request.session in {"R", "S"}

    def safe_get_telemetry(lap):
        try:
            if is_race:
                # Explicitly use get_car_data for Race sessions to avoid massive merge overhead and OOMs
                tel = lap.get_car_data().add_distance()
            else:
                tel = lap.get_telemetry()
                
            # Gracefully handle missing position data for track-map features.
            # Car data is 10 Hz, GPS position data is 4 Hz — exact timestamp
            # matching produces almost all NaN.  Use merge_asof with
            # direction="nearest" to match each car sample to the closest GPS
            # sample (typically <50 ms apart).
            if "X" not in tel.columns or "Y" not in tel.columns:
                try:
                    pos = lap.get_pos_data()
                    tel = tel.sort_values("Time")
                    pos = pos[["Time", "X", "Y", "Z"]].sort_values("Time")
                    tel = pd.merge_asof(tel, pos, on="Time", direction="nearest")
                except Exception as pos_exc:
                    logger.warning(f"Position data unavailable for lap {lap.LapNumber}: {pos_exc}")
                    tel["X"] = 0
                    tel["Y"] = 0
                    tel["Z"] = 0
                    
            # Fill any remaining NaNs in coordinate columns so Pydantic
            # serialisation doesn't choke on float('nan').
            for col in ["X", "Y", "Z"]:
                if col in tel.columns:
                    tel[col] = tel[col].fillna(0)
            
            return tel
        except Exception as e:
            logger.error(f"Failed to extract telemetry data: {e}")
            raise RuntimeError(f"Telemetry unavailable (upstream API error or missing data).") from e

    try:
        tel_a = safe_get_telemetry(fastest_a)
    except Exception:
        logger.exception(
            "Failed to load telemetry for %s (lap %s)",
            request.driver_a, getattr(fastest_a, "LapNumber", "?"),
        )
        raise RuntimeError(
            f"Telemetry unavailable for {request.driver_a} in "
            f"{request.year} Round {request.round} {session_code}"
        )

    try:
        tel_b = safe_get_telemetry(fastest_b)
    except Exception:
        logger.exception(
            "Failed to load telemetry for %s (lap %s)",
            request.driver_b, getattr(fastest_b, "LapNumber", "?"),
        )
        raise RuntimeError(
            f"Telemetry unavailable for {request.driver_b} in "
            f"{request.year} Round {request.round} {session_code}"
        )

    logger.info(
        "get_telemetry() for %s + %s took %.1fs (rows: %d + %d)",
        request.driver_a, request.driver_b, time.perf_counter() - t1,
        len(tel_a), len(tel_b),
    )

    # ── Step 4: Extract all scalar values before freeing session ──────────
    rep_a = [int(v) for v in laps_a.sort_values("LapTime").head(settings.ensemble_max_laps)["LapNumber"].tolist()]
    rep_b = [int(v) for v in laps_b.sort_values("LapTime").head(settings.ensemble_max_laps)["LapNumber"].tolist()]
    lap_a = float(fastest_a["LapTime"].total_seconds())
    lap_b = float(fastest_b["LapTime"].total_seconds())

    # ── Step 5: Free the heavy session object ─────────────────────────────
    # session.car_data and session.pos_data hold ALL drivers' telemetry for
    # the entire session (~300-800 MB for Race). We only need tel_a and tel_b
    # going forward (~10 MB total), so delete everything else.
    del session, laps_a, laps_b, fastest_a, fastest_b
    gc.collect()
    _log_memory("after session cleanup + gc.collect")

    # ── Step 6: Align onto distance grid ──────────────────────────────────
    grid_a, grid_b = align_distance_grid(tel_a, tel_b)

    # Free the raw telemetry DataFrames (~5 MB each) now that we have the
    # compact grid dicts (~1 MB each).
    del tel_a, tel_b

    return grid_a, grid_b, lap_a, lap_b, rep_a, rep_b

