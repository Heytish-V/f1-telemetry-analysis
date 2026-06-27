import logging
import time
from datetime import datetime
import pandas as pd

import fastf1
from sqlalchemy import select

from database import SessionLocal
from models import TelemetryCacheRegistryORM
from config import get_settings

logger = logging.getLogger("preloader")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)

settings = get_settings()

SESSION_TYPES = ["FP1", "FP2", "FP3", "Sprint", "Sprint Shootout", "Qualifying", "Race"]
SESSION_IDENTIFIERS = {"FP1": "FP1", "FP2": "FP2", "FP3": "FP3", "Sprint": "S", "Sprint Shootout": "SQ", "Qualifying": "Q", "Race": "R"}

def run_preload_cycle() -> None:
    year = datetime.utcnow().year
    fastf1.Cache.enable_cache(str(settings.fastf1_cache_dir))

    # Get current season event schedule
    schedule = fastf1.get_event_schedule(year)
    if schedule.empty:
        logger.info("No schedule available for year %d", year)
        return

    # ── Short-lived session: read the current cache registry ──────────
    db = SessionLocal()
    try:
        records = db.execute(
            select(TelemetryCacheRegistryORM)
            .where(TelemetryCacheRegistryORM.season == year)
        ).scalars().all()
        cached_set = {
            (r.round, r.session) for r in records if r.status == "CACHED"
        }
    finally:
        db.close()

    # ── No DB session open: iterate events and perform FastF1 loads ───
    for _, event in schedule.iterrows():
        round_num = event["RoundNumber"]
        if round_num == 0:  # Pre-season testing
            continue

        for session_name in SESSION_TYPES:
            try:
                # FastF1 raises exception if session is invalid for that weekend type
                session_date = event.get_session_date(session_name)
                if session_date is None or pd.isna(session_date):
                    continue

                # Convert to naïve UTC datetime if necessary
                if session_date.tzinfo is not None:
                    session_date = session_date.tz_convert("UTC").tz_localize(None)

                if session_date < datetime.utcnow():
                    # Session is completed. Check if already cached.
                    session_id = SESSION_IDENTIFIERS.get(session_name, session_name)

                    if (round_num, session_id) in cached_set:
                        continue

                    # Needs caching
                    logger.info(f"Discovered new completed session: {year} Round {round_num} {session_id}")
                    start_time = time.time()
                    cache_status = "FAILED"

                    try:
                        # Load telemetry (no DB session open during this network I/O)
                        session = fastf1.get_session(year, round_num, session_id)
                        session.load(telemetry=False, weather=False, messages=False, laps=True)

                        duration = time.time() - start_time
                        logger.info(f"Cache generated for {year} Round {round_num} {session_id} in {duration:.1f}s")
                        cache_status = "CACHED"

                    except Exception:
                        logger.exception("Failed to preload %s Round %s %s", year, round_num, session_id)

                    # ── Brief session to write the registry entry ─────
                    db_write = SessionLocal()
                    try:
                        existing = db_write.scalar(
                            select(TelemetryCacheRegistryORM).where(
                                TelemetryCacheRegistryORM.season == year,
                                TelemetryCacheRegistryORM.round == round_num,
                                TelemetryCacheRegistryORM.session == session_id
                            )
                        )
                        if not existing:
                            existing = TelemetryCacheRegistryORM(
                                season=year,
                                round=round_num,
                                session=session_id,
                            )
                            db_write.add(existing)
                        existing.status = cache_status
                        existing.cached_at = datetime.utcnow()
                        db_write.commit()
                    finally:
                        db_write.close()

            except ValueError:
                # session_name doesn't exist for this event format
                continue
            except Exception as e:
                logger.warning(f"Error checking session {session_name} for round {round_num}: {e}")

