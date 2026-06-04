from __future__ import annotations

import csv
import io
import logging
import threading
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from config import get_settings
from data_sources import RaceFilters, get_driver, get_race, list_drivers, list_races, get_session_drivers_fastf1, resolve_session_drivers
from database import get_db, init_database, loads_json, read_telemetry_parquet
from models import (
    AnalysisJobORM,
    AnalysisRequest,
    AnalysisResult,
    Driver,
    ErrorResponse,
    ExportFormat,
    Insight,
    JobResponse,
    JobStatus,
    Race,
)
from tasks import run_telemetry_analysis


settings = get_settings()
logger = logging.getLogger(__name__)
app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Backend for PitWall - F1 Telemetry Analytics.",
    responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_database()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "generated_at": datetime.utcnow().isoformat()}


@app.get("/api/seasons", response_model=list[int])
def seasons() -> list[int]:
    return list(range(2018, 2027))


@app.get("/api/seasons/{year}/races", response_model=list[Race])
def races(
    year: int,
    session_type: str = Query("all", pattern=r"^(all|FP|Q|R|S|FP1|FP2|FP3|Q1|Q2|Q3|SQ)$"),
    circuit_type: str = Query("all", pattern=r"^(all|street|high-speed|technical)$"),
    search: str = "",
    db: Session = Depends(get_db),
) -> list[Race]:
    _validate_year(year)
    return list_races(db, year, RaceFilters(session_type=session_type, circuit_type=circuit_type, search=search))


@app.get("/api/seasons/{year}/races/{round_num}/sessions", response_model=list[str])
def race_sessions(year: int, round_num: int, db: Session = Depends(get_db)) -> list[str]:
    race = get_race(db, year, round_num)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
    return race.sessions


@app.get("/api/seasons/{year}/drivers", response_model=list[Driver])
def drivers(year: int, db: Session = Depends(get_db)) -> list[Driver]:
    _validate_year(year)
    return list_drivers(db, year)


@app.get("/api/seasons/{year}/races/{round_num}/drivers", response_model=list[Driver])
def race_drivers(year: int, round_num: int, session: str = "Q3", db: Session = Depends(get_db)) -> list[Driver]:
    if get_race(db, year, round_num) is None:
        raise HTTPException(status_code=404, detail="Race not found")
    
    drivers = get_session_drivers_fastf1(year, round_num, session)
    if drivers:
        return drivers
        
    return list_drivers(db, year)


