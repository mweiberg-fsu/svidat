import re
from collections import defaultdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import climatology, netcdf_ops, storage
from app.database import get_db
from app.deps import get_current_user
from app.file_locks import file_write_lock
from app.models import Lock, User
from app.path_settings import configured_paths

router = APIRouter(prefix="/files", tags=["files"])

CATALOG_FILENAME_RE = re.compile(r"^([A-Za-z0-9]+)_(\d{4})\d{4}v\d+$")


@router.get("/raw")
def list_raw(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    return sorted(storage.list_raw_files(configured_paths(db).raw))


@router.get("/drafts")
def list_drafts(
    username: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
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
    return storage.list_drafts(target, configured_paths(db).draft)


@router.get("/catalog")
def file_catalog(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    catalog: dict = defaultdict(lambda: defaultdict(list))
    for stem in storage.list_raw_files(configured_paths(db).raw):
        match = CATALOG_FILENAME_RE.match(stem)
        if not match:
            continue
        ship, year = match.group(1), match.group(2)
        catalog[ship][year].append(stem)

    return {
        ship: {year: sorted(files) for year, files in sorted(years.items())}
        for ship, years in sorted(catalog.items())
    }


# Ship display names, keyed by call sign and cached against the file they
# were read from — a newer file for that ship (possibly after a rename)
# invalidates the entry on the next request.
_ship_name_cache: dict[str, tuple[str, Optional[str]]] = {}


@router.get("/ships")
def ship_names(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    """Call sign -> ship name (the `site` global attribute of that ship's
    latest raw file, or None if it has none)."""
    files = storage.list_raw_files(configured_paths(db).raw)

    latest: dict[str, str] = {}
    for stem in files:
        match = CATALOG_FILENAME_RE.match(stem)
        if match and stem > latest.get(match.group(1), ""):
            latest[match.group(1)] = stem

    names: dict[str, Optional[str]] = {}
    for ship, stem in sorted(latest.items()):
        cached = _ship_name_cache.get(ship)
        key = str(files[stem])
        if cached is None or cached[0] != key:
            cached = (key, netcdf_ops.read_site_name(files[stem]))
            _ship_name_cache[ship] = cached
        names[ship] = cached[1]
    return names


@router.get("/{filename}/metadata")
def file_metadata(
    filename: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    try:
        path = storage.find_raw(filename, configured_paths(db).raw)
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


def _resolve_read_path(filename: str, db: Session, user: User) -> Path:
    try:
        path = storage.find_raw(filename, configured_paths(db).raw)
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
    return path


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
    path = _resolve_read_path(filename, db, user)
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


@router.get("/{filename}/climatology")
def file_climatology(
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
    path = _resolve_read_path(filename, db, user)
    try:
        # Same mutex as /data — lat/lon may be mid-write by an edit job.
        with file_write_lock(f"nc:{filename}"):
            track = netcdf_ops.get_track(path)
    except KeyError:
        return {"variables": {}}
    return {"variables": climatology.series_for_track(track, var_names)}
