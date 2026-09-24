import os
import shutil
from pathlib import Path

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
    shutil.copyfile(src, tmp_dst)
    os.replace(tmp_dst, dst)
