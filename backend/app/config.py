from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, model_validator

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    app_env: str = "development"
    mongodb_uri: str = ""
    mongodb_database: str = "ip_sakti"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = Field(default=768, ge=128, le=3072)
    retrieval_candidates: int = Field(default=25, ge=1, le=100)
    retrieval_shortlist: int = Field(default=20, ge=1, le=100)
    retrieval_final_k: int = Field(default=8, ge=1, le=20)
    retrieval_context_chars: int = Field(default=24000, ge=2000, le=60000)
    langsmith_tracing: bool = False
    langsmith_api_key: str = ""
    langsmith_project: str = "ip-sakti-development"
    langsmith_endpoint: str = "https://api.smith.langchain.com"
    langsmith_capture_content: bool = False
    ragas_judge_model: str = "gemini-2.5-flash"
    app_origin: str = "http://127.0.0.1:5173"
    clerk_secret_key: str = ""
    clerk_jwt_key: str = ""
    data_dir: str = "data"
    bhashini_url: str = ""
    bhashini_api_key: str = ""
    bhashini_asr_service: str = ""
    bhashini_tts_service: str = ""
    bhashini_translation_service: str = ""

    @model_validator(mode="after")
    def secure_production(self):
        if self.app_env == "production" and not self.app_origin.startswith("https://"):
            raise ValueError("Production requires an HTTPS origin")
        return self

    @property
    def storage_path(self) -> Path:
        return (ROOT / self.data_dir).resolve()
