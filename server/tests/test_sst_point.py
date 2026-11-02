import pytest

from app import sst


FINAL_LAST = "2026-10-17"
PRELIM_LAST = "2026-11-01"


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    sst.clear_cache()
    monkeypatch.setattr(sst, "RETRY_DELAY_S", 0)
    yield
    sst.clear_cache()


@pytest.fixture
def latest(monkeypatch):
    """Stub each dataset's last day (no network)."""
    calls = []

    def fake_latest(dataset):
        calls.append(dataset)
        return {sst.FINAL_DATASET: FINAL_LAST, sst.PRELIMINARY_DATASET: PRELIM_LAST}[dataset]

    monkeypatch.setattr(sst, "_fetch_latest", fake_latest)
    return calls


def _fake_fetch(calls, value=28.06):
    def fetch(dataset, date, lat, lon):
        calls.append((dataset, date, lat, lon))
        return value
    return fetch


def test_snap_to_oisst_grid_cell_centres():
    assert sst.snap(27.6) == 27.625
    assert sst.snap(-84.3) == -84.375
    assert sst.snap(0.0) == 0.125
    assert sst.snap(90.0, limit=89.875) == 89.875
    assert sst.snap(-180.0, limit=179.875) == -179.875


def test_sst_point_route_returns_snapped_value(client, auth_header, monkeypatch, latest):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser1")
    resp = client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 27.6, "lon": -84.3}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "date": "2024-06-01", "lat": 27.625, "lon": -84.375, "sst": 28.06,
        "dataset": sst.FINAL_DATASET, "preliminary": False,
    }
    assert calls == [(sst.FINAL_DATASET, "2024-06-01", 27.625, -84.375)]


def test_sst_point_uses_final_dataset_through_its_last_day(client, auth_header, monkeypatch, latest):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser_final_last")
    resp = client.get("/files/sst-point", params={"date": FINAL_LAST, "lat": 1, "lon": 1}, headers=headers)
    assert resp.json()["preliminary"] is False
    assert calls[0][0] == sst.FINAL_DATASET


def test_sst_point_falls_back_to_preliminary_after_final_ends(client, auth_header, monkeypatch, latest):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls, value=26.94))
    headers = auth_header("sstuser_prelim")
    resp = client.get("/files/sst-point", params={"date": "2026-10-25", "lat": 27.6, "lon": -84.9}, headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sst"] == 26.94
    assert body["dataset"] == sst.PRELIMINARY_DATASET
    assert body["preliminary"] is True
    assert calls == [(sst.PRELIMINARY_DATASET, "2026-10-25", 27.625, -84.875)]


def test_sst_point_past_both_datasets_is_404(client, auth_header, monkeypatch, latest):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser_future")
    resp = client.get("/files/sst-point", params={"date": "2026-11-02", "lat": 1, "lon": 1}, headers=headers)
    assert resp.status_code == 404
    assert "no SST data" in resp.text
    assert calls == []


def test_sst_source_route(client, auth_header, latest):
    headers = auth_header("sstuser_source")
    get = lambda d: client.get("/files/sst-source", params={"date": d}, headers=headers)
    assert get("2026-10-17").json() == {"date": "2026-10-17", "dataset": sst.FINAL_DATASET, "preliminary": False}
    assert get("2026-10-18").json() == {"date": "2026-10-18", "dataset": sst.PRELIMINARY_DATASET, "preliminary": True}
    assert get("2026-11-02").json() == {"date": "2026-11-02", "dataset": None, "preliminary": False}
    assert get("2026-1-2").status_code == 422


def test_sst_source_route_upstream_failure_is_502(client, auth_header, monkeypatch):
    def boom(dataset):
        raise sst.SstUnavailable("503")
    monkeypatch.setattr(sst, "_fetch_latest", boom)
    headers = auth_header("sstuser_source_down")
    resp = client.get("/files/sst-source", params={"date": "2026-10-01"}, headers=headers)
    assert resp.status_code == 502


def test_latest_dates_are_cached_and_preliminary_only_checked_when_needed(latest):
    for d in ("2026-10-01", "2026-10-02", "2026-10-25", "2026-10-26"):
        sst.source_for(d)
    assert latest == [sst.FINAL_DATASET, sst.PRELIMINARY_DATASET]


def test_latest_cache_expires(monkeypatch, latest):
    now = [1000.0]
    monkeypatch.setattr(sst.time, "monotonic", lambda: now[0])
    sst.source_for("2026-10-01")
    now[0] += sst.LATEST_TTL_S + 1
    sst.source_for("2026-10-01")
    assert latest == [sst.FINAL_DATASET, sst.FINAL_DATASET]


def test_sst_point_is_cached_per_grid_cell(client, auth_header, monkeypatch, latest):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser2")
    for lat in (27.6, 27.55):  # same 0.25 deg cell
        client.get("/files/sst-point", params={"date": "2024-06-01", "lat": lat, "lon": -84.3}, headers=headers)
    assert len(calls) == 1


def test_sst_point_land_is_null(client, auth_header, monkeypatch, latest):
    monkeypatch.setattr(sst, "_fetch", _fake_fetch([], value=None))
    headers = auth_header("sstuser3")
    resp = client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 39.5, "lon": -100}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["sst"] is None


