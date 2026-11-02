# svidat

netCDF QC web app: FastAPI backend (`server/`) + React frontend (`client/`).

Requirements: Python 3.10–3.12, Node 20.19+ or 22.12+ (or just Docker/Podman).

## Run on a server

`./start.sh` serves the built frontend on port 4173 and proxies `/api` to the
backend, which listens on 127.0.0.1 only — so **4173 is the only port to
expose or forward**.

### Docker / Podman

```bash
cp .env.example .env && chmod 600 .env   # set SVIDAT_ADMIN_PASSWORD, port, etc.
docker compose up -d --build
```

All settings (port, admin bootstrap, `SECRET_KEY`, SSO client IDs, any backend
setting from `server/app/config.py`) live in `.env`; see `.env.example`.

Compose runs two containers: `backend` (uvicorn, built from `server/Dockerfile`,
not published) and `frontend` (nginx serving the built app and proxying `/api`
to the backend, built from `client/Dockerfile`, published on `SVIDAT_PORT`,
default 8080). The SQLite database lives in the `svidat-data` volume.

Single-container alternative (backend + `vite preview` via `start.sh`):

```bash
docker build -t svidat .
docker run -d --name svidat -p 4173:4173 -v svidat-data:/data \
  -e SVIDAT_ADMIN_USER=admin -e SVIDAT_ADMIN_PASSWORD='change-me' svidat
```

- `/data` holds the database, netCDF storage tree and generated secret key; keep it on a volume.
- The admin is only created if missing, so the password env var only matters on first start.
- Ship data elsewhere on the host: mount it (e.g. `-v /net/samos:/samos:ro`) and add the path under **Admin → Paths**.
- Google/Microsoft login: `--build-arg VITE_GOOGLE_CLIENT_ID=… --build-arg VITE_MS_CLIENT_ID=…`, plus the same IDs at runtime as `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID`.

### Without containers (or inside an existing one)

```bash
python3 install.py --yes --build                              # non-interactive
SVIDAT_ADMIN_PASSWORD='change-me' python3 install.py --yes --admin-user admin
python3 install.py --backend    # or --frontend [--build]: set up just one half
SKIP_BUILD=1 ./start.sh
```

### Reaching it

- SSH tunnel: `ssh -L 4173:localhost:4173 user@server`, then open http://localhost:4173.
- By hostname (http://server:4173): set `VITE_ALLOWED_HOSTS=server.example.edu`
  (or `all`; the Docker image defaults to `all`) — vite rejects unknown Host headers otherwise.
  Not needed with compose (nginx accepts any Host).

`start.sh` env vars: `FRONTEND_PORT` (4173), `FRONTEND_HOST` (0.0.0.0),
`BACKEND_PORT` (8000), `BACKEND_HOST` (127.0.0.1), `SKIP_BUILD`,
`VITE_ALLOWED_HOSTS`, `SVIDAT_ADMIN_USER`/`SVIDAT_ADMIN_PASSWORD`. Backend
settings (`DATA_DIR`, `DATABASE_URL`, `SECRET_KEY`, `CORS_ORIGINS`, …) come from
the environment or `server/.env` — see `server/app/config.py`.

## Development

```bash
python3 install.py
cd server && .venv/bin/uvicorn app.main:app --reload --port 8000
cd client && npm run dev        # talks to http://localhost:8000 directly
```
