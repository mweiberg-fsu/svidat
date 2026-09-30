from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import storage, temp_sessions
from app.database import get_db
from app.deps import require_role
from app.file_locks import file_write_lock
from app.models import AuditLog, Lock, Role, User
from app.path_settings import configured_paths
from app.schemas import PublishRequest, SaveRequest
from app.session_lock import require_lock

router = APIRouter(tags=["workflow"])


def _copy_to_all(src: Path, dsts: List[Path]) -> None:
    """Copy src to every destination; stop at the first failure."""
    for dst in dsts:
        try:
            storage.atomic_copy(src, dst)
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"could not write {dst}: {exc}",
            )


@router.post("/save")
def save(
    payload: SaveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    try:
        temp = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not temp.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )
    require_lock(db, payload.filename, user)
    try:
        dsts = storage.draft_paths(
            user.username, payload.filename, configured_paths(db).draft
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    with file_write_lock(f"nc:{payload.filename}"):
        _copy_to_all(temp, dsts)
        temp.unlink(missing_ok=True)
        temp_sessions.mark_clean(db, payload.filename, user.id)
        db.add(AuditLog(filename=payload.filename, user_id=user.id, action="save"))
        lock = (
            db.query(Lock)
            .filter(Lock.filename == payload.filename, Lock.user_id == user.id)
            .first()
        )
        if lock:
            db.delete(lock)
        db.commit()
    return {"draft_path": str(dsts[0]), "draft_paths": [str(d) for d in dsts]}


@router.post("/publish")
def publish(
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    try:
        temp = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not temp.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )
    require_lock(db, payload.filename, user)
    try:
        dsts = storage.published_paths(
            payload.filename, configured_paths(db).published
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    with file_write_lock(f"nc:{payload.filename}"):
        _copy_to_all(temp, dsts)
        temp_sessions.mark_clean(db, payload.filename, user.id)
        db.add(AuditLog(filename=payload.filename, user_id=user.id, action="publish"))
        db.commit()
    return {
        "published_path": str(dsts[0]),
        "published_paths": [str(d) for d in dsts],
    }
