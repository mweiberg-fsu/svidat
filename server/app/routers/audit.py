import json
from datetime import datetime
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import netcdf_ops, storage, temp_sessions
from app.database import get_db
from app.deps import get_current_user, require_role
from app.file_locks import file_write_lock
from app.models import AuditLog, Role, User
from app.session_lock import require_lock

router = APIRouter(prefix="/audit", tags=["audit"])


def _serialize_entry(e: AuditLog, username: Optional[str], include_filename: bool = False) -> dict:
    row = {
        "id": e.id,
        "user_id": e.user_id,
        "username": username,
        "action": e.action,
        "var_name": e.var_name,
        "old_value": e.old_value_scalar,
        "new_value": e.new_value_scalar if e.new_value_scalar is not None else e.new_value_str,
        "reverted": e.reverted,
        "timestamp": e.timestamp.isoformat(),
    }
    if include_filename:
        row["filename"] = e.filename
    return row


# Empty string (not "/") — under this router's "/audit" prefix, this maps
# to exactly GET /audit with no trailing slash. Same idiom already used in
# app/routers/users.py for its own bare-prefix routes.
@router.get("")
def my_history(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    entries = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id)
        .order_by(AuditLog.timestamp.desc())
        .all()
    )
    return [_serialize_entry(e, user.username, include_filename=True) for e in entries]


@router.get("/{filename}")
def history(
    filename: str,
    since: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(AuditLog).filter(AuditLog.filename == filename)
    if since is not None:
        try:
            since_dt = datetime.fromisoformat(since)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="invalid since timestamp"
            )
        # Scoping to "this session" also means "this user" — only the lock
        # holder can write entries during an open session, so filtering to
        # the current user is redundant in practice but makes the intent
        # explicit and keeps this query safe if that invariant ever changes.
        query = query.filter(AuditLog.timestamp >= since_dt, AuditLog.user_id == user.id)
    entries = query.order_by(AuditLog.timestamp.asc()).all()
    user_ids = {e.user_id for e in entries}
    usernames = {
        u.id: u.username
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    }
    return [_serialize_entry(e, usernames.get(e.user_id)) for e in entries]


@router.post("/{audit_id}/revert")
def revert(
    audit_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    entry = db.query(AuditLog).filter(AuditLog.id == audit_id).first()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="audit entry not found"
        )
    if entry.action not in ("point_edit", "bulk_edit", "flag_edit"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="entry not revertible"
        )
    if entry.reverted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="already reverted"
        )

    require_lock(db, entry.filename, user)

    try:
        path = storage.temp_path(user.username, entry.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    # Perform the actual restore (and validate the stored blob/values) BEFORE
    # claiming the entry as reverted. If this fails we must not leave a
    # reverted=True row with no successful restore behind it.
    if entry.action == "point_edit":
        indices = json.loads(entry.indices_json)
        try:
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_point(path, entry.var_name, indices, entry.old_value_scalar)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_scalar=entry.new_value_scalar,
            new_value_scalar=entry.old_value_scalar,
        )
    elif entry.action == "bulk_edit":
        slices = [tuple(pair) for pair in json.loads(entry.indices_json)]
        try:
            old_values = np.load(entry.old_value_ref)
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_bulk(path, entry.var_name, slices, old_values)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )
    else:  # flag_edit
        start_idx, end_idx = json.loads(entry.indices_json)
        try:
            old_values = np.load(entry.old_value_ref)
            with file_write_lock(f"nc:{entry.filename}"):
                netcdf_ops.restore_flags(path, entry.var_name, start_idx, end_idx, old_values)
        except (OSError, ValueError, KeyError, IndexError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
            )
        new_log = AuditLog(
            filename=entry.filename,
            user_id=user.id,
            action="revert",
            var_name=entry.var_name,
            indices_json=entry.indices_json,
            old_value_ref=entry.old_value_ref,
        )

    # Atomically claim this entry so a concurrent revert of the same audit_id can't
    # also pass the check above and insert its own "revert" audit row after the
    # restore above already ran. Runs inside its own file_write_lock (separate
    # from each branch's own restore-lock above, which has already been
    # released) so this claim/insert/mark_dirty/commit can't interleave with a
    # concurrent save/publish/edit on the same file.
    with file_write_lock(f"nc:{entry.filename}"):
        claimed = (
            db.query(AuditLog)
            .filter(AuditLog.id == audit_id, AuditLog.reverted == False)  # noqa: E712
            .update({"reverted": True})
        )
        if claimed == 0:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="already reverted"
            )

        db.add(new_log)
        temp_sessions.mark_dirty(db, entry.filename, user.id)
        db.commit()
    return {"status": "reverted"}
