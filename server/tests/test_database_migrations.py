import sqlite3

from sqlalchemy import create_engine, text

from app.database import run_migrations


def _make_legacy_users_table(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE users ("
        "id INTEGER PRIMARY KEY, "
        "username VARCHAR UNIQUE NOT NULL, "
        "password_hash VARCHAR NOT NULL, "
        "role VARCHAR NOT NULL, "
        "avatar_path VARCHAR, "
        "created_at DATETIME)"
    )
    conn.commit()
    conn.close()


def test_run_migrations_adds_auth_provider_column(tmp_path):
    db_path = tmp_path / "legacy.db"
    _make_legacy_users_table(db_path)
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
    assert "auth_provider" in cols


def test_run_migrations_is_idempotent(tmp_path):
    db_path = tmp_path / "legacy2.db"
    _make_legacy_users_table(db_path)
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)
    run_migrations(engine)  # must not raise on second call

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
    assert cols.count("auth_provider") == 1


def test_run_migrations_backfills_existing_rows_with_local(tmp_path):
    db_path = tmp_path / "legacy3.db"
    _make_legacy_users_table(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('frank', 'x', 'user')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        row = conn.execute(text("SELECT auth_provider FROM users WHERE username = 'frank'")).first()
    assert row[0] == "local"
