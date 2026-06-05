from __future__ import annotations

import gc
import os
import time
from datetime import datetime
import logging
import psutil

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
            
        driver_a, driver_b = resolve_session_drivers(
            request.year, request.round, request.session, request.driver_a, request.driver_b
        )

        grid_a, grid_b, lap_a, lap_b, rep_a, rep_b = _fastf1_grids(request)

        job.progress = 0.65
        job.updated_at = datetime.utcnow()
        db.commit()

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

        parquet_path = write_parquet(telemetry_df, job_id)
        job.status = JobStatus.completed.value
        job.progress = 1.0
        job.parquet_path = str(parquet_path)
        job.result_json = result.model_dump_json()
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()

        elapsed = time.perf_counter() - t_start
        _log_memory(f"job {job_id} — completed in {elapsed:.1f}s")
        logger.info("Analysis job %s completed in %.1fs", job_id, elapsed)

        return {"job_id": job_id, "status": JobStatus.completed.value}

    except Exception as exc:
        logger.exception("Analysis job %s FAILED", job_id)
        job = db.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
        if job is not None:
            job.status = JobStatus.failed.value
            job.error = str(exc)
            job.updated_at = datetime.utcnow()
            job.result_json = dumps_json({"job_id": job_id, "status": JobStatus.failed.value, "error": str(exc)})
            db.commit()
        raise
    finally:
        db.close()
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
    laps_a = session.laps.pick_driver(request.driver_a).pick_quicklaps()
    laps_b = session.laps.pick_driver(request.driver_b).pick_quicklaps()
    if len(laps_a) == 0 or len(laps_b) == 0:
        raise RuntimeError(
            f"No quick laps available — {request.driver_a}: {len(laps_a)} laps, "
            f"{request.driver_b}: {len(laps_b)} laps"
        )

    fastest_a = laps_a.pick_fastest()
    fastest_b = laps_b.pick_fastest()

    # ── Step 3: Extract telemetry for the 2 fastest laps only ─────────────
    _log_memory("before get_telemetry")
    t1 = time.perf_counter()

    try:
        tel_a = fastest_a.get_telemetry()
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
        tel_b = fastest_b.get_telemetry()
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

    return grid_a, grid_b, lap_a, lap_b, rep_a, rep_b