@pytest.mark.parametrize(
    "params",
    [
        {"date": "2024-6-1", "lat": 0, "lon": 0},
        {"date": "not-a-date", "lat": 0, "lon": 0},
        {"date": "2024-06-01", "lat": 91, "lon": 0},
        {"date": "2024-06-01", "lat": 0, "lon": 181},
    ],
)
def test_sst_point_validates_inputs(client, auth_header, params):
    headers = auth_header(f"sstuser4_{params['date']}_{params['lat']}_{params['lon']}")
    assert client.get("/files/sst-point", params=params, headers=headers).status_code == 422


def test_sst_point_upstream_failure_is_502_and_not_cached(client, auth_header, monkeypatch, latest):
    def boom(dataset, date, lat, lon):
        raise sst.SstUnavailable("timeout")
    monkeypatch.setattr(sst, "_fetch", boom)
    headers = auth_header("sstuser5")
    resp = client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 1, "lon": 1}, headers=headers)
    assert resp.status_code == 502
    assert "SST service unavailable" in resp.text

    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    assert client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 1, "lon": 1}, headers=headers).status_code == 200
    assert len(calls) == 1


def test_sst_point_requires_auth(client):
    assert client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 0, "lon": 0}).status_code == 401


def test_fetch_parses_erddap_json(monkeypatch):
    class Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"table": {"columnNames": ["time", "zlev", "latitude", "longitude", "sst"],
                              "rows": [["2024-06-01T12:00:00Z", 0, 27.625, -84.375, 28.06]]}}

    seen = {}

    def fake_get(url):
        seen["url"] = url
        return Resp()

    monkeypatch.setattr(sst._client, "get", fake_get)
    assert sst._fetch(sst.FINAL_DATASET, "2024-06-01", 27.625, -84.375) == 28.06
    assert "ncdcOisst21Agg_LonPM180.json" in seen["url"]
    assert "2024-06-01T12%3A00%3A00Z" in seen["url"] or "2024-06-01T12:00:00Z" in seen["url"]


def test_client_uses_ipv4_backend_with_short_connect_timeout():
    # Regression: an unreachable IPv6 route made every lookup wait out the
    # full connect timeout (~10 s) before httpx tried IPv4.
    assert isinstance(sst._client._transport._pool._network_backend, sst._IPv4Backend)
    assert sst._client.timeout.connect == sst.CONNECT_TIMEOUT_S


def test_ipv4_backend_resolves_ipv4_only_and_tries_each_address(monkeypatch):
    seen = {}

    def fake_getaddrinfo(host, port, family, type_):
        seen["family"] = family
        return [(None, None, None, "", ("10.0.0.1", port)), (None, None, None, "", ("10.0.0.2", port))]

    attempts = []

    def fake_connect(self, host, port, timeout=None, local_address=None, socket_options=None):
        attempts.append(host)
        if host == "10.0.0.1":
            raise sst.httpcore.ConnectTimeout("dead")
        return "stream"

    monkeypatch.setattr(sst.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(sst.httpcore.SyncBackend, "connect_tcp", fake_connect)
    assert sst._IPv4Backend().connect_tcp("example.org", 443, timeout=1) == "stream"
    assert seen["family"] == sst.socket.AF_INET
    assert attempts == ["10.0.0.1", "10.0.0.2"]


def test_fetch_wraps_network_errors(monkeypatch):
    def fail(url):
        raise sst.httpx.ConnectTimeout("no route")

    monkeypatch.setattr(sst._client, "get", fail)
    with pytest.raises(sst.SstUnavailable):
        sst._fetch(sst.FINAL_DATASET, "2024-06-01", 0.125, 0.125)


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload
        self.request = sst.httpx.Request("GET", "https://x")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise sst.httpx.HTTPStatusError(
                str(self.status_code), request=self.request,
                response=sst.httpx.Response(self.status_code, request=self.request),
            )

    def json(self):
        return self._payload


POINT = {"table": {"columnNames": ["time", "zlev", "latitude", "longitude", "sst"],
                   "rows": [["2024-06-01T12:00:00Z", 0, 0.125, 0.125, 20.5]]}}


def test_fetch_retries_transient_503_then_succeeds(monkeypatch):
    answers = [_Resp(503), _Resp(200, POINT)]
    monkeypatch.setattr(sst._client, "get", lambda url: answers.pop(0))
    assert sst._fetch(sst.FINAL_DATASET, "2024-06-01", 0.125, 0.125) == 20.5
    assert answers == []


def test_fetch_gives_up_after_retries(monkeypatch):
    calls = []
    monkeypatch.setattr(sst._client, "get", lambda url: calls.append(url) or _Resp(503))
    with pytest.raises(sst.SstUnavailable):
        sst._fetch(sst.FINAL_DATASET, "2024-06-01", 0.125, 0.125)
    assert len(calls) == 1 + sst.RETRIES


def test_fetch_404_is_no_data_and_not_retried(monkeypatch):
    calls = []
    monkeypatch.setattr(sst._client, "get", lambda url: calls.append(url) or _Resp(404))
    with pytest.raises(sst.SstNoData):
        sst._fetch(sst.FINAL_DATASET, "1970-01-01", 0.125, 0.125)
    assert len(calls) == 1


def test_fetch_latest_parses_last_time(monkeypatch):
    seen = {}

    def fake_get(url):
        seen["url"] = url
        return _Resp(200, {"table": {"columnNames": ["time"], "rows": [["2026-10-17T12:00:00Z"]]}})

    monkeypatch.setattr(sst._client, "get", fake_get)
    assert sst._fetch_latest(sst.PRELIMINARY_DATASET) == "2026-10-17"
    assert "ncdcOisst21NrtAgg_LonPM180.json" in seen["url"]
    assert "last" in seen["url"]
