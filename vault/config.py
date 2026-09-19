from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore", populate_by_name=True)
    gemini_api_key: SecretStr = Field(
        default=SecretStr(""), validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY")
    )
    gemini_model: str = "gemini-2.5-flash"
    eval_backend: Literal["local", "modal"] = "local"
    logfire_token: SecretStr = SecretStr("")
    modal_token_id: str = ""
    modal_token_secret: SecretStr = SecretStr("")
    max_sessions: int = 100
    session_ttl_seconds: int = 7200
    agent_timeout_seconds: int = 60
