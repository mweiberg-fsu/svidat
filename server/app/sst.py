"""Point SST lookups for the ship-track "Values" readout, and which SST
dataset to show for a day.

NOAA OISST v2.1 daily 0.25 deg, via CoastWatch ERDDAP. The final dataset
trails real time by about two weeks; for days it doesn't have yet, the
preliminary (near-real-time) one is used instead (see source_for). The
client's SST map layer (client/src/sstLayer.ts) asks /files/sst-source which
of the two to draw, so the map and the point readout always agree.

ERDDAP's griddap answers single-point queries but sends no CORS headers, so
the browser can't call it directly; this proxies the lookup and caches it per
dataset, grid cell and day.
"""
import math
import socket
import threading
import time
from collections import OrderedDict
from typing import Dict, Optional, Tuple
from urllib.parse import quote

import httpcore
import httpx

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap"
FINAL_DATASET = "ncdcOisst21Agg_LonPM180"
PRELIMINARY_DATASET = "ncdcOisst21NrtAgg_LonPM180"
TIMEOUT_S = 10.0
CONNECT_TIMEOUT_S = 3.0
GRID_STEP = 0.25
MAX_LAT = 89.875
MAX_LON = 179.875
CACHE_SIZE = 10000
# ERDDAP has spells of brief 503s/timeouts; retry those (not 4xx answers).
RETRIES = 2
RETRY_DELAY_S = 0.5
# How long a dataset's last day is trusted before asking ERDDAP again (each
# dataset gains a day roughly daily).
LATEST_TTL_S = 3600.0


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


class SstNoData(Exception):
    """Neither dataset has SST for the requested day (yet)."""


def snap(value: float, limit: float = MAX_LAT) -> float:
    """Centre of the 0.25 deg OISST cell containing `value` (x.125, x.375,
    ...), clamped to the grid's outermost centres."""
    centre = math.floor(value / GRID_STEP) * GRID_STEP + GRID_STEP / 2
    return max(-limit, min(limit, centre))


def _get_json(url: str) -> dict:
    """GET + parse, retrying transient failures (network errors, 5xx).
    A 404 is ERDDAP saying the query matched nothing: SstNoData."""
    for attempt in range(RETRIES + 1):
        try:
            resp = _client.get(url)
            if resp.status_code == 404:
                raise SstNoData(url)
            resp.raise_for_status()
            return resp.json()
        except SstNoData:
            raise
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            retryable = not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code >= 500
            if not retryable or attempt == RETRIES:
                raise SstUnavailable(str(exc)) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise SstUnavailable(str(exc)) from exc
        time.sleep(RETRY_DELAY_S * (attempt + 1))
    raise SstUnavailable(url)  # unreachable


def _fetch(dataset: str, date: str, lat: float, lon: float) -> Optional[float]:
    """SST (deg C) at a grid-cell centre for `date` (YYYY-MM-DD) from
    `dataset`; None over land. Raises SstNoData if the dataset has no such
    day, SstUnavailable on any network or format problem."""
    # OISST's daily fields are stamped at noon UTC.
    query = f"sst[({date}T12:00:00Z)][(0.0)][({lat})][({lon})]"
    url = f"{ERDDAP}/griddap/{dataset}.json?{quote(query, safe='')}"
    data = _get_json(url)
    try:
        table = data["table"]
        row = table["rows"][0]
        value = row[table["columnNames"].index("sst")]
    except (KeyError, IndexError, ValueError, TypeError) as exc:
        raise SstUnavailable(str(exc)) from exc
    return None if value is None else float(value)


def _fetch_latest(dataset: str) -> str:
    """Last day (YYYY-MM-DD) `dataset` has."""
    url = f"{ERDDAP}/griddap/{dataset}.json?{quote('time[last]', safe='')}"
    try:
        return str(_get_json(url)["table"]["rows"][0][0])[:10]
    except SstNoData as exc:
        raise SstUnavailable(str(exc)) from exc
    except (KeyError, IndexError, TypeError) as exc:
        raise SstUnavailable(str(exc)) from exc


# dataset -> (fetched at, monotonic seconds; last day). Failures aren't cached.
_latest_cache: Dict[str, Tuple[float, str]] = {}


def _latest(dataset: str) -> str:
    with _cache_lock:
        cached = _latest_cache.get(dataset)
    if cached is not None and time.monotonic() - cached[0] < LATEST_TTL_S:
        return cached[1]
    day = _fetch_latest(dataset)
    with _cache_lock:
        _latest_cache[dataset] = (time.monotonic(), day)
    return day


def source_for(date: str) -> Optional[str]:
    """The dataset to use for `date`: the final one if it has that day, else
    the preliminary one if it does, else None. The preliminary dataset's
    last day is only looked up for dates past the final one's."""
    if date <= _latest(FINAL_DATASET):
        return FINAL_DATASET
    if date <= _latest(PRELIMINARY_DATASET):
        return PRELIMINARY_DATASET
    return None


_cache: "OrderedDict[Tuple[str, str, float, float], Optional[float]]" = OrderedDict()
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
        _latest_cache.clear()


def sst_at(date: str, lat: float, lon: float) -> dict:
    """{date, lat, lon, sst, dataset, preliminary} for the grid cell
    containing (lat, lon). Raises SstNoData if no dataset has the day yet.
    Failures aren't cached, so a later request retries ERDDAP."""
    dataset = source_for(date)
    if dataset is None:
        raise SstNoData(date)
    key = (dataset, date, snap(lat, MAX_LAT), snap(lon, MAX_LON))
    with _cache_lock:
        hit = key in _cache
        if hit:
            _cache.move_to_end(key)
            value = _cache[key]
    if not hit:
        value = _fetch(*key)
        with _cache_lock:
            _cache[key] = value
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    return {
        "date": date,
        "lat": key[2],
        "lon": key[3],
        "sst": value,
        "dataset": dataset,
        "preliminary": dataset == PRELIMINARY_DATASET,
    }
