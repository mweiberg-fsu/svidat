import json

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import jobs, netcdf_ops, storage, temp_sessions
from app.database import SessionLocal, get_db
from app.deps import require_role
from app.file_locks import file_write_lock
from app.models import AuditLog, Role, User
from app.schemas import BulkEditRequest, FlagEditRequest, PointEditRequest
from app.session_lock import require_lock

router = APIRouter(prefix="/edit", tags=["edit"])


@router.post("/point")
def point_edit(
    payload: PointEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    try:
        path = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    require_lock(db, payload.filename, user)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    try:
        with file_write_lock(f"nc:{payload.filename}"):
            old_value = netcdf_ops.write_point(path, payload.var_name, payload.indices, payload.value)
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid edit for var '{payload.var_name}': {exc}",
        )

    log = AuditLog(
        filename=payload.filename,
        user_id=user.id,
        action="point_edit",
        var_name=payload.var_name,
        indices_json=json.dumps(payload.indices),
        old_value_scalar=old_value,
        new_value_scalar=payload.value,
    )
    db.add(log)
    temp_sessions.mark_dirty(db, payload.filename, user.id)
    db.commit()
    db.refresh(log)
    return {"audit_id": log.id, "old_value": old_value, "new_value": payload.value}


@router.post("/bulk")
def bulk_edit(
    payload: BulkEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    try:
        path = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    require_lock(db, payload.filename, user)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    slices = [tuple(pair) for pair in payload.slices]
    user_id = user.id

    def run_bulk_edit() -> dict:
        job_db = SessionLocal()
        try:
            with file_write_lock(f"nc:{payload.filename}"):
                old_values = netcdf_ops.write_bulk(
                    path, payload.var_name, slices, payload.value, payload.op
                )

                log = AuditLog(
                    filename=payload.filename,
                    user_id=user_id,
                    action="bulk_edit",
                    var_name=payload.var_name,
                    indices_json=json.dumps(payload.slices),
                    new_value_scalar=payload.value,
                )
                job_db.add(log)
                temp_sessions.mark_dirty(job_db, payload.filename, user_id)
                job_db.commit()
                job_db.refresh(log)

                blob_path = storage.audit_blob_path(log.id)
                blob_path.parent.mkdir(parents=True, exist_ok=True)
                np.save(blob_path, old_values)
                log.old_value_ref = str(blob_path)
                job_db.commit()
            return {"audit_id": log.id}
        finally:
            job_db.close()

    job_id = jobs.submit_job(run_bulk_edit)
    return {"job_id": job_id}


@router.get("/jobs/{job_id}")
def job_status(job_id: str, _: User = Depends(require_role(Role.qca))):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")
    return {"status": job.status.value, "error": job.error, "result": job.result}


@router.post("/flag")
def flag_edit(
    payload: FlagEditRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_role(Role.qca)),
):
    try:
        path = storage.temp_path(user.username, payload.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    require_lock(db, payload.filename, user)
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="no open session for this file"
        )

    user_id = user.id

    def run_flag_edit() -> dict:
        job_db = SessionLocal()
        try:
            with file_write_lock(f"nc:{payload.filename}"):
                old_values = netcdf_ops.write_flags(
                    path,
                    payload.var_name,
                    payload.start_time_idx,
                    payload.end_time_idx,
                    payload.flag_code,
                )

                log = AuditLog(
                    filename=payload.filename,
                    user_id=user_id,
                    action="flag_edit",
                    var_name=payload.var_name,
                    indices_json=json.dumps([payload.start_time_idx, payload.end_time_idx]),
                    new_value_str=payload.flag_code,
                )
                job_db.add(log)
                temp_sessions.mark_dirty(job_db, payload.filename, user_id)
                job_db.commit()
                job_db.refresh(log)

                blob_path = storage.audit_blob_path(log.id)
                blob_path.parent.mkdir(parents=True, exist_ok=True)
                np.save(blob_path, old_values)
                log.old_value_ref = str(blob_path)
                job_db.commit()
            return {"audit_id": log.id}
        finally:
            job_db.close()

    job_id = jobs.submit_job(run_flag_edit)
    return {"job_id": job_id}
