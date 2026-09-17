from datetime import datetime

from sqlalchemy.orm import Session

from app.models import TempSession


def _query(db: Session, filename: str, user_id: int):
    return db.query(TempSession).filter(
        TempSession.filename == filename, TempSession.user_id == user_id
    )


def get_or_create(db: Session, filename: str, user_id: int) -> TempSession:
    ts = _query(db, filename, user_id).first()
    if ts is None:
        ts = TempSession(filename=filename, user_id=user_id, dirty=False)
        db.add(ts)
    return ts


def reset(db: Session, filename: str, user_id: int) -> TempSession:
    ts = get_or_create(db, filename, user_id)
    ts.created_at = datetime.utcnow()
    ts.dirty = False
    ts.last_edited_at = None
    db.add(ts)
    return ts


def mark_dirty(db: Session, filename: str, user_id: int) -> None:
    ts = _query(db, filename, user_id).first()
    if ts is not None:
        ts.dirty = True
        ts.last_edited_at = datetime.utcnow()
        db.add(ts)


def mark_clean(db: Session, filename: str, user_id: int) -> None:
    ts = _query(db, filename, user_id).first()
    if ts is not None:
        ts.dirty = False
        db.add(ts)
