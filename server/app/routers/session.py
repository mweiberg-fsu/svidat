from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import storage
from app.database import get_db
from app.deps import require_role
from app.models import Lock, Role, User

router = APIRouter(prefix="/session", tags=["session"])


@router.post("/{filename}/open")
def open_session(
    filename: str,
    source: str = "raw",
    source_username: Optional[str] = None,
    force: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    try:
        dst = storage.temp_path(user.username, filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    existing_lock = db.query(Lock).filter(Lock.filename == filename).first()
    if existing_lock and existing_lock.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"locked by user_id={existing_lock.user_id} "
                f"since {existing_lock.acquired_at.isoformat()}"
            ),
        )

    need_copy = not dst.exists() or force
    src = None
    if need_copy:
        try:
            if source == "raw":
                src = storage.raw_path(filename)
            elif source == "draft":
                src = storage.draft_path(source_username or user.username, filename)
            elif source == "temp":
                src = storage.temp_path(source_username or user.username, filename)
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="invalid source"
                )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
        if not src.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="source file not found"
            )

    # All validation passed — safe to acquire the lock and perform the copy.
    if existing_lock is None:
        db.add(Lock(filename=filename, user_id=user.id, acquired_at=datetime.utcnow()))
        db.commit()

    if need_copy:
        storage.atomic_copy(src, dst)

    return {"temp_path": str(dst)}


@router.post("/{filename}/close")
def close_session(
    filename: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.admin, Role.qca)),
):
    lock = (
        db.query(Lock)
        .filter(Lock.filename == filename, Lock.user_id == user.id)
        .first()
    )
    if lock:
        db.delete(lock)
        db.commit()
    return {"status": "closed"}
