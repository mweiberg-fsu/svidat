from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Lock, User


def require_lock(db: Session, filename: str, user: User) -> None:
    lock = db.query(Lock).filter(Lock.filename == filename).first()
    if lock is None or lock.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="no active edit lock for this file",
        )
