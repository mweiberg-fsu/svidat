"""Server-side folder browser for the admin Paths tab.

A browser's own folder picker only sees the viewer's machine and never
reveals absolute paths, so the Paths tab browses the *server's* disk
through this instead. Lists folder names only (no files, no contents);
admin-only at the route, the same reach the Paths settings already give.
"""
import os
from typing import List, Optional, TypedDict

# Keeps a huge folder (e.g. one holding every raw file as a subfolder) from
# producing an unwieldy response; `truncated` tells the UI.
MAX_ENTRIES = 1000


class DirEntry(TypedDict):
    name: str
    path: str
    readable: bool
    writable: bool


def _can_read(path: str) -> bool:
    return os.access(path, os.R_OK | os.X_OK)


def _can_write(path: str) -> bool:
    return os.access(path, os.W_OK | os.X_OK)


def list_directory(path: str) -> dict:
    """{path, parent, readable, writable, dirs, truncated} for `path`.

    Raises ValueError (message names the path) if `path` isn't an absolute,
    existing, listable directory. Hidden (dot) folders are skipped."""
    path = path.strip()
    if not path or "\x00" in path or not os.path.isabs(path):
        raise ValueError(f"{path or '(blank)'} must be an absolute path")
    path = os.path.normpath(path)
    if not os.path.exists(path):
        raise ValueError(f"{path} does not exist")
    if not os.path.isdir(path):
        raise ValueError(f"{path} is not a directory")

    dirs: List[DirEntry] = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                if entry.name.startswith("."):
                    continue
                try:
                    if not entry.is_dir():
                        continue
                except OSError:
                    continue
                dirs.append(
                    {
                        "name": entry.name,
                        "path": entry.path,
                        "readable": _can_read(entry.path),
                        "writable": _can_write(entry.path),
                    }
                )
    except OSError as exc:
        raise ValueError(f"cannot read {path}: {exc.strerror or exc}") from exc

    dirs.sort(key=lambda d: d["name"].lower())
    parent: Optional[str] = os.path.dirname(path)
    if parent == path:
        parent = None
    return {
        "path": path,
        "parent": parent,
        "readable": _can_read(path),
        "writable": _can_write(path),
        "dirs": dirs[:MAX_ENTRIES],
        "truncated": len(dirs) > MAX_ENTRIES,
    }
