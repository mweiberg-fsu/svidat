from app import storage


def test_list_raw_files(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-07-30")
    headers = auth_header("viewer1")
    resp = client.get("/files/raw", headers=headers)
    assert resp.status_code == 200
    assert "shipx_2026-07-30" in resp.json()


def test_file_metadata(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-07-31")
    headers = auth_header("viewer2")
    resp = client.get("/files/shipx_2026-07-31/metadata", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["dimensions"]["time"] == 5
    assert "temperature" in body["variables"]


def test_metadata_404_for_missing_file(client, auth_header):
    headers = auth_header("viewer3")
    resp = client.get("/files/does-not-exist/metadata", headers=headers)
    assert resp.status_code == 404


def test_list_own_drafts_only_for_regular_user(client, auth_header):
    headers_owner = auth_header("owner1", is_qca=True)
    draft = storage.draft_path("owner1", "shipx_2026-08-01")
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_bytes(b"fake")

    resp = client.get("/files/drafts", headers=headers_owner)
    assert resp.status_code == 200
    assert "shipx_2026-08-01" in resp.json()

    headers_other = auth_header("other1")
    resp = client.get("/files/drafts", params={"username": "owner1"}, headers=headers_other)
    assert resp.status_code == 403


def test_admin_can_list_others_drafts(client, auth_header):
    headers_owner = auth_header("owner2", is_qca=True)
    draft = storage.draft_path("owner2", "shipx_2026-08-02")
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_bytes(b"fake")

    headers_admin = auth_header("admin4", is_admin=True)
    resp = client.get("/files/drafts", params={"username": "owner2"}, headers=headers_admin)
    assert resp.status_code == 200
    assert "shipx_2026-08-02" in resp.json()


def test_metadata_400_for_invalid_filename(client, auth_header):
    headers = auth_header("viewer4")
    # "%2e" is a percent-encoded "." so it survives as a literal path segment
    # (unlike a bare "." which the client normalizes away before sending),
    # letting it reach storage.raw_path() and trip validate_segment().
    resp = client.get("/files/%2e/metadata", headers=headers)
    assert resp.status_code == 400
    assert "invalid filename" in resp.json()["detail"]


def test_list_drafts_400_for_invalid_username(client, auth_header):
    headers_admin = auth_header("admin5", is_admin=True)
    resp = client.get("/files/drafts", params={"username": ".."}, headers=headers_admin)
    assert resp.status_code == 400
    assert "invalid username" in resp.json()["detail"]


def test_catalog_groups_by_ship_and_year(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250101v20001")
    synthetic_nc("KAQP_20250102v20001")
    synthetic_nc("KAQP_20260115v20001")
    synthetic_nc("WTDF_20250601v20001")
    headers = auth_header("cataloguser1")

    resp = client.get("/files/catalog", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    assert set(body["KAQP"]["2025"]) == {"KAQP_20250101v20001", "KAQP_20250102v20001"}
    assert body["KAQP"]["2026"] == ["KAQP_20260115v20001"]
    assert body["WTDF"]["2025"] == ["WTDF_20250601v20001"]


def test_catalog_skips_non_matching_filenames(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250201v20001")
    synthetic_nc("not_a_ship_pattern_file")
    headers = auth_header("cataloguser2")

    resp = client.get("/files/catalog", headers=headers)
    body = resp.json()

    assert "KAQP" in body
    all_files = [f for ship in body.values() for year_files in ship.values() for f in year_files]
    assert "not_a_ship_pattern_file" not in all_files


def test_catalog_accessible_to_all_roles(client, auth_header, synthetic_nc):
    synthetic_nc("KAQP_20250301v20001")
    for username, kwargs in [
        ("cataloguser3", {"is_admin": True}),
        ("cataloguser4", {"is_qca": True}),
        ("cataloguser5", {}),
    ]:
        headers = auth_header(username, **kwargs)
        resp = client.get("/files/catalog", headers=headers)
        assert resp.status_code == 200


def test_catalog_empty_when_no_raw_dir(client, auth_header, tmp_path, monkeypatch):
    import app.storage as storage_module

    empty_dir = tmp_path / "empty_data_dir"
    monkeypatch.setattr(storage_module.settings, "data_dir", str(empty_dir))
    headers = auth_header("cataloguser6")

    resp = client.get("/files/catalog", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {}


def test_file_data_returns_values_and_flags(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-20")
    headers = auth_header("dataviewer1")
    resp = client.get(
        "/files/shipx_2026-08-20/data",
        params={"vars": "temperature,salinity"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["time"]) == 5
    assert body["variables"]["temperature"]["values"][1] is None
    assert body["variables"]["salinity"]["flags"] == ["Z", "Z", "Z", "Z", "Z"]


def test_file_data_unknown_variable_returns_400(client, auth_header, synthetic_nc_with_qc):
    synthetic_nc_with_qc("shipx_2026-08-21")
    headers = auth_header("dataviewer2")
    resp = client.get(
        "/files/shipx_2026-08-21/data",
        params={"vars": "not_a_variable"},
        headers=headers,
    )
    assert resp.status_code == 400


def test_file_data_missing_file_returns_404(client, auth_header):
    headers = auth_header("dataviewer3")
    resp = client.get(
        "/files/does_not_exist_2026/data", params={"vars": "temperature"}, headers=headers
    )
    assert resp.status_code == 404


def test_file_data_does_not_leak_another_users_open_session(
    client, auth_header, synthetic_nc_with_qc
):
    filename = "shipx_2026-08-31"
    synthetic_nc_with_qc(filename)

    # User A opens an edit session and edits their temp copy — index 0
    # changes from the raw fixture's 10.0 to 999.0.
    headers_a = auth_header("isoeditorA", is_qca=True)
    client.post(f"/session/{filename}/open", params={"source": "raw"}, headers=headers_a)
    edit_resp = client.post(
        "/edit/point",
        json={"filename": filename, "var_name": "temperature", "indices": [0], "value": 999.0},
        headers=headers_a,
    )
    assert edit_resp.status_code == 200, edit_resp.text

    # User B has no lock/session on this file at all.
    headers_b = auth_header("isoviewerB")
    resp = client.get(
        f"/files/{filename}/data", params={"vars": "temperature"}, headers=headers_b
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["variables"]["temperature"]["values"][0] == 10.0

    # User A, meanwhile, sees their own edited temp copy when reading back.
    resp_a = client.get(
        f"/files/{filename}/data", params={"vars": "temperature"}, headers=headers_a
    )
    assert resp_a.status_code == 200, resp_a.text
    assert resp_a.json()["variables"]["temperature"]["values"][0] == 999.0
