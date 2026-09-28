"""UWM/COADS (da Silva 1994) 1945-89 monthly climatology lookup.

Source files are sparse: each lists only ocean cells of a 1x1 degree grid
(`lat`/`lon` per point, `clm(mon, npoint)`), with no fill value. They are
scattered onto a dense (12, 180, 360) grid once per process and cached.
Missing cells are gap-filled from the nearest populated cell within
FILL_RADIUS_CELLS so ship tracks near coasts/ports still get a value.

Most SAMOS variables map to one file directly. A few are converted (RRATE)
or derived per observation from several files' looked-up values (DIR from
the mean wind vector, TD from mean specific humidity + pressure) -- these
are approximations: a quantity of monthly means is not the monthly mean of
the quantity.
"""
import logging
import re
import threading
from pathlib import Path
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import netCDF4
import numpy as np

from app import storage

logger = logging.getLogger(__name__)

FILL_RADIUS_CELLS = 2
# Below this mean-vector speed (m/s) the mean direction is meaningless.
MIN_MEAN_WIND_FOR_DIR = 0.5
# Raw int16 values the packed files use for overflow/missing.
_INT16_SENTINELS = (32767, -32768)


def _identity(values: np.ndarray) -> np.ndarray:
    return values


def _mm_per_3h_to_mm_per_min(values: np.ndarray) -> np.ndarray:
    return values / 180.0


def _wind_from_direction(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Meteorological (blowing-FROM, clockwise from north) mean-wind direction."""
    direction = np.degrees(np.arctan2(-u, -v)) % 360
    return np.where(np.hypot(u, v) < MIN_MEAN_WIND_FOR_DIR, np.nan, direction)


def _dewpoint(q_g_per_kg: np.ndarray, p_mb: np.ndarray) -> np.ndarray:
    """Dew point (C) from specific humidity and pressure, Magnus formula."""
    q = q_g_per_kg / 1000.0
    vapor_pressure = q * p_mb / (0.622 + 0.378 * q)
    with np.errstate(divide="ignore", invalid="ignore"):
        x = np.log(vapor_pressure / 6.112)
        td = 243.5 * x / (17.67 - x)
    return np.where(q_g_per_kg > 0, td, np.nan)


@dataclass(frozen=True)
class Source:
    files: Tuple[str, ...]
    # Receives one looked-up array per file, in `files` order.
    combine: Callable[..., np.ndarray] = _identity


SOURCES: Dict[str, Source] = {
    "T": Source(("atemp.nc",)),
    "RH": Source(("RH.NC",)),
    "P": Source(("SLP.NC",)),
    "TS": Source(("SST.NC",)),
    "SPD": Source(("W3.NC",)),
    "RAD_SW": Source(("SHORTRAD.NC",)),
    "RRATE": Source(("PRECIP6.NC",), _mm_per_3h_to_mm_per_min),
    "DIR": Source(("U3.NC", "V3.NC"), _wind_from_direction),
    "TD": Source(("QAIR.NC", "SLP.NC"), _dewpoint),
}

_cache: Dict[Path, np.ndarray] = {}
_cache_lock = threading.Lock()


def climatology_dir() -> Path:
    return storage.base_dir() / "climatology"


def climatology_source(var_name: str) -> Optional[Source]:
    """Climatology source for a SAMOS variable (`T2` -> same as `T`)."""
    return SOURCES.get(re.sub(r"\d+$", "", var_name))


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
        clm_var = ds.variables["clm"]
        clm = np.asarray(clm_var[:], dtype=float)
        clm_var.set_auto_scale(False)
        raw = np.asarray(clm_var[:])
    clm[np.isin(raw, _INT16_SENTINELS)] = np.nan

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
        source = climatology_source(name)
        if source is None:
            continue
        try:
            grids = [get_grid(filename) for filename in source.files]
        except (OSError, KeyError):
            logger.warning(
                "failed to load climatology for var %r (%s)", name, source.files,
                exc_info=True,
            )
            continue
        if any(grid is None for grid in grids):
            continue
        parts = [
            lookup(grid, track["lat"], track["lon"], track["month"]) for grid in grids
        ]
        with np.errstate(invalid="ignore"):
            values = source.combine(*parts)
        result[name] = [None if np.isnan(v) else float(v) for v in values]
    return result
