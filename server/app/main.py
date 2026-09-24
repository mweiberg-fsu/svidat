from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.database import Base, engine, run_migrations
from app.routers import admin, audit, auth, config, edit, files, session, theme, users, workflow

Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(title="svidat")

MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024  # 10MB — generous ceiling for any current endpoint


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length is not None and int(content_length) > MAX_REQUEST_BODY_BYTES:
            return JSONResponse(
                status_code=413, content={"detail": "request body too large"}
            )
        return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added AFTER CORSMiddleware: in Starlette, middleware added later wraps
# middleware added earlier, so this becomes the OUTERMOST layer and runs
# FIRST on every request (before CORS, before routing/dependency
# resolution). Verified empirically in tests/test_main.py — an oversized
# Content-Length is rejected with 413 without a CORS header check ever
# running and without the route body being touched.
app.add_middleware(BodySizeLimitMiddleware)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(users.router)
app.include_router(files.router)
app.include_router(session.router)
app.include_router(edit.router)
app.include_router(workflow.router)
app.include_router(audit.router)
app.include_router(theme.router)
app.include_router(config.router)


@app.get("/health")
def health():
    return {"status": "ok"}
