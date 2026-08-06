import re
from typing import Any, Dict, List, Tuple

import netCDF4
import numpy as np

# Some source files (SAMOS convention) use a non-padded, non-ISO M-D-YYYY
# reference date in their time units attr, e.g. "minutes since 1-1-1980
# 00:00 UTC". netCDF4.num2date expects an ISO-ordered YYYY-MM-DD reference
# date and misparses (or outright rejects) that form, so normalize it first.
_NON_ISO_REFERENCE_DATE = re.compile(r"(since\s+)(\d{1,2})-(\d{1,2})-(\d{4})")


def _normalize_time_units(units: str) -> str:
    def _reorder(match: "re.Match[str]") -> str:
        prefix, month, day, year = match.groups()
        return f"{prefix}{year}-{int(month):02d}-{int(day):02d}"

    return _NON_ISO_REFERENCE_DATE.sub(_reorder, units)


def _to_native(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    return value


def get_metadata(path) -> Dict[str, Any]:
    with netCDF4.Dataset(path, "r") as ds:
        ds.set_auto_mask(False)
        variables = {}
        for name, var in ds.variables.items():
            variables[name] = {
                "dims": list(var.dimensions),
                "shape": list(var.shape),
                "dtype": str(var.dtype),
                "attrs": {
                    attr: _to_native(var.getncattr(attr)) for attr in var.ncattrs()
                },
            }
        dimensions = {name: len(dim) for name, dim in ds.dimensions.items()}
        global_attrs = {
            attr: _to_native(ds.getncattr(attr)) for attr in ds.ncattrs()
        }
    return {
        "variables": variables,
        "dimensions": dimensions,
        "global_attrs": global_attrs,
    }


def read_point(path, var_name: str, indices: List[int]) -> float:
    with netCDF4.Dataset(path, "r") as ds:
        ds.set_auto_mask(False)
        return float(ds.variables[var_name][tuple(indices)])


def write_point(path, var_name: str, indices: List[int], value: float) -> float:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        variable = ds.variables[var_name]
        old_value = float(variable[tuple(indices)])
        variable[tuple(indices)] = value
    return old_value


def write_bulk(
    path, var_name: str, slices: List[Tuple[int, int]], value: float, op: str
) -> np.ndarray:
    index = tuple(slice(start, stop) for start, stop in slices)
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        variable = ds.variables[var_name]
        old_values = np.array(variable[index])
        if op == "set":
            new_values = np.full(old_values.shape, value)
        elif op == "add":
            new_values = old_values + value
        elif op == "multiply":
            new_values = old_values * value
        else:
            raise ValueError(f"unknown bulk op: {op}")
        variable[index] = new_values
    return old_values


def restore_point(path, var_name: str, indices: List[int], old_value: float) -> None:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        ds.variables[var_name][tuple(indices)] = old_value


def restore_bulk(
    path, var_name: str, slices: List[Tuple[int, int]], old_values: np.ndarray
) -> None:
    index = tuple(slice(start, stop) for start, stop in slices)
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        ds.variables[var_name][index] = old_values


def get_variable_data(path, var_names: List[str]) -> Dict[str, Any]:
    with netCDF4.Dataset(path, "r") as ds:
        ds.set_auto_mask(False)

        if "time" not in ds.variables:
            raise KeyError("time")
        time_var = ds.variables["time"]
        time_values = netCDF4.num2date(
            time_var[:],
            units=_normalize_time_units(time_var.units),
            only_use_cftime_datetimes=False,
            only_use_python_datetimes=True,
        )
        time_iso = [t.isoformat() for t in time_values]

        flag_var = ds.variables.get("flag")

        result_vars: Dict[str, Any] = {}
        for name in var_names:
            if name not in ds.variables:
                raise KeyError(name)
            var = ds.variables[name]
            attrs = set(var.ncattrs())
            values = np.array(var[:], dtype=float)

            mask = np.zeros(values.shape, dtype=bool)
            if "missing_value" in attrs:
                mask |= np.isclose(values, float(var.getncattr("missing_value")))
            if "special_value" in attrs:
                mask |= np.isclose(values, float(var.getncattr("special_value")))
            value_list = [None if m else float(v) for v, m in zip(values, mask)]

            flags = None
            if flag_var is not None and "qcindex" in attrs:
                qcindex = int(var.getncattr("qcindex"))
                if qcindex < 1:
                    raise ValueError(f"invalid qcindex {qcindex} for variable '{name}'")
                flag_col = flag_var[:, qcindex - 1]
                flags = [
                    f.decode() if isinstance(f, bytes) else str(f) for f in flag_col
                ]

            result_vars[name] = {"values": value_list, "flags": flags}

    return {"time": time_iso, "variables": result_vars}


def _flag_column(ds, var_name: str) -> int:
    if var_name not in ds.variables:
        raise KeyError(var_name)
    var = ds.variables[var_name]
    if "qcindex" not in var.ncattrs():
        raise ValueError(f"variable '{var_name}' has no qcindex attr")
    qcindex = int(var.getncattr("qcindex"))
    if qcindex < 1:
        raise ValueError(f"invalid qcindex {qcindex} for variable '{var_name}'")
    return qcindex - 1


def write_flags(
    path, var_name: str, start_idx: int, end_idx: int, flag_code: str
) -> np.ndarray:
    if len(flag_code) != 1:
        raise ValueError(f"flag_code must be a single character: {flag_code!r}")
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        col = _flag_column(ds, var_name)

        flag_var = ds.variables["flag"]
        valid_codes = {
            a for a in flag_var.ncattrs() if len(a) == 1 and a.isalpha() and a.isupper()
        }
        if flag_code not in valid_codes:
            raise ValueError(
                f"invalid flag_code {flag_code!r}, must be one of {sorted(valid_codes)}"
            )

        old_values = np.array(flag_var[start_idx:end_idx, col])
        flag_var[start_idx:end_idx, col] = np.array(
            [flag_code.encode()] * (end_idx - start_idx), dtype="S1"
        )
    return old_values


def restore_flags(
    path, var_name: str, start_idx: int, end_idx: int, old_values: np.ndarray
) -> None:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        col = _flag_column(ds, var_name)
        flag_var = ds.variables["flag"]
        flag_var[start_idx:end_idx, col] = old_values
