#!/usr/bin/env python3
"""Set up svidat: backend venv, frontend deps, optional admin user.

Usage:
  python3 install.py                      # interactive (local dev)
  python3 install.py --yes --build        # non-interactive, e.g. in a container / over SSH
  SVIDAT_ADMIN_PASSWORD=... python3 install.py --yes --admin-user admin

Safe to re-run: existing venv, .env and users are left alone.
"""
import argparse
import os
import platform
import re
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


def run(cmd, cwd=None, env=None):
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        die(f"command failed: {' '.join(str(c) for c in cmd)}")


def node_version_ok(version):
    # Vite 8 requires Node ^20.19 or >=22.12.
    match = re.match(r"v?(\d+)\.(\d+)", version)
    if not match:
        return False
    major, minor = int(match.group(1)), int(match.group(2))
    if major >= 23 or (major == 22 and minor >= 12):
        return True
    return major == 20 and minor >= 19


def check_prereqs(skip_frontend):
    print("Checking prerequisites...")
    if sys.version_info < (3, 10):
        die(f"Python 3.10+ required, found {platform.python_version()}.")
    if sys.version_info >= (3, 13):
        die(
            f"Python {platform.python_version()} detected. The pinned backend "
            "dependencies (numpy, netCDF4) don't yet ship wheels for Python 3.13+. "
            "Re-run with Python 3.10-3.12, e.g. `python3.12 install.py`."
        )
    if not skip_frontend:
        if shutil.which("node") is None:
            die("Node.js not found on PATH. Install Node 20.19+ or 22.12+ from https://nodejs.org/ and re-run.")
        if shutil.which("npm") is None:
            die("npm not found on PATH. It ships with Node.js — https://nodejs.org/")
        version = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
        if not node_version_ok(version):
            die(f"Node.js {version} is too old for Vite 8. Install Node 20.19+ or 22.12+.")
    print("  OK")


def create_venv():
    if VENV_PYTHON.exists():
        print(f"Backend venv already exists at {VENV_DIR}, skipping creation.")
        return
    print(f"Creating backend venv at {VENV_DIR}...")
    result = subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)])
    if result.returncode != 0:
        die(
            "could not create a venv. On Debian/Ubuntu install the venv module "
            f"first (e.g. `apt install python3.{sys.version_info.minor}-venv`)."
        )


def install_backend_deps():
    print("Installing backend dependencies...")
    run([str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
    run([str(VENV_PYTHON), "-m", "pip", "install", "-r", "requirements.txt"], cwd=SERVER_DIR)


def write_env_file():
    env_path = SERVER_DIR / ".env"
    if env_path.exists():
        print(f"{env_path} already exists, leaving it as-is.")
        return
    if os.environ.get("SECRET_KEY"):
        print("SECRET_KEY set in the environment, not writing server/.env.")
        return
    print(f"Writing {env_path} with a generated SECRET_KEY...")
    secret_key = secrets.token_hex(32)
    env_path.write_text(f"SECRET_KEY={secret_key}\n")


def install_frontend_deps():
    print("Installing frontend dependencies...")
    npm = shutil.which("npm")
    # npm ci: exact lockfile install, reproducible across machines/containers.
    cmd = "ci" if (CLIENT_DIR / "package-lock.json").exists() else "install"
    run([npm, cmd], cwd=CLIENT_DIR)


def build_frontend():
    print("Building frontend (API via same-origin /api proxy)...")
    env = {**os.environ, "VITE_API_URL": os.environ.get("VITE_API_URL", "/api")}
    run([shutil.which("npm"), "run", "build"], cwd=CLIENT_DIR, env=env)


def create_admin(username):
    run([str(VENV_PYTHON), "scripts/create_admin.py", username], cwd=SERVER_DIR)


def maybe_create_admin(args):
    if args.admin_user:
        create_admin(args.admin_user)
        return
    if args.yes:
        return
    answer = input("\nCreate an admin user now? [Y/n] ").strip().lower()
    if answer not in ("", "y", "yes"):
        return
    username = input("Admin username: ").strip()
    if not username:
        print("No username entered, skipping admin creation.")
        return
    create_admin(username)


def print_next_steps():
    if IS_WINDOWS:
        activate = r"server\.venv\Scripts\activate"
    else:
        activate = "source server/.venv/bin/activate"
    print(
        f"""
Setup complete.

Production-like (backend + built frontend, one port to expose, default 4173):
  ./start.sh

Development:
  {activate}
  cd server
  uvicorn app.main:app --reload --port 8000
  # in another terminal:
  cd client
  npm run dev
"""
    )


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "-y", "--yes", action="store_true",
        help="non-interactive: never prompt (implied when stdin is not a terminal)",
    )
    parser.add_argument(
        "--admin-user", metavar="NAME",
        help="create this admin user if missing (password from SVIDAT_ADMIN_PASSWORD, else prompted)",
    )
    parser.add_argument("--skip-frontend", action="store_true", help="backend only; don't touch Node/npm")
    parser.add_argument("--build", action="store_true", help="also build the frontend for ./start.sh")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        args.yes = True
    if args.skip_frontend and args.build:
        parser.error("--build needs the frontend; drop --skip-frontend")
    return args


def main():
    args = parse_args()
    check_prereqs(args.skip_frontend)
    create_venv()
    install_backend_deps()
    write_env_file()
    if not args.skip_frontend:
        install_frontend_deps()
        if args.build:
            build_frontend()
    maybe_create_admin(args)
    print_next_steps()


if __name__ == "__main__":
    main()
