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
        if "is_admin" not in cols:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0")
            )
            conn.execute(
                text("ALTER TABLE users ADD COLUMN is_qca BOOLEAN NOT NULL DEFAULT 0")
            )
            # Backfill from the (now-legacy) single role column so existing
            # admins don't silently lose the edit access they had before —
            # role='admin' preserves today's effective permissions by getting
            # BOTH flags; an operator manually strips is_qca afterward from
            # whichever admins should lose edit access.
            conn.execute(text("UPDATE users SET is_admin = 1, is_qca = 1 WHERE role = 'admin'"))
            conn.execute(text("UPDATE users SET is_qca = 1 WHERE role = 'qca'"))
            conn.commit()
