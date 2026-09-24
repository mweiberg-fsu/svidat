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


def _make_legacy_users_table_with_auth_provider(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE users ("
        "id INTEGER PRIMARY KEY, "
        "username VARCHAR UNIQUE NOT NULL, "
        "password_hash VARCHAR NOT NULL, "
        "role VARCHAR NOT NULL, "
        "avatar_path VARCHAR, "
        "auth_provider VARCHAR NOT NULL DEFAULT 'local', "
        "created_at DATETIME)"
    )
    conn.commit()
    conn.close()


def test_run_migrations_adds_role_flag_columns(tmp_path):
    db_path = tmp_path / "legacy4.db"
    _make_legacy_users_table_with_auth_provider(db_path)
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
    assert "is_admin" in cols
    assert "is_qca" in cols


def test_run_migrations_backfills_admin_role_to_both_flags(tmp_path):
    db_path = tmp_path / "legacy5.db"
    _make_legacy_users_table_with_auth_provider(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('adminuser', 'x', 'admin')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT is_admin, is_qca FROM users WHERE username = 'adminuser'")
        ).first()
    assert row[0] == 1
    assert row[1] == 1


def test_run_migrations_backfills_qca_role_to_qca_flag_only(tmp_path):
    db_path = tmp_path / "legacy6.db"
    _make_legacy_users_table_with_auth_provider(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('qcauser', 'x', 'qca')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT is_admin, is_qca FROM users WHERE username = 'qcauser'")
        ).first()
    assert row[0] == 0
    assert row[1] == 1


def test_run_migrations_backfills_user_role_to_no_flags(tmp_path):
    db_path = tmp_path / "legacy7.db"
    _make_legacy_users_table_with_auth_provider(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('plainuser', 'x', 'user')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)

    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT is_admin, is_qca FROM users WHERE username = 'plainuser'")
        ).first()
    assert row[0] == 0
    assert row[1] == 0


def test_run_migrations_role_flags_idempotent(tmp_path):
    db_path = tmp_path / "legacy8.db"
    _make_legacy_users_table_with_auth_provider(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES ('adminuser2', 'x', 'admin')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)
    run_migrations(engine)  # must not raise, must not re-run the backfill UPDATEs

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(users)"))]
        row = conn.execute(
            text("SELECT is_admin, is_qca FROM users WHERE username = 'adminuser2'")
        ).first()
    assert cols.count("is_admin") == 1
    assert cols.count("is_qca") == 1
    assert row[0] == 1
    assert row[1] == 1


def test_run_migrations_adds_theme_branding_columns(tmp_path):
    db_path = tmp_path / "legacy_theme.db"
    _make_legacy_users_table(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE theme_settings ("
        "id INTEGER PRIMARY KEY, "
        "primary_color VARCHAR NOT NULL, "
        "secondary_color VARCHAR NOT NULL, "
        "tertiary_color VARCHAR NOT NULL)"
    )
    conn.execute(
        "INSERT INTO theme_settings (primary_color, secondary_color, tertiary_color) "
        "VALUES ('#111111', '#222222', '#333333')"
    )
    conn.commit()
    conn.close()
    engine = create_engine(f"sqlite:///{db_path}")

    run_migrations(engine)
    run_migrations(engine)  # idempotent

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(theme_settings)"))]
        row = conn.execute(
            text("SELECT site_name, logo_path, save_draft_label, publish_label FROM theme_settings")
        ).one()
    assert cols.count("site_name") == 1
    assert cols.count("logo_path") == 1
    assert cols.count("save_draft_label") == 1
    assert cols.count("publish_label") == 1
    assert row == ("SVIDAT", None, "Save draft (v250)", "Publish (v300)")
