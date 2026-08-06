import time

from app.models import AuditLog, Role


def test_point_edit_writes_value_and_logs_audit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-13")
    headers = auth_header("pointeditor1", Role.qca)
    client.post("/session/shipx_2026-08-13/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-13", "var_name": "temperature", "indices": [1], "value": 42.0},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["old_value"] == 11.0
    assert body["new_value"] == 42.0
    assert body["audit_id"] > 0


def test_point_edit_requires_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-11")
    headers = auth_header("pointeditor2", Role.qca)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-11", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code in (404, 409)


def test_regular_user_cannot_point_edit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12")
    headers = auth_header("viewer5", Role.user)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12", "var_name": "temperature", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 403


def test_point_edit_invalid_var_name_returns_400(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12b")
    headers = auth_header("pointeditor3", Role.qca)
    client.post("/session/shipx_2026-08-12b/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12b", "var_name": "not_a_variable", "indices": [0], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "not_a_variable" in resp.json()["detail"]


def test_point_edit_out_of_range_index_returns_400(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-12c")
    headers = auth_header("pointeditor4", Role.qca)
    client.post("/session/shipx_2026-08-12c/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-12c", "var_name": "temperature", "indices": [99], "value": 1.0},
        headers=headers,
    )
    assert resp.status_code == 400


def _wait_for_job(client, headers, job_id, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/edit/jobs/{job_id}", headers=headers)
        if resp.json()["status"] in ("done", "failed"):
            return resp.json()
        time.sleep(0.02)
    raise TimeoutError("job did not complete in time")


def test_bulk_edit_applies_op_and_logs_audit(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-14b")
    headers = auth_header("bulkeditor1", Role.qca)
    client.post("/session/shipx_2026-08-14b/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-08-14b",
            "var_name": "temperature",
            "slices": [[1, 4]],
            "op": "add",
            "value": 1.0,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]

    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "done"
    assert result["result"]["audit_id"] > 0

    verify = client.post(
        "/edit/point",
        json={"filename": "shipx_2026-08-14b", "var_name": "temperature", "indices": [1], "value": 999.0},
        headers=headers,
    )
    assert verify.json()["old_value"] == 12.0


def test_bulk_edit_invalid_op_fails_job_with_no_audit_row(client, auth_header, synthetic_nc, db_session):
    filename = "shipx_2026-08-14d"
    synthetic_nc(filename)
    headers = auth_header("bulkeditor3", Role.qca)
    client.post(f"/session/{filename}/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/bulk",
        json={
            "filename": filename,
            "var_name": "temperature",
            "slices": [[1, 4]],
            "op": "not_a_real_op",
            "value": 1.0,
        },
        headers=headers,
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]

    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "failed"
    assert result["error"]
    assert "not_a_real_op" in result["error"]

    stray_logs = db_session.query(AuditLog).filter(AuditLog.filename == filename).all()
    assert stray_logs == []


def test_bulk_edit_requires_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-14c")
    headers = auth_header("bulkeditor2", Role.qca)
    resp = client.post(
        "/edit/bulk",
        json={
            "filename": "shipx_2026-08-14c",
            "var_name": "temperature",
            "slices": [[0, 2]],
            "op": "set",
            "value": 0.0,
        },
        headers=headers,
    )
    assert resp.status_code in (404, 409)


def test_flag_edit_writes_flag_and_logs_audit(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-27")
    headers = auth_header("flageditor1", Role.qca)
    client.post("/session/shipx_2026-08-27/open", params={"source": "raw"}, headers=headers)

    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-27",
            "var_name": "temperature",
            "start_time_idx": 1,
            "end_time_idx": 3,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "done"

    data_resp = client.get(
        "/files/shipx_2026-08-27/data", params={"vars": "temperature"}, headers=headers
    )
    assert data_resp.json()["variables"]["temperature"]["flags"] == ["Z", "K", "K", "Z", "Z"]

    audit_resp = client.get("/audit/shipx_2026-08-27", headers=headers)
    entries = audit_resp.json()
    flag_entries = [e for e in entries if e["action"] == "flag_edit"]
    assert len(flag_entries) == 1
    assert flag_entries[0]["new_value"] == "K"


def test_flag_edit_requires_open_session(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-28")
    headers = auth_header("flageditor2", Role.qca)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-28",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code in (404, 409)


def test_regular_user_cannot_flag_edit(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-29")
    headers = auth_header("viewer6", Role.user)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-29",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "K",
        },
        headers=headers,
    )
    assert resp.status_code == 403


def test_flag_edit_invalid_code_fails_job(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-30")
    headers = auth_header("flageditor3", Role.qca)
    client.post("/session/shipx_2026-08-30/open", params={"source": "raw"}, headers=headers)
    resp = client.post(
        "/edit/flag",
        json={
            "filename": "shipx_2026-08-30",
            "var_name": "temperature",
            "start_time_idx": 0,
            "end_time_idx": 1,
            "flag_code": "Q",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    result = _wait_for_job(client, headers, job_id)
    assert result["status"] == "failed"
    assert "Q" in result["error"]
