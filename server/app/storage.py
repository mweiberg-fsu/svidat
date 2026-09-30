import os
import shutil
from pathlib import Path
from typing import Dict, List

from app.config import settings


def base_dir() -> Path:
    return Path(settings.data_dir)


def validate_segment(value: str, label: str) -> None:
    if not value or "/" in value or "\\" in value or value in (".", ".."):
        raise ValueError(f"invalid {label}: {value!r}")


def raw_path(filename: str) -> Path:
    validate_segment(filename, "filename")
    return base_dir() / "raw" / f"{filename}.nc"


def temp_path(username: str, filename: str) -> Path:
    validate_segment(username, "username")
    validate_segment(filename, "filename")
    return base_dir() / "temp" / username / f"{filename}_temp.nc"


def draft_path(username: str, filename: str) -> Path:
    validate_segment(username, "username")
    validate_segment(filename, "filename")
    return base_dir() / "drafts" / username / "v250" / f"{filename}_v250.nc"


def published_path(filename: str) -> Path:
    validate_segment(filename, "filename")
    return base_dir() / "published" / f"{filename}_v300.nc"


def audit_blob_path(audit_id: int) -> Path:
    return base_dir() / "audit_blobs" / f"{audit_id}.npy"


def avatar_path(user_id: int, ext: str) -> Path:
    return base_dir() / "avatars" / f"{user_id}.{ext}"


def logo_path(ext: str) -> Path:
    return base_dir() / "branding" / f"logo.{ext}"


def atomic_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp_dst = dst.with_suffix(dst.suffix + ".tmp")
    try:
        shutil.copyfile(src, tmp_dst)
        os.replace(tmp_dst, dst)
    except BaseException:
        tmp_dst.unlink(missing_ok=True)
        raise


# Configurable dirs (app/path_settings.py). Each helper takes the admin's
# configured list for its stage; an empty list means the default layout
# under DATA_DIR (raw_path/draft_path/published_path above).


def _exists(p: Path) -> bool:
    # Path.exists()/is_dir() raise PermissionError on EACCES (py3.9).
    try:
        return p.exists()
    except OSError:
        return False


def _is_dir(p: Path) -> bool:
    try:
        return p.is_dir()
    except OSError:
        return False


def raw_dirs(configured: List[Path]) -> List[Path]:
    return list(configured) or [base_dir() / "raw"]


def find_raw(filename: str, configured: List[Path]) -> Path:
    """First raw dir holding {filename}.nc; else the first candidate (so the
    caller's .exists() check reports it missing)."""
    validate_segment(filename, "filename")
    if not configured:
        return raw_path(filename)
    candidates = [d / f"{filename}.nc" for d in configured]
    return next((p for p in candidates if _exists(p)), candidates[0])


def list_raw_files(configured: List[Path]) -> Dict[str, Path]:
    """Stem -> path of every raw *.nc; the earlier dir wins a duplicate."""
    files: Dict[str, Path] = {}
    for d in raw_dirs(configured):
        if _is_dir(d):
            try:
                found = sorted(d.glob("*.nc"))
            except OSError:
                continue
            for p in found:
                files.setdefault(p.stem, p)
    return files


def draft_paths(username: str, filename: str, configured: List[Path]) -> List[Path]:
    """Every v250 destination; configured dirs get a per-user subfolder."""
    if not configured:
        return [draft_path(username, filename)]
    validate_segment(username, "username")
    validate_segment(filename, "filename")
    return [d / username / f"{filename}_v250.nc" for d in configured]


def find_draft(username: str, filename: str, configured: List[Path]) -> Path:
    candidates = draft_paths(username, filename, configured)
    return next((p for p in candidates if _exists(p)), candidates[0])


def list_drafts(username: str, configured: List[Path]) -> List[str]:
    validate_segment(username, "username")
    if configured:
        dirs = [d / username for d in configured]
    else:
        dirs = [base_dir() / "drafts" / username / "v250"]
    stems = set()
    for d in dirs:
        if not _is_dir(d):
            continue
        try:
            found = list(d.glob("*_v250.nc"))
        except OSError:
            continue
        stems.update(p.stem[: -len("_v250")] for p in found)
    return sorted(stems)


def published_paths(filename: str, configured: List[Path]) -> List[Path]:
    if not configured:
        return [published_path(filename)]
    validate_segment(filename, "filename")
    return [d / f"{filename}_v300.nc" for d in configured]
