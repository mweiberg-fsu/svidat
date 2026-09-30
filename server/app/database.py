from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

from app import storage
from app.config import settings
from app.usernames import username_from_email

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
        if "keybindings" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN keybindings TEXT"))
            conn.commit()
        if "custom_triggers" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN custom_triggers TEXT"))
            conn.commit()
        if "email" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
            conn.commit()
        # Same name SQLAlchemy gives the model's unique index, so a fresh DB
        # built by create_all doesn't get a second one.
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
        conn.commit()
        _move_oauth_addresses_to_email(conn)
        theme_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(theme_settings)"))]
        # Empty list means the table doesn't exist yet; create_all will build
        # it with every column, so there's nothing to alter.
        if theme_cols and "site_name" not in theme_cols:
            conn.execute(
                text("ALTER TABLE theme_settings ADD COLUMN site_name VARCHAR NOT NULL DEFAULT 'SVIDAT'")
            )
            conn.commit()
        if theme_cols and "logo_path" not in theme_cols:
            conn.execute(text("ALTER TABLE theme_settings ADD COLUMN logo_path VARCHAR"))
            conn.commit()
        if theme_cols and "save_draft_label" not in theme_cols:
            conn.execute(
                text(
                    "ALTER TABLE theme_settings ADD COLUMN save_draft_label VARCHAR NOT NULL "
                    "DEFAULT 'Save draft (v250)'"
                )
            )
            conn.commit()
        if theme_cols and "publish_label" not in theme_cols:
            conn.execute(
                text(
                    "ALTER TABLE theme_settings ADD COLUMN publish_label VARCHAR NOT NULL "
                    "DEFAULT 'Publish (v300)'"
                )
            )
            conn.commit()
        config_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(app_config)"))]
        # Same as theme_settings: no table yet means create_all builds it whole.
        if config_cols and "custom_triggers" not in config_cols:
            conn.execute(text("ALTER TABLE app_config ADD COLUMN custom_triggers TEXT"))
            conn.commit()


def _move_oauth_addresses_to_email(conn) -> None:
    """OAuth accounts created before User.email existed used the full address
    as their username. Move it into email and rename them to the local part
    (app/usernames.py), carrying their temp/drafts folders along, since those
    are keyed by username. Idempotent: converted rows have an email."""
    rows = conn.execute(
        text(
            "SELECT id, username FROM users "
            "WHERE email IS NULL AND auth_provider != 'local' AND username LIKE '%@%'"
        )
    ).all()
    if not rows:
        return
    taken = {row[0] for row in conn.execute(text("SELECT username FROM users"))}
    stage_dirs = [storage.base_dir() / "temp", storage.base_dir() / "drafts"]
    for stage in stage_dirs:
        if stage.is_dir():
            taken.update(p.name for p in stage.iterdir())
    for user_id, old in rows:
        new = username_from_email(old, taken)
        taken.add(new)
        conn.execute(
            text("UPDATE users SET username = :new, email = :email WHERE id = :id"),
            {"new": new, "email": old.strip().lower(), "id": user_id},
        )
        conn.commit()
        for stage in stage_dirs:
            if (stage / old).is_dir():
                (stage / old).rename(stage / new)
