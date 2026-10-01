import pytest

from app import sst


@pytest.fixture(autouse=True)
def _clear_cache():
    sst.clear_cache()
    yield
    sst.clear_cache()


def _fake_fetch(calls, value=28.06):
    def fetch(date, lat, lon):
        calls.append((date, lat, lon))
        return value
    return fetch


def test_snap_to_oisst_grid_cell_centres():
    assert sst.snap(27.6) == 27.625
    assert sst.snap(-84.3) == -84.375
    assert sst.snap(0.0) == 0.125
    assert sst.snap(90.0, limit=89.875) == 89.875
    assert sst.snap(-180.0, limit=179.875) == -179.875


def test_sst_point_route_returns_snapped_value(client, auth_header, monkeypatch):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser1")
    resp = client.get("/files/sst-point", params={"date": "2024-06-01", "lat": 27.6, "lon": -84.3}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"date": "2024-06-01", "lat": 27.625, "lon": -84.375, "sst": 28.06}
    assert calls == [("2024-06-01", 27.625, -84.375)]


def test_sst_point_is_cached_per_grid_cell(client, auth_header, monkeypatch):
    calls = []
    monkeypatch.setattr(sst, "_fetch", _fake_fetch(calls))
    headers = auth_header("sstuser2")
    for lat in (27.6, 27.55):  # same 0.25 deg cell
        client.get("/files/sst-point", params={"date": "2024-06-01", "lat": lat, "lon": -84.3}, headers=headers)
    assert len(calls) == 1


def test_sst_point_land_is_null(client, auth_header, monkeypatch):
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


def test_sst_point_upstream_failure_is_502_and_not_cached(client, auth_header, monkeypatch):
    def boom(date, lat, lon):
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

    def fake_get(url, timeout):
        seen["url"] = url
        seen["timeout"] = timeout
        return Resp()

    monkeypatch.setattr(sst.httpx, "get", fake_get)
    assert sst._fetch("2024-06-01", 27.625, -84.375) == 28.06
    assert "ncdcOisst21Agg_LonPM180.json" in seen["url"]
    assert "2024-06-01T12%3A00%3A00Z" in seen["url"] or "2024-06-01T12:00:00Z" in seen["url"]
    assert seen["timeout"] == sst.TIMEOUT_S
