from __future__ import annotations

from datetime import datetime

from celery import Celery
from sqlalchemy import select

from analysis_engine import align_distance_grid, build_analysis_result, synthetic_aligned_grids
from config import get_settings
from data_sources import get_driver, get_race
from database import SessionLocal, dumps_json, write_parquet
from models import AnalysisJobORM, AnalysisRequest, JobStatus


settings = get_settings()
celery_app = Celery("pitwall", broker=settings.redis_url, backend=settings.celery_result_backend)
celery_app.conf.update(task_track_started=True, result_expires=86400)


@celery_app.task(bind=True, name="pitwall.run_telemetry_analysis")
def run_telemetry_analysis(self, job_id: str) -> dict:
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
        driver_a = get_driver(db, request.year, request.driver_a)
        driver_b = get_driver(db, request.year, request.driver_b)
        if not race or not driver_a or not driver_b:
            raise RuntimeError("Race or driver metadata is unavailable")

        try:
            grid_a, grid_b, lap_a, lap_b, rep_a, rep_b = _fastf1_grids(request)
        except Exception:
            grid_a, grid_b, lap_a, lap_b, rep_a, rep_b = synthetic_aligned_grids(request)

        job.progress = 0.65
        job.updated_at = datetime.utcnow()
        db.commit()

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
        parquet_path = write_parquet(telemetry_df, job_id)
        job.status = JobStatus.completed.value
        job.progress = 1.0
        job.parquet_path = str(parquet_path)
        job.result_json = result.model_dump_json()
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()
        return {"job_id": job_id, "status": JobStatus.completed.value}
    except Exception as exc:
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


def _fastf1_grids(request: AnalysisRequest) -> tuple[dict, dict, float, float, list[int], list[int]]:
    import fastf1

    fastf1.Cache.enable_cache(str(settings.fastf1_cache_dir))
    session_code = "Q" if request.session in {"Q1", "Q2", "Q3"} else request.session
    session = fastf1.get_session(request.year, request.round, session_code)
    session.load(telemetry=True, weather=False, messages=False, laps=True)
    laps_a = session.laps.pick_driver(request.driver_a).pick_quicklaps()
    laps_b = session.laps.pick_driver(request.driver_b).pick_quicklaps()
    if len(laps_a) == 0 or len(laps_b) == 0:
        raise RuntimeError("No quick laps available for selected drivers")

    fastest_a = laps_a.pick_fastest()
    fastest_b = laps_b.pick_fastest()
    tel_a = fastest_a.get_telemetry()
    tel_b = fastest_b.get_telemetry()
    grid_a, grid_b = align_distance_grid(tel_a, tel_b)
    rep_a = [int(v) for v in laps_a.sort_values("LapTime").head(settings.ensemble_max_laps)["LapNumber"].tolist()]
    rep_b = [int(v) for v in laps_b.sort_values("LapTime").head(settings.ensemble_max_laps)["LapNumber"].tolist()]
    lap_a = float(fastest_a["LapTime"].total_seconds())
    lap_b = float(fastest_b["LapTime"].total_seconds())
    return grid_a, grid_b, lap_a, lap_b, rep_a, rep_b
