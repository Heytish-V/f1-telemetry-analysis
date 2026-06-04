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
    db = SessionLocal()
    try:
        year = datetime.utcnow().year
        fastf1.Cache.enable_cache(str(settings.fastf1_cache_dir))
        
        # Get current season event schedule
        schedule = fastf1.get_event_schedule(year)
        if schedule.empty:
            logger.info("No schedule available for year %d", year)
            return
            
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
                        # Session is completed. Check registry.
                        session_id = SESSION_IDENTIFIERS.get(session_name, session_name)
                        
                        existing = db.scalar(
                            select(TelemetryCacheRegistryORM).where(
                                TelemetryCacheRegistryORM.season == year,
                                TelemetryCacheRegistryORM.round == round_num,
                                TelemetryCacheRegistryORM.session == session_id
                            )
                        )
                        
                        if existing and existing.status == "CACHED":
                            continue
                            
                        # Needs caching
                        logger.info(f"Discovered new completed session: {year} Round {round_num} {session_id}")
                        start_time = time.time()
                        
                        try:
                            # Load telemetry
                            session = fastf1.get_session(year, round_num, session_id)
                            session.load(telemetry=True, weather=False, messages=False, laps=True)
                            
                            duration = time.time() - start_time
                            logger.info(f"Cache generated for {year} Round {round_num} {session_id} in {duration:.1f}s")
                            
                            if not existing:
                                existing = TelemetryCacheRegistryORM(
                                    season=year,
                                    round=round_num,
                                    session=session_id,
                                )
                                db.add(existing)
                                
                            existing.status = "CACHED"
                            existing.cached_at = datetime.utcnow()
                            db.commit()
                            
                        except Exception as e:
                            logger.error(f"Failed to preload {year} Round {round_num} {session_id}: {e}")
                            if not existing:
                                existing = TelemetryCacheRegistryORM(
                                    season=year,
                                    round=round_num,
                                    session=session_id,
                                )
                                db.add(existing)
                            existing.status = "FAILED"
                            existing.cached_at = datetime.utcnow()
                            db.commit()
                            
                except ValueError:
                    # session_name doesn't exist for this event format
                    continue
                except Exception as e:
                    logger.warning(f"Error checking session {session_name} for round {round_num}: {e}")
                    
    finally:
        db.close()
