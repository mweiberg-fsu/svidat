#!/usr/bin/env python3
"""Set up svidat for local development: backend venv, frontend deps, optional admin user.

Usage: python3 install.py   (or `python install.py` on Windows)
"""
import getpass
import platform
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
SERVER_DIR = ROOT_DIR / "server"
CLIENT_DIR = ROOT_DIR / "client"
VENV_DIR = SERVER_DIR / ".venv"
IS_WINDOWS = platform.system() == "Windows"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


def die(message):
    print(f"\nERROR: {message}", file=sys.stderr)
    sys.exit(1)


def run(cmd, cwd=None):
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    if result.returncode != 0:
        die(f"command failed: {' '.join(str(c) for c in cmd)}")


def check_prereqs():
    print("Checking prerequisites...")
    if sys.version_info < (3, 10):
        die(f"Python 3.10+ required, found {platform.python_version()}.")
    if sys.version_info >= (3, 13):
        die(
            f"Python {platform.python_version()} detected. The pinned backend "
            "dependencies (numpy, netCDF4) don't yet ship wheels for Python 3.13+. "
            "Re-run with Python 3.10-3.12, e.g. `python3.12 install.py`."
        )
    if shutil.which("node") is None:
        die("Node.js not found on PATH. Install it from https://nodejs.org/ and re-run.")
    if shutil.which("npm") is None:
        die("npm not found on PATH. It ships with Node.js — https://nodejs.org/")
    print("  OK")


def create_venv():
    if VENV_PYTHON.exists():
        print(f"Backend venv already exists at {VENV_DIR}, skipping creation.")
        return
    print(f"Creating backend venv at {VENV_DIR}...")
    run([sys.executable, "-m", "venv", str(VENV_DIR)])


def install_backend_deps():
    print("Installing backend dependencies...")
    run([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([str(VENV_PYTHON), "-m", "pip", "install", "-r", "requirements.txt"], cwd=SERVER_DIR)


def write_env_file():
    env_path = SERVER_DIR / ".env"
    if env_path.exists():
        print(f"{env_path} already exists, leaving it as-is.")
        return
    print(f"Writing {env_path} with a generated SECRET_KEY...")
    secret_key = secrets.token_hex(32)
    env_path.write_text(f"SECRET_KEY={secret_key}\n")


def install_frontend_deps():
    print("Installing frontend dependencies...")
    npm = shutil.which("npm")
    run([npm, "install"], cwd=CLIENT_DIR)


ADMIN_SCRIPT = """
import sys
from app import models  # noqa: F401 - registers tables on Base.metadata
from app.database import Base, engine, SessionLocal
from app.models import User, Role
from app.security import hash_password

Base.metadata.create_all(bind=engine)

username = sys.argv[1]
password = sys.argv[2]

db = SessionLocal()
try:
    if db.query(User).filter(User.username == username).first():
        print(f"User '{username}' already exists, skipping.")
    else:
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
"""


def maybe_create_admin():
    answer = input("\nCreate an admin user now? [Y/n] ").strip().lower()
    if answer not in ("", "y", "yes"):
        return
    username = input("Admin username: ").strip()
    if not username:
        print("No username entered, skipping admin creation.")
        return
    password = getpass.getpass("Admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords did not match, skipping admin creation.")
        return
    run([str(VENV_PYTHON), "-c", ADMIN_SCRIPT, username, password], cwd=SERVER_DIR)


def print_next_steps():
    if IS_WINDOWS:
        activate = r"server\.venv\Scripts\activate"
    else:
        activate = "source server/.venv/bin/activate"
    print(
        f"""
Setup complete.

To run the backend:
  {activate}
  cd server
  uvicorn app.main:app --reload --port 8000

To run the frontend (in another terminal):
  cd client
  npm run dev
"""
    )


def main():
    check_prereqs()
    create_venv()
    install_backend_deps()
    write_env_file()
    install_frontend_deps()
    maybe_create_admin()
    print_next_steps()


if __name__ == "__main__":
    main()
