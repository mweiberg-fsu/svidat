from pathlib import Path

import netCDF4
import numpy as np
import pytest

from app import climatology, netcdf_ops
from app.config import settings


def write_clim(path: Path, points, values) -> None:
    """Write a climatology file in the real UWM/COADS packed layout.

    points: list of (lat_center, lon_center) in degrees, lon 0..360.
    values: array-like shaped (12, len(points)) of decoded values.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("mon", 12)
        ds.createDimension("npoint", len(points))
        mon = ds.createVariable("mon", "i2", ("mon",))
        mon[:] = np.arange(1, 13, dtype="i2")
        lat = ds.createVariable("lat", "i2", ("npoint",))
        lat.add_offset = np.float32(-90.5)
        lat.set_auto_maskandscale(False)
        lon = ds.createVariable("lon", "i2", ("npoint",))
        lon.add_offset = np.float32(-0.5)
        lon.set_auto_maskandscale(False)
        clm = ds.createVariable("clm", "i2", ("mon", "npoint"))
        clm.scale_factor = np.float32(0.01)
        clm.add_offset = np.float32(0.0)
        clm.set_auto_maskandscale(False)
        lat[:] = np.rint(np.array([p[0] for p in points]) + 90.5).astype("i2")
        lon[:] = np.rint(np.array([p[1] for p in points]) + 0.5).astype("i2")
        clm[:] = np.rint(np.asarray(values, dtype=float) / 0.01).astype("i2")


def monthly(base: float, n_points: int = 1) -> np.ndarray:
    # value = base + month (1..12), same for every point
    return np.tile((base + np.arange(1, 13, dtype=float))[:, None], (1, n_points))


@pytest.fixture
def clim_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    climatology.clear_cache()
    yield tmp_path / "climatology"
    climatology.clear_cache()


@pytest.mark.parametrize(
    "name,expected",
    [
        ("T", "atemp.nc"),
        ("T2", "atemp.nc"),
        ("RH", "RH.NC"),
        ("P", "SLP.NC"),
        ("TS", "SST.NC"),
        ("TS2", "SST.NC"),
        ("SPD", "W3.NC"),
        ("PL_WSPD", None),
        ("DIR", None),
        ("lat", None),
    ],
)
def test_climatology_key(name, expected):
    assert climatology.climatology_key(name) == expected


def test_grid_places_points_at_cell_centers(clim_dir):
    write_clim(clim_dir / "atemp.nc", [(0.5, 0.5)], monthly(10.0))
    grid = climatology.get_grid("atemp.nc")
    assert grid.shape == (12, 180, 360)
    assert grid[0, 90, 0] == pytest.approx(11.0)
    assert grid[11, 90, 0] == pytest.approx(22.0)


def test_get_grid_none_when_file_missing(clim_dir):
    assert climatology.get_grid("atemp.nc") is None


def test_lookup_wraps_negative_longitude_and_selects_month(clim_dir):
    # Cell centered 27.5N, 276.5E == 83.5W (Gulf off Tampa).
    write_clim(clim_dir / "SST.NC", [(27.5, 276.5)], monthly(20.0))
    grid = climatology.get_grid("SST.NC")
    out = climatology.lookup(grid, np.array([27.9]), np.array([-83.2]), np.array([7]))
    assert out[0] == pytest.approx(27.0)


def test_lookup_nan_for_invalid_coords(clim_dir):
    write_clim(clim_dir / "SST.NC", [(0.5, 0.5)], monthly(20.0))
    grid = climatology.get_grid("SST.NC")
    out = climatology.lookup(
        grid,
        np.array([np.nan, 95.0, 0.5]),
        np.array([0.5, 0.5, np.nan]),
        np.array([1, 1, 1]),
    )
    assert np.isnan(out).all()


def test_gap_fill_within_two_cells_and_gap_beyond(clim_dir):
    write_clim(clim_dir / "SST.NC", [(0.5, 0.5)], monthly(20.0))
    grid = climatology.get_grid("SST.NC")
    near = climatology.lookup(grid, np.array([1.5]), np.array([1.5]), np.array([1]))
    far = climatology.lookup(grid, np.array([0.5]), np.array([3.5]), np.array([1]))
    assert near[0] == pytest.approx(21.0)  # diagonal offset (1,1), dist sqrt(2) <= 2
    assert np.isnan(far[0])  # offset (0,3), dist 3 > 2


def test_gap_fill_wraps_longitude_seam(clim_dir):
    write_clim(clim_dir / "SST.NC", [(0.5, 359.5)], monthly(20.0))
    grid = climatology.get_grid("SST.NC")
    out = climatology.lookup(grid, np.array([0.5]), np.array([0.7]), np.array([1]))
    assert out[0] == pytest.approx(21.0)


def test_gap_fill_prefers_nearest_point(clim_dir):
    # A at col 0 (value 11 in Jan), B at col 3 (value 101 in Jan).
    write_clim(
        clim_dir / "SST.NC",
        [(0.5, 0.5), (0.5, 3.5)],
        np.hstack([monthly(10.0), monthly(100.0)]),
    )
    grid = climatology.get_grid("SST.NC")
    out = climatology.lookup(grid, np.array([0.5]), np.array([1.5]), np.array([1]))
    assert out[0] == pytest.approx(11.0)  # col 1: A is 1 away, B is 2 away


def test_series_for_track_omits_unsupported_and_missing_files(clim_dir):
    write_clim(clim_dir / "atemp.nc", [(0.5, 0.5)], monthly(10.0))
    track = {
        "lat": np.array([0.5, np.nan]),
        "lon": np.array([0.5, 0.5]),
        "month": np.array([1, 1]),
    }
    out = climatology.series_for_track(track, ["T", "T2", "TS", "DIR"])
    # TS maps to SST.NC, which isn't present -> omitted; DIR unsupported.
    assert out == {"T": [11.0, None], "T2": [11.0, None]}


def test_series_for_track_omits_corrupt_climatology_file(clim_dir):
    clim_dir.mkdir(parents=True, exist_ok=True)
    (clim_dir / "atemp.nc").write_bytes(b"not a netcdf file")
    track = {
        "lat": np.array([0.5]),
        "lon": np.array([0.5]),
        "month": np.array([1]),
    }
    out = climatology.series_for_track(track, ["T"])
    assert out == {}


def write_samos(path: Path, lats, lons, minutes, extra_vars=("T", "TS", "DIR")) -> None:
    """Minimal SAMOS-style file: time/lat/lon plus per-time data vars."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = len(lats)
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", n)
        t = ds.createVariable("time", "i4", ("time",))
        t.units = "minutes since 1-1-1980 00:00 UTC"
        t[:] = np.asarray(minutes, dtype="i4")
        for name, vals in (("lat", lats), ("lon", lons)):
            v = ds.createVariable(name, "f4", ("time",))
            v.missing_value = np.float32(-9999.0)
            v[:] = np.asarray(vals, dtype="f4")
        for name in extra_vars:
            v = ds.createVariable(name, "f4", ("time",))
            v[:] = np.zeros(n, dtype="f4")


