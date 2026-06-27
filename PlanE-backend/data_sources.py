from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import logging
from typing import Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import get_settings
from models import Driver, DriverORM, Race, RaceORM


settings = get_settings()
logger = logging.getLogger(__name__)

CIRCUIT_TYPES = {
    "Bahrain International Circuit": "high-speed",
    "Jeddah Corniche Circuit": "street",
    "Albert Park Grand Prix Circuit": "street",
    "Baku City Circuit": "street",
    "Miami International Autodrome": "street",
    "Circuit de Monaco": "street",
    "Circuit de Barcelona-Catalunya": "technical",
    "Circuit Gilles Villeneuve": "street",
    "Red Bull Ring": "high-speed",
    "Silverstone Circuit": "high-speed",
    "Hungaroring": "technical",
    "Circuit de Spa-Francorchamps": "high-speed",
}

COUNTRY_FLAGS = {
    "Bahrain": "BH",
    "Saudi Arabia": "SA",
    "Australia": "AU",
    "Azerbaijan": "AZ",
    "USA": "US",
    "Monaco": "MC",
    "Spain": "ES",
    "Canada": "CA",
    "Austria": "AT",
    "UK": "GB",
    "Hungary": "HU",
    "Belgium": "BE",
}

TEAM_COLORS = {
    "Red Bull Racing": "#3B9EFF",
    "Red Bull": "#3B9EFF",
    "Mercedes": "#00C2A0",
    "Ferrari": "#E8331A",
    "McLaren": "#F0A818",
    "Aston Martin": "#38A169",
    "Alpine": "#FF87BC",
    "Williams": "#64C4FF",
    "AlphaTauri": "#7B8EA3",
    "Haas F1 Team": "#C8C8C8",
    "Alfa Romeo": "#9B0000",
}

FALLBACK_RACES_2023 = [
    Race(round=1, name="Bahrain GP", circuit="Bahrain Intl Circuit", date="5 Mar", type="high-speed", flag="BH"),
    Race(round=2, name="Saudi Arabian GP", circuit="Jeddah Corniche", date="19 Mar", type="street", flag="SA"),
    Race(round=3, name="Australian GP", circuit="Albert Park", date="2 Apr", type="street", flag="AU"),
    Race(round=4, name="Azerbaijan GP", circuit="Baku City Circuit", date="30 Apr", type="street", flag="AZ"),
    Race(round=5, name="Miami GP", circuit="Miami Intl Autodrome", date="7 May", type="street", flag="US"),
    Race(round=6, name="Monaco GP", circuit="Circuit de Monaco", date="28 May", type="street", flag="MC"),
    Race(round=7, name="Spanish GP", circuit="Circuit de Barcelona", date="4 Jun", type="technical", flag="ES"),
    Race(round=8, name="Canadian GP", circuit="Circuit Gilles Villeneuve", date="18 Jun", type="street", flag="CA"),
    Race(round=9, name="Austrian GP", circuit="Red Bull Ring", date="2 Jul", type="high-speed", flag="AT"),
    Race(round=10, name="British GP", circuit="Silverstone", date="9 Jul", type="high-speed", flag="GB"),
    Race(round=11, name="Hungarian GP", circuit="Hungaroring", date="23 Jul", type="technical", flag="HU"),
    Race(round=12, name="Belgian GP", circuit="Spa-Francorchamps", date="30 Jul", type="high-speed", flag="BE"),
]

FALLBACK_DRIVERS_2023 = [
    Driver(code="VER", num=1, name="Max Verstappen", team="Red Bull Racing", color="#3B9EFF"),
    Driver(code="PER", num=11, name="Sergio Perez", team="Red Bull Racing", color="#3B9EFF"),
    Driver(code="HAM", num=44, name="Lewis Hamilton", team="Mercedes", color="#00C2A0"),
    Driver(code="RUS", num=63, name="George Russell", team="Mercedes", color="#00C2A0"),
    Driver(code="LEC", num=16, name="Charles Leclerc", team="Ferrari", color="#E8331A"),
    Driver(code="SAI", num=55, name="Carlos Sainz", team="Ferrari", color="#E8331A"),
    Driver(code="NOR", num=4, name="Lando Norris", team="McLaren", color="#F0A818"),
    Driver(code="PIA", num=81, name="Oscar Piastri", team="McLaren", color="#F0A818"),
    Driver(code="ALO", num=14, name="Fernando Alonso", team="Aston Martin", color="#38A169"),
    Driver(code="STR", num=18, name="Lance Stroll", team="Aston Martin", color="#38A169"),
]


