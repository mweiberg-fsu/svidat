import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app import storage
from app.models import PathSettings


@dataclass
class PathLists:
    raw: List[Path]
    draft: List[Path]
    published: List[Path]


def get_or_create_path_settings(db: Session) -> PathSettings:
    row = db.query(PathSettings).first()
    if row is None:
        row = PathSettings()
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _load(raw: Optional[str]) -> List[str]:
    return json.loads(raw) if raw else []


def stored_lists(row: PathSettings) -> Dict[str, List[str]]:
    return {
        "raw_dirs": _load(row.raw_dirs),
        "draft_dirs": _load(row.draft_dirs),
        "published_dirs": _load(row.published_dirs),
    }


def configured_paths(db: Session) -> PathLists:
    """The admin-configured dirs; empty lists mean "use the default"."""
    lists = stored_lists(get_or_create_path_settings(db))
    return PathLists(
        raw=[Path(p) for p in lists["raw_dirs"]],
        draft=[Path(p) for p in lists["draft_dirs"]],
        published=[Path(p) for p in lists["published_dirs"]],
    )


def default_paths() -> Dict[str, str]:
    base = storage.base_dir()
    return {
        "raw": str(base / "raw"),
        "draft": str(base / "drafts"),
        "published": str(base / "published"),
    }


def settings_to_dict(row: PathSettings) -> dict:
    return {**stored_lists(row), "defaults": default_paths()}
