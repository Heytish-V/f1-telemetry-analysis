from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class JobStatus(str, Enum):
    pending = "PENDING"
    running = "RUNNING"
    completed = "COMPLETED"
    failed = "FAILED"
    deleted = "DELETED"


class RaceORM(Base):
    __tablename__ = "races"
    __table_args__ = (UniqueConstraint("season", "round", name="uq_race_season_round"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    round: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(120))
    circuit: Mapped[str] = mapped_column(String(160))
    date: Mapped[str] = mapped_column(String(32))
    type: Mapped[str] = mapped_column(String(32), index=True)
    flag: Mapped[str] = mapped_column(String(16), default="")
    country: Mapped[str] = mapped_column(String(80), default="")
    sessions: Mapped[str] = mapped_column(String(80), default="FP1,FP2,FP3,Q3,R")


class DriverORM(Base):
    __tablename__ = "drivers"
    __table_args__ = (UniqueConstraint("season", "code", name="uq_driver_season_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    code: Mapped[str] = mapped_column(String(3), index=True)
    num: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    team: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(16))


class AnalysisJobORM(Base):
    __tablename__ = "analysis_jobs"

    job_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    season: Mapped[int] = mapped_column(Integer)
    round: Mapped[int] = mapped_column(Integer)
    session: Mapped[str] = mapped_column(String(8))
    driver_a: Mapped[str] = mapped_column(String(3))
    driver_b: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(16), default=JobStatus.pending.value)
    parquet_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Race(BaseModel):
    round: int
    name: str
    circuit: str
    date: str
    type: Literal["street", "high-speed", "technical"]
    flag: str = ""
    sessions: list[str] = Field(default_factory=lambda: ["FP1", "FP2", "FP3", "Q3", "R"])


class Driver(BaseModel):
    code: str = Field(min_length=2, max_length=3)
    num: int = Field(ge=0, le=999)
    name: str
    team: str
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class AnalysisRequest(BaseModel):
    year: int = Field(ge=2018, le=2026)
    round: int = Field(ge=1, le=30)
    session: str = Field(pattern=r"^(FP1|FP2|FP3|Q|Q1|Q2|Q3|R|S|SQ)$")
    driver_a: str = Field(min_length=2, max_length=3)
    driver_b: str = Field(min_length=2, max_length=3)
    force_refresh: bool = False

    @field_validator("driver_a", "driver_b", "session")
    @classmethod
    def normalize_upper(cls, value: str) -> str:
        return value.upper()

    @field_validator("driver_b")
    @classmethod
    def drivers_must_differ(cls, value: str, info: Any) -> str:
        if info.data.get("driver_a") == value:
            raise ValueError("driver_a and driver_b must be different")
        return value


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus
    cached: bool = False
    poll_url: str


class LapSummary(BaseModel):
    lap_a: str
    lap_b: str
    delta: str
    representative_laps_a: list[int]
    representative_laps_b: list[int]
    total_delta_seconds: float


class Sector(BaseModel):
    label: str
    delta: float
    winner: Literal["A", "B"]


class SectorWaterfallItem(BaseModel):
    label: str
    delta: float
    winner: Literal["A", "B"]
    start_distance: float
    end_distance: float


class MiniTrace(BaseModel):
    distance: list[float]
    driver_a: list[float]
    driver_b: list[float]
    channel: str


class Insight(BaseModel):
    id: int
    sector: int
    corner: str
    cat: str
    catFull: str
    timeA: float
    driverGain: str
    casual: str
    detail: str
    dist: str
    conf: float = Field(ge=0, le=1)
    laps: str
    stats: list[list[str]]
    mini_trace: MiniTrace | None = None
    channel_stats: dict[str, float | str] = Field(default_factory=dict)


class ChartData(BaseModel):
    distance: list[float]
    delta: list[float]
    speed_a: list[float]
    speed_b: list[float]
    throttle_a: list[float]
    throttle_b: list[float]
    brake_a: list[float]
    brake_b: list[float]
    gear_a: list[float]
    gear_b: list[float]
    x_a: list[float] | None = None
    y_a: list[float] | None = None
    x_b: list[float] | None = None
    y_b: list[float] | None = None
    waterfall: list[SectorWaterfallItem]


class AnalysisResult(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    job_id: str
    status: JobStatus
    request: AnalysisRequest | None = None
    race: Race | None = None
    driver_a: Driver | None = None
    driver_b: Driver | None = None
    lap_summary: LapSummary | None = None
    sectors: list[Sector] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)
    charts: ChartData | None = None
    generated_at: datetime | None = None
    error: str | None = None


class ErrorResponse(BaseModel):
    detail: str


class ExportFormat(str, Enum):
    csv = "csv"
    json = "json"
    pdf = "pdf"
