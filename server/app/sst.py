"""Point SST lookups for the ship-track "Values" readout.

Same dataset as the client's SST map layer (client/src/sstLayer.ts): NOAA
OISST v2.1 daily 0.25 deg, via CoastWatch ERDDAP. ERDDAP's griddap answers
single-point queries but sends no CORS headers, so the browser can't call it
directly; this proxies the lookup and caches it per grid cell and day.
"""
import math
import socket
import threading
from collections import OrderedDict
from typing import Optional, Tuple
from urllib.parse import quote

import httpcore
import httpx

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap"
DATASET = "ncdcOisst21Agg_LonPM180"
TIMEOUT_S = 10.0
CONNECT_TIMEOUT_S = 3.0
GRID_STEP = 0.25
MAX_LAT = 89.875
MAX_LON = 179.875
CACHE_SIZE = 10000


class _IPv4Backend(httpcore.SyncBackend):
    """Connects over IPv4 only. The ERDDAP host publishes an AAAA record
    whose route can be dead (connects hang); httpx's sync connect tries it
    first with no fast fallback, so every lookup stalled for the whole
    connect timeout before reaching IPv4 (curl falls back in milliseconds).
    TLS still verifies against the request's hostname, not this IP."""

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        last_exc: Optional[Exception] = None
        for *_, sockaddr in socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM):
            try:
                return super().connect_tcp(sockaddr[0], port, timeout, local_address, socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_exc = exc
        raise last_exc or httpcore.ConnectError(f"no IPv4 address for {host}")


def _make_client() -> httpx.Client:
    transport = httpx.HTTPTransport(retries=1)
    transport._pool._network_backend = _IPv4Backend()
    # One shared client: keep-alive skips the TLS handshake on repeat lookups.
    return httpx.Client(transport=transport, timeout=httpx.Timeout(TIMEOUT_S, connect=CONNECT_TIMEOUT_S))


_client = _make_client()


class SstUnavailable(Exception):
    """ERDDAP couldn't be reached or answered with something unusable."""


def snap(value: float, limit: float = MAX_LAT) -> float:
    """Centre of the 0.25 deg OISST cell containing `value` (x.125, x.375,
    ...), clamped to the grid's outermost centres."""
    centre = math.floor(value / GRID_STEP) * GRID_STEP + GRID_STEP / 2
    return max(-limit, min(limit, centre))


def _fetch(date: str, lat: float, lon: float) -> Optional[float]:
    """SST (deg C) at a grid-cell centre for `date` (YYYY-MM-DD); None over
    land. Raises SstUnavailable on any network or format problem."""
    # OISST's daily fields are stamped at noon UTC.
    query = f"sst[({date}T12:00:00Z)][(0.0)][({lat})][({lon})]"
    url = f"{ERDDAP}/griddap/{DATASET}.json?{quote(query, safe='')}"
    try:
        resp = _client.get(url)
        resp.raise_for_status()
        table = resp.json()["table"]
        row = table["rows"][0]
        value = row[table["columnNames"].index("sst")]
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
        raise SstUnavailable(str(exc)) from exc
    return None if value is None else float(value)


_cache: "OrderedDict[Tuple[str, float, float], Optional[float]]" = OrderedDict()
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def sst_at(date: str, lat: float, lon: float) -> dict:
    """{date, lat, lon, sst} for the grid cell containing (lat, lon).
    Failures aren't cached, so a later request retries ERDDAP."""
    key = (date, snap(lat, MAX_LAT), snap(lon, MAX_LON))
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            value = _cache[key]
            return {"date": date, "lat": key[1], "lon": key[2], "sst": value}
    value = _fetch(*key)
    with _cache_lock:
        _cache[key] = value
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return {"date": date, "lat": key[1], "lon": key[2], "sst": value}