# Minutes since 1980-01-01 for 1980-01-01 00:00 and 1980-07-01 00:00.
JAN_1980 = 0
JUL_1980 = 182 * 24 * 60


def test_get_track_decodes_month_and_masks_missing(tmp_path):
    path = tmp_path / "ship.nc"
    write_samos(path, [0.5, -9999.0], [0.5, -83.2], [JAN_1980, JUL_1980])
    track = netcdf_ops.get_track(path)
    assert track["month"].tolist() == [1, 7]
    assert track["lat"][0] == pytest.approx(0.5)
    assert np.isnan(track["lat"][1])
    assert track["lon"][1] == pytest.approx(-83.2)


def test_get_track_raises_keyerror_without_lat(tmp_path):
    path = tmp_path / "nolat.nc"
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", 1)
        t = ds.createVariable("time", "i4", ("time",))
        t.units = "minutes since 1-1-1980 00:00 UTC"
        t[:] = [0]
    with pytest.raises(KeyError):
        netcdf_ops.get_track(path)


def test_route_returns_along_track_climatology(client, auth_header, clim_dir):
    write_clim(
        clim_dir / "atemp.nc",
        [(0.5, 0.5), (27.5, 276.5)],
        np.hstack([monthly(10.0), monthly(20.0)]),
    )
    data_dir = clim_dir.parent
    write_samos(
        data_dir / "raw" / "SHIPC_20260101v10001.nc",
        [0.5, 27.9, -9999.0],
        [0.5, -83.2, 0.5],
        [JAN_1980, JUL_1980, JAN_1980],
    )
    headers = auth_header("climviewer1")
    resp = client.get(
        "/files/SHIPC_20260101v10001/climatology",
        params={"vars": "T,TS,DIR"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    # TS -> SST.NC not installed (omitted); DIR unsupported (omitted).
    assert resp.json() == {"variables": {"T": [11.0, 27.0, None]}}


def test_route_requires_auth(client, clim_dir):
    resp = client.get("/files/anything/climatology", params={"vars": "T"})
    assert resp.status_code == 401


def test_route_400_when_vars_empty(client, auth_header, clim_dir):
    headers = auth_header("climviewer2")
    resp = client.get("/files/anything/climatology", params={"vars": ""}, headers=headers)
    assert resp.status_code == 400


def test_route_404_for_missing_file(client, auth_header, clim_dir):
    headers = auth_header("climviewer3")
    resp = client.get("/files/nope/climatology", params={"vars": "T"}, headers=headers)
    assert resp.status_code == 404


def test_route_empty_when_file_has_no_track(client, auth_header, clim_dir):
    write_clim(clim_dir / "atemp.nc", [(0.5, 0.5)], monthly(10.0))
    path = clim_dir.parent / "raw" / "NOTRACK_20260101v10001.nc"
    path.parent.mkdir(parents=True, exist_ok=True)
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", 1)
        v = ds.createVariable("T", "f4", ("time",))
        v[:] = [1.0]
    headers = auth_header("climviewer4")
    resp = client.get(
        "/files/NOTRACK_20260101v10001/climatology", params={"vars": "T"}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"variables": {}}


def test_route_reads_lock_holders_temp_copy(client, auth_header, clim_dir):
    write_clim(
        clim_dir / "atemp.nc",
        [(0.5, 0.5), (10.5, 0.5)],
        np.hstack([monthly(10.0), monthly(50.0)]),
    )
    filename = "SHIPD_20260101v10001"
    write_samos(clim_dir.parent / "raw" / f"{filename}.nc", [0.5], [0.5], [JAN_1980])
    headers = auth_header("climeditor1", is_qca=True)
    open_resp = client.post(f"/session/{filename}/open", params={"source": "raw"}, headers=headers)
    assert open_resp.status_code == 200, open_resp.text
    # Move the ship to 10.5N in the temp copy only.
    edit = client.post(
        "/edit/point",
        json={"filename": filename, "var_name": "lat", "indices": [0], "value": 10.5},
        headers=headers,
    )
    assert edit.status_code == 200, edit.text

    resp = client.get(f"/files/{filename}/climatology", params={"vars": "T"}, headers=headers)
    assert resp.json() == {"variables": {"T": [51.0]}}

    other = auth_header("climviewer5")
    resp_other = client.get(f"/files/{filename}/climatology", params={"vars": "T"}, headers=other)
    assert resp_other.json() == {"variables": {"T": [11.0]}}

    client.post(f"/session/{filename}/close", headers=headers)