@app.post("/api/analysis", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
def create_analysis(request: AnalysisRequest, db: Session = Depends(get_db)) -> JobResponse:
    race = get_race(db, request.year, request.round)
    if race is None:
        raise HTTPException(status_code=404, detail="Race not found")
        
    try:
        driver_a, driver_b = resolve_session_drivers(
            request.year, request.round, request.session, request.driver_a, request.driver_b
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if request.session not in race.sessions and request.session != "Q":
        raise HTTPException(status_code=400, detail=f"Session {request.session} is not available for this race")

    cache_key = _cache_key(request)
    existing = db.scalar(select(AnalysisJobORM).where(AnalysisJobORM.cache_key == cache_key))
    
    if existing and not request.force_refresh:
        return JobResponse(
            job_id=existing.job_id,
            status=existing.status,
            cached=True,
            poll_url=f"/api/analysis/{existing.job_id}",
        )

    job_id = str(uuid.uuid4())
    actual_cache_key = cache_key if not request.force_refresh else f"{cache_key}:{job_id}"
    
    job = AnalysisJobORM(
        job_id=job_id,
        cache_key=actual_cache_key,
        season=request.year,
        round=request.round,
        session=request.session,
        driver_a=request.driver_a,
        driver_b=request.driver_b,
        status=JobStatus.pending.value,
    )
    
    try:
        db.add(job)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(AnalysisJobORM).where(AnalysisJobORM.cache_key == actual_cache_key))
        if existing:
            return JobResponse(
                job_id=existing.job_id,
                status=existing.status,
                cached=True,
                poll_url=f"/api/analysis/{existing.job_id}",
            )
        raise HTTPException(status_code=500, detail="Failed to retrieve analysis job after concurrent insert")

    try:
        run_telemetry_analysis.delay(job_id)
        logger.info("Analysis job %s dispatched to Celery", job_id)
    except Exception as exc:
        logger.warning("Celery unavailable (%s), running analysis in background thread for job %s", exc, job_id)
        thread = threading.Thread(
            target=_run_analysis_in_thread,
            args=(job_id,),
            daemon=True,
        )
        thread.start()
    return JobResponse(job_id=job_id, status=JobStatus.pending, cached=False, poll_url=f"/api/analysis/{job_id}")


def _run_analysis_in_thread(job_id: str) -> None:
    """Execute analysis in a background thread so the HTTP response is not blocked."""
    try:
        run_telemetry_analysis(job_id)
        logger.info("Background analysis completed for job %s", job_id)
    except Exception:
        logger.exception("Background analysis failed for job %s", job_id)


@app.get("/api/analysis/{job_id}", response_model=AnalysisResult)
def get_analysis(job_id: str, db: Session = Depends(get_db)) -> AnalysisResult:
    job = _get_job(db, job_id)
    if job.status != JobStatus.completed.value:
        return AnalysisResult(
            job_id=job.job_id,
            status=JobStatus(job.status),
            request=AnalysisRequest(
                year=job.season,
                round=job.round,
                session=job.session,
                driver_a=job.driver_a,
                driver_b=job.driver_b,
            ),
            error=job.error,
        )
    return _result_from_job(job)


@app.get("/api/analysis/{job_id}/insights/{insight_id}", response_model=Insight)
def get_insight(job_id: str, insight_id: int, db: Session = Depends(get_db)) -> Insight:
    result = _result_from_job(_get_job(db, job_id))
    for insight in result.insights:
        if insight.id == insight_id:
            return insight
    raise HTTPException(status_code=404, detail="Insight not found")


@app.get("/api/analysis/{job_id}/exports/{export_format}")
def export_analysis(job_id: str, export_format: ExportFormat, mode: str = "analyst", db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    if job.status != JobStatus.completed.value:
        raise HTTPException(status_code=409, detail="Analysis is not complete")
    if export_format == ExportFormat.json:
        return Response(job.result_json or "{}", media_type="application/json")
    if export_format == ExportFormat.csv:
        return _csv_export(job)
    return _pdf_export(job, mode)


@app.delete("/api/analysis/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analysis(job_id: str, db: Session = Depends(get_db)) -> Response:
    job = _get_job(db, job_id)
    if job.parquet_path:
        path = Path(job.parquet_path)
        if path.exists() and path.is_file():
            path.unlink()
    job.status = JobStatus.deleted.value
    job.updated_at = datetime.utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _validate_year(year: int) -> None:
    if year < 2018 or year > 2026:
        raise HTTPException(status_code=422, detail="Supported seasons are 2018 through 2026")


def _cache_key(request: AnalysisRequest) -> str:
    return f"{request.year}:{request.round}:{request.session}:{request.driver_a}:{request.driver_b}"


def _get_job(db: Session, job_id: str) -> AnalysisJobORM:
    job = db.scalar(select(AnalysisJobORM).where(AnalysisJobORM.job_id == job_id))
    if job is None or job.status == JobStatus.deleted.value:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


def _result_from_job(job: AnalysisJobORM) -> AnalysisResult:
    raw = loads_json(job.result_json)
    if not raw:
        raise HTTPException(status_code=404, detail="Analysis result not found")
    return AnalysisResult.model_validate(raw)


def _csv_export(job: AnalysisJobORM) -> StreamingResponse:
    if not job.parquet_path:
        raise HTTPException(status_code=404, detail="Telemetry parquet not found")
    df = read_telemetry_parquet(job.parquet_path)
    if df is None:
        raise HTTPException(status_code=404, detail="Telemetry parquet not found")
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(df.columns)
    writer.writerows(df.itertuples(index=False, name=None))
    stream.seek(0)
    return StreamingResponse(
        iter([stream.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="pitwall-{job.job_id}.csv"'},
    )


def _pdf_export(job: AnalysisJobORM, mode: str) -> FileResponse:
    result = _result_from_job(job)
    path = settings.reports_dir / f"pitwall-{job.job_id}-{mode}.pdf"
    if not path.exists():
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.pdfgen import canvas

            c = canvas.Canvas(str(path), pagesize=A4)
            c.setTitle("PitWall Analysis Report")
            c.drawString(48, 800, "PitWall - F1 Telemetry Analytics")
            c.drawString(48, 780, f"{result.race.name if result.race else ''} {job.season} {job.session}")
            c.drawString(48, 760, f"{job.driver_a} vs {job.driver_b} - mode: {mode}")
            y = 730
            if result.lap_summary:
                c.drawString(48, y, f"Lap delta: {result.lap_summary.delta}s")
                y -= 24
            for insight in result.insights[:6]:
                c.drawString(48, y, f"{insight.corner} {insight.cat}: {insight.casual}")
                y -= 18
            c.save()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"PDF export failed: {exc}") from exc
    return FileResponse(path, media_type="application/pdf", filename=path.name)
