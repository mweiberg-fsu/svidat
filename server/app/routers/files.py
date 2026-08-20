import re
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import netcdf_ops, storage
from app.database import get_db
from app.deps import get_current_user
from app.file_locks import file_write_lock
from app.models import Lock, User

router = APIRouter(prefix="/files", tags=["files"])

CATALOG_FILENAME_RE = re.compile(r"^([A-Za-z0-9]+)_(\d{4})\d{4}v\d+$")


@router.get("/raw")
def list_raw(_: User = Depends(get_current_user)):
    raw_dir = storage.base_dir() / "raw"
    if not raw_dir.exists():
        return []
    return sorted(p.stem for p in raw_dir.glob("*.nc"))


@router.get("/drafts")
def list_drafts(
    username: Optional[str] = None, user: User = Depends(get_current_user)
):
    target = username or user.username
    if target != user.username and not (user.is_admin or user.is_qca):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="cannot view another user's drafts",
        )
    try:
        storage.validate_segment(target, "username")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    draft_dir = storage.base_dir() / "drafts" / target / "v250"
    if not draft_dir.exists():
        return []
    return sorted(p.stem.replace("_v250", "") for p in draft_dir.glob("*_v250.nc"))


@router.get("/catalog")
def file_catalog(_: User = Depends(get_current_user)):
    raw_dir = storage.base_dir() / "raw"
    if not raw_dir.exists():
        return {}

    catalog: dict = defaultdict(lambda: defaultdict(list))
    for path in raw_dir.glob("*.nc"):
        stem = path.stem
        match = CATALOG_FILENAME_RE.match(stem)
        if not match:
            continue
        ship, year = match.group(1), match.group(2)
        catalog[ship][year].append(stem)

    return {
        ship: {year: sorted(files) for year, files in sorted(years.items())}
        for ship, years in sorted(catalog.items())
    }


@router.get("/{filename}/metadata")
def file_metadata(filename: str, _: User = Depends(get_current_user)):
    try:
        path = storage.raw_path(filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="file not found"
        )
    try:
        return netcdf_ops.get_metadata(path)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("/{filename}/data")
def file_data(
    filename: str,
    vars: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    var_names = [v for v in vars.split(",") if v]
    if not var_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="vars is required"
        )
    try:
        path = storage.raw_path(filename)
        # If the requesting user has an open edit session for this file,
        # read their in-progress temp copy instead of the untouched raw
        # file, so a flag/point/bulk edit is reflected immediately without
        # requiring a save/publish round-trip first.
        lock = (
            db.query(Lock)
            .filter(Lock.filename == filename, Lock.user_id == user.id)
            .first()
        )
        if lock is not None:
            session_path = storage.temp_path(user.username, filename)
            if session_path.exists():
                path = session_path
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="file not found"
        )
    try:
        # Same lock key convention as the write-side background jobs
        # (point/bulk/flag edits) — makes this read mutually exclusive with
        # any in-flight write to the temp copy, closing the race where a
        # background job has the file open in "r+" mode while we read it.
        with file_write_lock(f"nc:{filename}"):
            return netcdf_ops.get_variable_data(path, var_names)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"unknown variable: {exc}"
        )
