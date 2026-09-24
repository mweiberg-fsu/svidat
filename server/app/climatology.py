"""UWM/COADS (da Silva 1994) 1945-89 monthly climatology lookup.

Source files are sparse: each lists only ocean cells of a 1x1 degree grid
(`lat`/`lon` per point, `clm(mon, npoint)`), with no fill value. They are
scattered onto a dense (12, 180, 360) grid once per process and cached.
Missing cells are gap-filled from the nearest populated cell within
FILL_RADIUS_CELLS so ship tracks near coasts/ports still get a value.
"""
import logging
import re
import threading
from pathlib import Path
from typing import Dict, List, Optional

import netCDF4
import numpy as np

from app import storage

logger = logging.getLogger(__name__)

VAR_TO_FILE = {
    "T": "atemp.nc",
    "RH": "RH.NC",
    "P": "SLP.NC",
    "TS": "SST.NC",
    "SPD": "W3.NC",
}
FILL_RADIUS_CELLS = 2

_cache: Dict[Path, np.ndarray] = {}
_cache_lock = threading.Lock()


def climatology_dir() -> Path:
    return storage.base_dir() / "climatology"


def climatology_key(var_name: str) -> Optional[str]:
    """Climatology filename for a SAMOS variable (`T2` -> `atemp.nc`)."""
    return VAR_TO_FILE.get(re.sub(r"\d+$", "", var_name))


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _fill_offsets(radius: int):
    offsets = [
        (dr, dc)
        for dr in range(-radius, radius + 1)
        for dc in range(-radius, radius + 1)
        if 0 < dr * dr + dc * dc <= radius * radius
    ]
    return sorted(offsets, key=lambda o: (o[0] ** 2 + o[1] ** 2, o[0], o[1]))


def _shifted(grid: np.ndarray, dr: int, dc: int) -> np.ndarray:
    """out[:, r, c] = grid[:, r + dr, (c + dc) % 360]; rows off the edge are NaN."""
    rolled = np.roll(grid, -dc, axis=2)
    out = np.full_like(grid, np.nan)
    if dr > 0:
        out[:, :-dr] = rolled[:, dr:]
    elif dr < 0:
        out[:, -dr:] = rolled[:, :dr]
    else:
        out[:] = rolled
    return out


def _build_grid(path: Path) -> np.ndarray:
    with netCDF4.Dataset(path, "r") as ds:
        ds.set_auto_mask(False)
        lat = np.asarray(ds.variables["lat"][:], dtype=float)
        lon = np.asarray(ds.variables["lon"][:], dtype=float)
        clm = np.asarray(ds.variables["clm"][:], dtype=float)

    rows = np.rint(lat + 89.5).astype(int)
    cols = np.rint(lon - 0.5).astype(int) % 360
    grid = np.full((12, 180, 360), np.nan)
    grid[:, rows, cols] = clm

    filled = grid.copy()
    for dr, dc in _fill_offsets(FILL_RADIUS_CELLS):
        candidate = _shifted(grid, dr, dc)
        take = np.isnan(filled) & ~np.isnan(candidate)
        filled[take] = candidate[take]
    return filled


def get_grid(filename: str) -> Optional[np.ndarray]:
    path = climatology_dir() / filename
    with _cache_lock:
        if path in _cache:
            return _cache[path]
        if not path.exists():
            return None
        grid = _build_grid(path)
        grid.flags.writeable = False
        _cache[path] = grid
        return grid


def lookup(
    grid: np.ndarray, lats: np.ndarray, lons: np.ndarray, months: np.ndarray
) -> np.ndarray:
    lats = np.asarray(lats, dtype=float)
    lons = np.asarray(lons, dtype=float)
    months = np.asarray(months, dtype=int)
    out = np.full(lats.shape, np.nan)
    ok = (
        np.isfinite(lats)
        & np.isfinite(lons)
        & (lats >= -90)
        & (lats <= 90)
        & (months >= 1)
        & (months <= 12)
    )
    rows = np.clip(np.floor(lats[ok] + 90).astype(int), 0, 179)
    cols = np.floor(np.mod(lons[ok], 360)).astype(int) % 360
    out[ok] = grid[months[ok] - 1, rows, cols]
    return out


def series_for_track(
    track: Dict[str, np.ndarray], var_names: List[str]
) -> Dict[str, List[Optional[float]]]:
    """Per-obs climatology for each supported var; unsupported/missing omitted."""
    result: Dict[str, List[Optional[float]]] = {}
    for name in var_names:
        filename = climatology_key(name)
        if filename is None:
            continue
        try:
            grid = get_grid(filename)
        except (OSError, KeyError):
            logger.warning(
                "failed to load climatology grid %s for var %r", filename, name,
                exc_info=True,
            )
            continue
        if grid is None:
            continue
        values = lookup(grid, track["lat"], track["lon"], track["month"])
        result[name] = [None if np.isnan(v) else float(v) for v in values]
    return result
