from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import duckdb
import pandas as pd
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import get_settings


settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


# Enable WAL mode and set busy_timeout for SQLite connections.
# WAL allows concurrent readers while a writer is active, preventing
# "database is locked" errors when background workers and API handlers
# access the database simultaneously.  Must be set per-connection.
if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_database() -> None:
    import models  # noqa: F401  Ensures ORM classes are registered on Base.

    Base.metadata.create_all(bind=engine)


def parquet_path_for_job(job_id: str) -> Path:
    return settings.telemetry_data_dir / f"{job_id}.parquet"


def write_parquet(df: pd.DataFrame, job_id: str) -> Path:
    path = parquet_path_for_job(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, engine="pyarrow", compression="snappy", index=False)
    return path


def read_telemetry_parquet(path_or_job_id: str) -> pd.DataFrame | None:
    path = Path(path_or_job_id)
    if not path.suffix:
        path = parquet_path_for_job(path_or_job_id)
    if not path.exists():
        return None

    query = "SELECT * FROM read_parquet(?) ORDER BY distance ASC"
    with duckdb.connect(database=":memory:") as con:
        return con.execute(query, [str(path)]).df()


def dumps_json(data: object) -> str:
    return json.dumps(data, separators=(",", ":"), default=str)


def loads_json(raw: str | None) -> dict:
    if not raw:
        return {}
    return json.loads(raw)
