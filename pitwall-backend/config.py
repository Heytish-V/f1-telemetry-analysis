from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "PitWall F1 Telemetry API"
    api_prefix: str = "/api"
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    database_url: str = "sqlite:///./pitwall.db"
    redis_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    telemetry_data_dir: Path = Path("./data/telemetry")
    fastf1_cache_dir: Path = Path("./data/fastf1-cache")
    reports_dir: Path = Path("./data/reports")

    use_live_data: bool = True
    openf1_base_url: str = "https://api.openf1.org/v1"
    ergast_base_url: str = "https://api.jolpi.ca/ergast/f1"

    distance_samples: int = 1000
    ensemble_min_laps: int = 3
    ensemble_max_laps: int = 5
    insight_consistency_threshold: float = 0.60


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.telemetry_data_dir.mkdir(parents=True, exist_ok=True)
    settings.fastf1_cache_dir.mkdir(parents=True, exist_ok=True)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    return settings
