#!/usr/bin/env python3
"""Create an admin (+QCA) user if it doesn't already exist.

Run from server/ with the backend venv's python:
    python scripts/create_admin.py <username>

The password is read from SVIDAT_ADMIN_PASSWORD, or prompted for when unset
(never taken as an argument, so it doesn't show up in `ps` or shell history).
"""
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models  # noqa: E402,F401 - registers tables on Base.metadata
from app.database import Base, SessionLocal, engine, run_migrations  # noqa: E402
from app.models import Role, User  # noqa: E402
from app.security import hash_password  # noqa: E402


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        sys.exit("usage: create_admin.py <username>")
    username = sys.argv[1].strip()

    Base.metadata.create_all(bind=engine)
    run_migrations()

    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            print(f"User '{username}' already exists, skipping.")
            return
        password = os.environ.get("SVIDAT_ADMIN_PASSWORD")
        if not password:
            if not sys.stdin.isatty():
                sys.exit("Set SVIDAT_ADMIN_PASSWORD to create an admin non-interactively.")
            password = getpass.getpass("Admin password: ")
            if password != getpass.getpass("Confirm password: "):
                sys.exit("Passwords did not match.")
        if not password:
            sys.exit("Empty password.")
        db.add(
            User(
                username=username,
                password_hash=hash_password(password),
                role=Role.admin,
                is_admin=True,
                is_qca=True,
            )
        )
        db.commit()
        print(f"Created admin user '{username}'.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