@dataclass(frozen=True)
class RaceFilters:
    session_type: str = "all"
    circuit_type: str = "all"
    search: str = ""


def normalize_session_filter(value: str) -> set[str]:
    value = value.upper()
    if value == "ALL":
        return set()
    if value == "FP":
        return {"FP1", "FP2", "FP3"}
    if value == "Q":
        return {"Q", "Q1", "Q2", "Q3"}
    if value == "S":
        return {"S", "SQ"}
    return {value}


def list_races(db: Session, season: int, filters: RaceFilters) -> list[Race]:
    ensure_season_seeded(db, season)
    stmt = select(RaceORM).where(RaceORM.season == season).order_by(RaceORM.round)
    if filters.circuit_type != "all":
        stmt = stmt.where(RaceORM.type == filters.circuit_type)

    rows = list(db.scalars(stmt))
    races = [_race_from_orm(row) for row in rows]
    sessions = normalize_session_filter(filters.session_type)
    if sessions:
        races = [r for r in races if sessions.intersection(r.sessions)]
    if filters.search:
        needle = filters.search.lower()
        races = [r for r in races if needle in r.name.lower() or needle in r.circuit.lower()]
    return races


def get_race(db: Session, season: int, round_num: int) -> Race | None:
    ensure_season_seeded(db, season)
    row = db.scalar(select(RaceORM).where(RaceORM.season == season, RaceORM.round == round_num))
    return _race_from_orm(row) if row else None


def list_drivers(db: Session, season: int) -> list[Driver]:
    ensure_season_seeded(db, season)
    rows = db.scalars(select(DriverORM).where(DriverORM.season == season).order_by(DriverORM.id))
    return [_driver_from_orm(row) for row in rows]


def get_driver(db: Session, season: int, code: str) -> Driver | None:
    ensure_season_seeded(db, season)
    row = db.scalar(select(DriverORM).where(DriverORM.season == season, DriverORM.code == code.upper()))
    return _driver_from_orm(row) if row else None


def ensure_season_seeded(db: Session, season: int) -> None:
    has_races = db.scalar(select(RaceORM.id).where(RaceORM.season == season).limit(1))
    has_drivers = db.scalar(select(DriverORM.id).where(DriverORM.season == season).limit(1))
    if has_races and has_drivers:
        return

    races = fetch_ergast_races(season) or _fallback_races_for_season(season)
    drivers = fetch_openf1_drivers(season) or _fallback_drivers_for_season(season)
    upsert_races(db, season, races)
    upsert_drivers(db, season, drivers)
    db.commit()


def fetch_ergast_races(season: int) -> list[Race]:
    if not settings.use_live_data:
        return []
    url = f"{settings.ergast_base_url}/{season}.json"
    try:
        response = httpx.get(url, timeout=10)
        response.raise_for_status()
        payload = response.json()
        races = payload["MRData"]["RaceTable"]["Races"]
    except Exception:
        return []

    parsed: list[Race] = []
    for row in races:
        circuit_name = row["Circuit"]["circuitName"]
        country = row["Circuit"]["Location"].get("country", "")
        race_date = date.fromisoformat(row["date"])
        parsed.append(
            Race(
                round=int(row["round"]),
                name=row["raceName"].replace("Grand Prix", "GP"),
                circuit=circuit_name,
                date=f"{race_date.day} {race_date.strftime('%b')}",
                type=CIRCUIT_TYPES.get(circuit_name, "technical"),
                flag=COUNTRY_FLAGS.get(country, ""),
            )
        )
    return parsed


def fetch_openf1_drivers(season: int) -> list[Driver]:
    if not settings.use_live_data:
        return []
    try:
        meetings = httpx.get(f"{settings.openf1_base_url}/meetings?year={season}", timeout=10).json()
        if not meetings:
            return []
        session = httpx.get(
            f"{settings.openf1_base_url}/sessions?meeting_key={meetings[0]['meeting_key']}",
            timeout=10,
        ).json()[0]
        rows = httpx.get(
            f"{settings.openf1_base_url}/drivers?session_key={session['session_key']}",
            timeout=10,
        ).json()
    except Exception:
        return []

    drivers: dict[str, Driver] = {}
    for row in rows:
        code = row.get("name_acronym")
        if not code or code in drivers:
            continue
        team = row.get("team_name") or "Unknown"
        color = row.get("team_colour")
        drivers[code] = Driver(
            code=code,
            num=int(row.get("driver_number") or 0),
            name=row.get("full_name") or code,
            team=team,
            color=f"#{color}" if color else TEAM_COLORS.get(team, "#8A96A8"),
        )
    return list(drivers.values())


