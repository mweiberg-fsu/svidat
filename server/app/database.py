from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

engine = create_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations(bind=None) -> None:
    """Idempotently bring an existing SQLite DB's schema up to date.

    Base.metadata.create_all only adds missing tables, never alters existing
    ones — so columns added to models.py need a hand-written, idempotent
    migration here, checked via PRAGMA table_info before ALTER TABLE.
    """
    bind = bind or engine
    with bind.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
        if "auth_provider" not in cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN auth_provider VARCHAR NOT NULL DEFAULT 'local'")
            )
            conn.commit()
