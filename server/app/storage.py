import os
import shutil
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

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


def _norm(p: Path) -> str:
    return os.path.normpath(str(p))


def raw_dirs(configured: List[Path]) -> List[Path]:
    """Configured raw dirs (first wins), then the default dir as a fallback
    for reads. Empty configured list means just the default."""
    default = base_dir() / "raw"
    dirs = list(configured)
    if _norm(default) not in {_norm(d) for d in dirs}:
        dirs.append(default)
    return dirs


def find_raw(filename: str, configured: List[Path]) -> Path:
    """First raw dir holding {filename}.nc, at its top level or anywhere
    below it; else the first top-level candidate (so the caller's .exists()
    check reports it missing)."""
    validate_segment(filename, "filename")
    dirs = raw_dirs(configured)
    for d in dirs:
        direct = d / f"{filename}.nc"
        if _exists(direct):
            return direct
        if _is_dir(d):
            nested = _raw_tree(d).get(filename)
            if nested is not None:
                return nested
    return dirs[0] / f"{filename}.nc"


def list_raw_files(configured: List[Path]) -> Dict[str, Path]:
    """Stem -> path of every *.nc in or below the raw dirs. The earlier dir
    wins a duplicate, and within a dir the shallower file does."""
    files: Dict[str, Path] = {}
    for d in raw_dirs(configured):
        if _is_dir(d):
            for stem, p in _raw_tree(d).items():
                files.setdefault(stem, p)
    return files


# Raw dirs may be nested trees (e.g. SAMOS <SHIP>/<YEAR>/*.nc, ~100k files
# on NFS). Each folder's listing is cached against its mtime, so a repeat
# scan only stats the folders and re-lists the ones whose entries changed;
# each root's finished stem -> path map is cached against the mtimes of every
# folder in it, so an unchanged tree also skips rebuilding ~100k Paths.
# Folders modified in the last few seconds aren't cached: an entry added in
# the same mtime tick as a listing would otherwise be missed until the next
# change to that folder.
_DIR_CACHE_MIN_AGE_NS = 2_000_000_000
# path -> (mtime_ns, sorted *.nc names, sorted subfolder names)
_dir_cache: Dict[str, Tuple[int, List[str], List[str]]] = {}
# root -> (((path, mtime_ns), ...) of every folder in the tree, stem -> path)
_tree_cache: Dict[str, Tuple[Tuple[Tuple[str, int], ...], Dict[str, Path]]] = {}
_dir_cache_lock = threading.Lock()


def _list_dir(path: str) -> Optional[Tuple[int, List[str], List[str], bool]]:
    """(mtime_ns, *.nc names, subfolder names, cacheable) or None if
    unreadable."""
    try:
        mtime = os.stat(path).st_mtime_ns
    except OSError:
        return None
    with _dir_cache_lock:
        cached = _dir_cache.get(path)
    if cached is not None and cached[0] == mtime:
        return mtime, cached[1], cached[2], True
    files: List[str] = []
    subdirs: List[str] = []
    try:
        with os.scandir(path) as it:
            for entry in it:
                # Trust the name for *.nc: is_dir() costs a stat per entry
                # when the filesystem (NFSv3) doesn't report entry types,
                # which is most of the time on a 100k-file tree.
                if entry.name.endswith(".nc"):
                    files.append(entry.name)
                else:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            subdirs.append(entry.name)
                    except OSError:
                        pass
    except OSError:
        return None
    files.sort()
    subdirs.sort()
    cacheable = time.time_ns() - mtime >= _DIR_CACHE_MIN_AGE_NS
    with _dir_cache_lock:
        if cacheable:
            _dir_cache[path] = (mtime, files, subdirs)
        else:
            _dir_cache.pop(path, None)
    return mtime, files, subdirs, cacheable


def _raw_tree(root: Path) -> Dict[str, Path]:
    """Stem -> path of every *.nc under root, breadth-first (shallower files
    win a duplicate stem), not following symlinked folders. The returned
    dict may be shared with the cache: don't mutate it."""
    listings: List[Tuple[str, List[str]]] = []
    signature: List[Tuple[str, int]] = []
    cacheable = True
    level = [str(root)]
    while level:
        next_level: List[str] = []
        for path in level:
            listing = _list_dir(path)
            if listing is None:
                continue
            mtime, files, subdirs, ok = listing
            cacheable = cacheable and ok
            signature.append((path, mtime))
            listings.append((path, files))
            next_level.extend(os.path.join(path, s) for s in subdirs)
        level = next_level

    key = str(root)
    sig = tuple(signature)
    with _dir_cache_lock:
        cached = _tree_cache.get(key)
    if cacheable and cached is not None and cached[0] == sig:
        return cached[1]

    found: Dict[str, Path] = {}
    for path, files in listings:
        folder = Path(path)
        for name in files:
            stem = name[:-3]
            if stem not in found:
                found[stem] = folder / name
    with _dir_cache_lock:
        if cacheable:
            _tree_cache[key] = (sig, found)
        else:
            _tree_cache.pop(key, None)
    return found


def draft_paths(username: str, filename: str, configured: List[Path]) -> List[Path]:
    """Every v250 write destination; configured dirs get a per-user
    subfolder. Configured-only (legacy layout when none are configured)."""
    if not configured:
        return [draft_path(username, filename)]
    validate_segment(username, "username")
    validate_segment(filename, "filename")
    return [d / username / f"{filename}_v250.nc" for d in configured]


def _draft_read_paths(username: str, filename: str, configured: List[Path]) -> List[Path]:
    paths = draft_paths(username, filename, configured)
    legacy = draft_path(username, filename)
    if _norm(legacy) not in {_norm(p) for p in paths}:
        paths.append(legacy)
    return paths


def find_draft(username: str, filename: str, configured: List[Path]) -> Path:
    """First existing draft (configured dirs, then legacy); else the first
    write destination."""
    candidates = _draft_read_paths(username, filename, configured)
    return next((p for p in candidates if _exists(p)), candidates[0])


def list_drafts(username: str, configured: List[Path]) -> List[str]:
    validate_segment(username, "username")
    dirs = [d / username for d in configured]
    dirs.append(base_dir() / "drafts" / username / "v250")
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
