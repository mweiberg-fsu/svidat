from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    data_dir: str = "./data"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    database_url: str = "sqlite:///./svidat.db"
    google_client_id: str = ""
    microsoft_client_id: str = ""
    # Comma-separated browser origins allowed to call the API directly. Not
    # needed when the frontend goes through vite's /api proxy (start.sh, Docker).
    cors_origins: str = "http://localhost:5173,http://localhost:4173"


settings = Settings()
