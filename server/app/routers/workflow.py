from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import require_role
from app.file_locks import file_write_lock
from app.models import AuditLog, Role, User
from app.schemas import PublishRequest, SaveRequest
from app.session_lock import require_lock

router = APIRouter(tags=["workflow"])


@router.post("/save")
def save(
    payload: SaveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
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
    dst = storage.draft_path(user.username, payload.filename)
    with file_write_lock(f"nc:{payload.filename}"):
        storage.atomic_copy(temp, dst)
    db.add(AuditLog(filename=payload.filename, user_id=user.id, action="save"))
    db.commit()
    return {"draft_path": str(dst)}


@router.post("/publish")
def publish(
    payload: PublishRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
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
    dst = storage.published_path(payload.filename)
    with file_write_lock(f"nc:{payload.filename}"):
        storage.atomic_copy(temp, dst)
    db.add(AuditLog(filename=payload.filename, user_id=user.id, action="publish"))
    db.commit()
    return {"published_path": str(dst)}
