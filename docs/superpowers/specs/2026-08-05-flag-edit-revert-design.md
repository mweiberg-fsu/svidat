# Revert support for flag_edit audit entries — design

## Context

`POST /edit/flag` (`app/routers/edit.py`) writes an audit-log row with
`action="flag_edit"`, storing the edited time-range in `indices_json`
(`[start_time_idx, end_time_idx]`), the applied code in `new_value_str`,
and the pre-edit flag column slice in a `.npy` blob referenced by
`old_value_ref` (`storage.audit_blob_path`) — the exact same shape
`bulk_edit` uses for its own `old_value_ref` blob.

`POST /audit/{audit_id}/revert` (`app/routers/audit.py`) currently only
accepts `entry.action in ("point_edit", "bulk_edit")`; everything else
(including `flag_edit`) gets a 400 "entry not revertible". The two
frontend audit views (`AuditHistoryModal.tsx`, `AuditPanel.tsx`) gate
their per-row Revert button on that same two-action allowlist, so no UI
currently offers reverting a flag edit even though the data needed to do
so is already captured.

## Goal

Make `flag_edit` entries revertible, end to end: backend `revert()`
branch, a `netcdf_ops.restore_flags` write path, and the frontend button
gating widened to show Revert for `flag_edit` rows too.

## Non-goals

- No change to how flag edits are applied (`write_flags`) or audited —
  only the revert path is new.
- No revert support added for `save`/`publish` — those remain
  structurally non-revertible (they're file-copy operations, not
  data edits) and keep returning 400.

## Backend

### `app/netcdf_ops.py`

Factor the qcindex/column lookup that `write_flags` already does into a
private helper, since `restore_flags` needs the identical lookup:

```python
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
```

`write_flags` calls this instead of its inline lookup (behavior
unchanged — same exceptions, same messages). New function:

```python
def restore_flags(
    path, var_name: str, start_idx: int, end_idx: int, old_values: np.ndarray
) -> None:
    with netCDF4.Dataset(path, "r+") as ds:
        ds.set_auto_mask(False)
        col = _flag_column(ds, var_name)
        flag_var = ds.variables["flag"]
        flag_var[start_idx:end_idx, col] = old_values
```

Mirrors `restore_bulk`'s shape exactly (open `r+`, write slice, no return
value).

### `app/routers/audit.py` — `revert()`

- Allow `entry.action in ("point_edit", "bulk_edit", "flag_edit")` in the
  entry-not-found/not-revertible check.
- New branch for `flag_edit`, placed alongside the existing
  `point_edit`/`bulk_edit` branches:

```python
else:  # flag_edit
    start_idx, end_idx = json.loads(entry.indices_json)
    try:
        old_values = np.load(entry.old_value_ref)
        with file_write_lock(f"nc:{entry.filename}"):
            netcdf_ops.restore_flags(path, entry.var_name, start_idx, end_idx, old_values)
    except (OSError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"could not revert: {exc}"
        )
    new_log = AuditLog(
        filename=entry.filename,
        user_id=user.id,
        action="revert",
        var_name=entry.var_name,
        indices_json=entry.indices_json,
        old_value_ref=entry.old_value_ref,
    )
```

This slots into the existing `if entry.action == "point_edit": ... else:
...` structure, which becomes a three-way `if/elif/else` distinguishing
`point_edit` / `bulk_edit` / `flag_edit`. Everything downstream (the
atomic `reverted` claim, the `db.add(new_log)` + commit) is unchanged —
it already works generically over `new_log`.

No changes to lock checks, session checks, or the already-reverted
guard — all of that logic is action-agnostic and applies verbatim.

## Frontend

### `client/src/components/AuditHistoryModal.tsx` and `client/src/components/AuditPanel.tsx`

Both have an identical gating expression:

```tsx
e.action !== 'point_edit' && e.action !== 'bulk_edit' ? null : ...
```

Change to:

```tsx
e.action !== 'point_edit' && e.action !== 'bulk_edit' && e.action !== 'flag_edit' ? null : ...
```

No other change — same button, same `revertingId` in-flight tracking,
same `reverted` → "Reverted" text swap, same error display on failure.

## Testing

- `server/tests/test_audit_routes.py`: new test — apply a flag edit,
  revert it, assert: the flag column slice is restored to its pre-edit
  values, the original entry is marked `reverted`, a new `revert`
  audit-log row exists. Also a regression case confirming
  already-reverted and no-lock-held still 409 for `flag_edit` the same
  way they already do for `bulk_edit`.
- `server/tests/test_netcdf_ops.py`: unit test for `restore_flags`
  (write flags, restore, read back original values) — same shape as
  existing `restore_bulk` test.
- Frontend: extend `AuditHistoryModal.test.tsx` and `AuditPanel.test.tsx`
  (if they assert the gating list) to cover a `flag_edit` row showing a
  Revert button.
