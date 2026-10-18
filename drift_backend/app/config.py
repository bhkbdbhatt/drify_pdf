from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    anthropic_api_key: str = ""

    database_url: str = "sqlite:///./drift.db"

    llm_timeout: float = 120.0
    llm_max_retries: int = 3
    llm_retry_base_delay: float = 1.0
    llm_inter_run_delay: float = 1.0

    uploads_dir: str = "uploads"
    max_document_chars: int = 60_000

    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://localhost:5173"]
    )

    stable_consistency_threshold: float = 0.95
    drift_consistency_threshold: float = 0.5
    numeric_relative_tolerance: float = 0.01
    max_unique_values: int = 25


@lru_cache
def get_settings() -> Settings:
    return Settings()
