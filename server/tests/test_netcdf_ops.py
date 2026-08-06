import math

import netCDF4
import numpy as np
import pytest

from app import netcdf_ops


@pytest.fixture
def nc_file(tmp_path):
    path = tmp_path / "shipx_2026-07-30.nc"
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", 5)
        var = ds.createVariable("temperature", "f4", ("time",))
        var[:] = np.array([10.0, 11.0, 12.0, 13.0, 14.0], dtype="f4")
        var.units = "degC"
    return path


@pytest.fixture
def nc_file_with_fill(tmp_path):
    path = tmp_path / "shipx_fill_2026-07-30.nc"
    fill_value = -9999.0
    with netCDF4.Dataset(path, "w") as ds:
        ds.createDimension("time", 5)
        var = ds.createVariable("temperature", "f4", ("time",), fill_value=fill_value)
        var[0] = 10.0
        var[1] = 11.0
        # index 2 is left unwritten, so it holds the raw _FillValue on disk
        var[3] = 13.0
        var[4] = 14.0
        var.units = "degC"
    return path, fill_value


def test_get_metadata(nc_file):
    meta = netcdf_ops.get_metadata(nc_file)
    assert meta["dimensions"]["time"] == 5
    assert meta["variables"]["temperature"]["shape"] == [5]
    assert meta["variables"]["temperature"]["attrs"]["units"] == "degC"


def test_read_and_write_point(nc_file):
    old = netcdf_ops.write_point(nc_file, "temperature", [2], 99.0)
    assert old == pytest.approx(12.0)
    assert netcdf_ops.read_point(nc_file, "temperature", [2]) == pytest.approx(99.0)


def test_write_bulk_add(nc_file):
    old_values = netcdf_ops.write_bulk(nc_file, "temperature", [(1, 4)], 1.0, "add")
    assert list(old_values) == pytest.approx([11.0, 12.0, 13.0])
    new_values = [netcdf_ops.read_point(nc_file, "temperature", [i]) for i in range(1, 4)]
    assert new_values == pytest.approx([12.0, 13.0, 14.0])


def test_restore_point_and_bulk(nc_file):
    netcdf_ops.write_point(nc_file, "temperature", [0], 0.0)
    netcdf_ops.restore_point(nc_file, "temperature", [0], 10.0)
    assert netcdf_ops.read_point(nc_file, "temperature", [0]) == pytest.approx(10.0)

    old_values = netcdf_ops.write_bulk(nc_file, "temperature", [(3, 5)], 5.0, "set")
    netcdf_ops.restore_bulk(nc_file, "temperature", [(3, 5)], old_values)
    restored = [netcdf_ops.read_point(nc_file, "temperature", [i]) for i in range(3, 5)]
    assert restored == pytest.approx(list(old_values))


def test_write_and_restore_point_preserves_fill_value(nc_file_with_fill):
    path, fill_value = nc_file_with_fill

    # index 2 was never written, so it's a genuine missing/fill-value cell.
    old_value = netcdf_ops.write_point(path, "temperature", [2], 42.0)

    # Without set_auto_mask(False), netCDF4 would coerce this masked read to NaN.
    assert not math.isnan(old_value)
    assert old_value == pytest.approx(fill_value)
    assert netcdf_ops.read_point(path, "temperature", [2]) == pytest.approx(42.0)

    netcdf_ops.restore_point(path, "temperature", [2], old_value)

    restored = netcdf_ops.read_point(path, "temperature", [2])
    assert not math.isnan(restored)
    assert restored == pytest.approx(fill_value)


def test_get_variable_data_masks_missing_and_converts_time(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    result = netcdf_ops.get_variable_data(path, ["temperature", "salinity"])

    assert result["time"][0].startswith("2025-01-01")
    assert len(result["time"]) == 5

    temp = result["variables"]["temperature"]
    assert temp["values"][0] == pytest.approx(10.0)
    assert temp["values"][1] is None  # masked missing_value
    assert temp["flags"] == ["Z", "Z", "Z", "Z", "Z"]

    sal = result["variables"]["salinity"]
    assert sal["values"][1] == pytest.approx(31.0)


def test_get_variable_data_unknown_variable_raises_keyerror(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(KeyError):
        netcdf_ops.get_variable_data(path, ["not_a_variable"])


def test_write_flags_sets_range_and_returns_old(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    old = netcdf_ops.write_flags(path, "temperature", 1, 3, "K")
    assert [v.decode() if isinstance(v, bytes) else v for v in old] == ["Z", "Z"]

    result = netcdf_ops.get_variable_data(path, ["temperature", "salinity"])
    assert result["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]
    # salinity's own qcindex column (2) must be untouched
    assert result["variables"]["salinity"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]


def test_write_flags_rejects_unknown_code(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(ValueError):
        netcdf_ops.write_flags(path, "temperature", 0, 1, "Q")


def test_write_flags_rejects_var_without_qcindex(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with pytest.raises(ValueError):
        netcdf_ops.write_flags(path, "flag", 0, 1, "K")


def test_get_variable_data_variable_without_qcindex_has_no_flags(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    result = netcdf_ops.get_variable_data(path, ["pressure"])
    assert result["variables"]["pressure"]["flags"] is None
    assert result["variables"]["pressure"]["values"][0] == pytest.approx(1000.0)


def test_get_variable_data_rejects_qcindex_below_one(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with netCDF4.Dataset(path, "r+") as ds:
        ds.variables["temperature"].qcindex = 0

    with pytest.raises(ValueError):
        netcdf_ops.get_variable_data(path, ["temperature"])


def test_write_flags_rejects_qcindex_below_one(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    with netCDF4.Dataset(path, "r+") as ds:
        ds.variables["temperature"].qcindex = 0

    with pytest.raises(ValueError):
        netcdf_ops.write_flags(path, "temperature", 0, 1, "K")


def test_restore_flags_restores_previous_values(synthetic_nc_with_qc):
    path = synthetic_nc_with_qc()
    old = netcdf_ops.write_flags(path, "temperature", 1, 3, "K")
    netcdf_ops.restore_flags(path, "temperature", 1, 3, old)

    result = netcdf_ops.get_variable_data(path, ["temperature"])
    assert result["variables"]["temperature"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]