def upsert_races(db: Session, season: int, races: Iterable[Race]) -> None:
    for race in races:
        row = db.scalar(select(RaceORM).where(RaceORM.season == season, RaceORM.round == race.round))
        if row is None:
            row = RaceORM(season=season, round=race.round)
            db.add(row)
        row.name = race.name
        row.circuit = race.circuit
        row.date = race.date
        row.type = race.type
        row.flag = race.flag
        row.sessions = ",".join(race.sessions)


def upsert_drivers(db: Session, season: int, drivers: Iterable[Driver]) -> None:
    for driver in drivers:
        row = db.scalar(select(DriverORM).where(DriverORM.season == season, DriverORM.code == driver.code))
        if row is None:
            row = DriverORM(season=season, code=driver.code)
            db.add(row)
        row.num = driver.num
        row.name = driver.name
        row.team = driver.team
        row.color = driver.color


def _race_from_orm(row: RaceORM) -> Race:
    return Race(
        round=row.round,
        name=row.name,
        circuit=row.circuit,
        date=row.date,
        type=row.type,
        flag=row.flag,
        sessions=[s for s in row.sessions.split(",") if s],
    )


def _driver_from_orm(row: DriverORM) -> Driver:
    return Driver(code=row.code, num=row.num, name=row.name, team=row.team, color=row.color)


def _fallback_races_for_season(season: int) -> list[Race]:
    if season == 2023:
        return FALLBACK_RACES_2023
    return [race.model_copy(update={"date": race.date}) for race in FALLBACK_RACES_2023]


def _fallback_drivers_for_season(season: int) -> list[Driver]:
    return [driver.model_copy() for driver in FALLBACK_DRIVERS_2023]


def get_session_drivers_fastf1(year: int, round_num: int, session_code: str) -> list[Driver]:
    import fastf1

    fastf1.Cache.enable_cache(str(settings.fastf1_cache_dir))
    mapped_code = "Q" if session_code in {"Q1", "Q2", "Q3"} else session_code
    
    try:
        session = fastf1.get_session(year, round_num, mapped_code)
        session.load(telemetry=False, weather=False, messages=False, laps=True)
    except Exception:
        return []
        
    if getattr(session, 'laps', None) is None or session.laps.empty:
        return []

    quicklaps = session.laps.pick_quicklaps()
    if quicklaps.empty:
        # Fall back to all laps with a valid LapTime — drivers who completed
        # laps but none within the "quick" threshold should still be selectable.
        valid_laps = session.laps[session.laps["LapTime"].notna()]
        if valid_laps.empty:
            return []
        valid_driver_codes = set(valid_laps['Driver'].unique())
    else:
        valid_driver_codes = set(quicklaps['Driver'].unique())
    
    res = session.results
    drivers = []
    
    for _, row in res.iterrows():
        code = row.get("Abbreviation")
        if not code or str(code) not in valid_driver_codes:
            continue
            
        team = str(row.get("TeamName", "Unknown"))
        color = row.get("TeamColor")
        
        drivers.append(Driver(
            code=str(code),
            num=int(row.get("DriverNumber", 0)),
            name=str(row.get("BroadcastName", code)),
            team=team,
            color=f"#{color}" if color else TEAM_COLORS.get(team, "#8A96A8")
        ))
        
    return drivers


def resolve_session_drivers(year: int, round_num: int, session_code: str, code_a: str, code_b: str) -> tuple[Driver, Driver]:
    """Helper to load session drivers via FastF1 and resolve the two requested drivers."""
    code_a = code_a.upper()
    code_b = code_b.upper()
    
    logger.info(f"Resolving drivers for {year} Round {round_num} Session {session_code}")
    logger.info(f"Incoming driver codes: {code_a} vs {code_b}")
    
    session_drivers = get_session_drivers_fastf1(year, round_num, session_code)
    available_codes = [d.code for d in session_drivers]
    
    logger.info(f"Available session driver codes: {available_codes}")
    
    driver_a = next((d for d in session_drivers if d.code == code_a), None)
    driver_b = next((d for d in session_drivers if d.code == code_b), None)
    
    if driver_a and driver_b:
        logger.info(f"Resolved drivers: {driver_a.name} ({driver_a.team}) vs {driver_b.name} ({driver_b.team})")
    else:
        logger.warning(f"Driver validation failed. {code_a} found: {bool(driver_a)}, {code_b} found: {bool(driver_b)}")
        
    if not driver_a or not driver_b:
        raise ValueError(f"One or both drivers not found in session data (Available: {available_codes})")
        
    return driver_a, driver_b
