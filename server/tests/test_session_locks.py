from app import storage


def test_open_session_copies_raw_to_temp(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-05")
    headers = auth_header("editor1", is_qca=True)

    resp = client.post("/session/shipx_2026-08-05/open", params={"source": "raw"}, headers=headers)
    assert resp.status_code == 200
    temp = storage.temp_path("editor1", "shipx_2026-08-05")
    assert temp.exists()


def test_second_user_blocked_while_locked(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-06")
    headers_a = auth_header("editor2", is_qca=True)
    headers_b = auth_header("editor3", is_qca=True)

    resp = client.post("/session/shipx_2026-08-06/open", params={"source": "raw"}, headers=headers_a)
    assert resp.status_code == 200

    resp = client.post("/session/shipx_2026-08-06/open", params={"source": "raw"}, headers=headers_b)
    assert resp.status_code == 409


def test_close_releases_lock_for_next_editor(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-07")
    headers_a = auth_header("editor4", is_qca=True)
    headers_b = auth_header("editor5", is_qca=True)

    client.post("/session/shipx_2026-08-07/open", params={"source": "raw"}, headers=headers_a)
    resp = client.post("/session/shipx_2026-08-07/close", headers=headers_a)
    assert resp.status_code == 200

    resp = client.post("/session/shipx_2026-08-07/open", params={"source": "raw"}, headers=headers_b)
    assert resp.status_code == 200


def test_reopen_same_user_keeps_existing_temp_for_recovery(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-08")
    headers = auth_header("editor6", is_qca=True)

    client.post("/session/shipx_2026-08-08/open", params={"source": "raw"}, headers=headers)
    temp = storage.temp_path("editor6", "shipx_2026-08-08")
    temp.write_bytes(b"edited-marker")
    client.post("/session/shipx_2026-08-08/close", headers=headers)

    client.post("/session/shipx_2026-08-08/open", params={"source": "raw"}, headers=headers)
    assert temp.read_bytes() == b"edited-marker"


def test_regular_user_cannot_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-09")
    headers = auth_header("viewer_session1")
    resp = client.post("/session/shipx_2026-08-09/open", params={"source": "raw"}, headers=headers)
    assert resp.status_code == 403


def test_open_session_400_for_invalid_filename(client, auth_header):
    headers = auth_header("editor_invalid1", is_qca=True)
    # "%2e" is a percent-encoded "." so it survives as a literal path segment
    # (unlike a bare "." which the client normalizes away before sending),
    # letting it reach storage.temp_path() and trip validate_segment().
    resp = client.post("/session/%2e/open", params={"source": "raw"}, headers=headers)
    assert resp.status_code == 400


def test_failed_draft_open_does_not_strand_lock(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-10")
    headers_a = auth_header("editor7", is_qca=True)
    headers_b = auth_header("editor8", is_qca=True)

    # No draft exists for this filename, so this should 404 without
    # leaving a Lock row behind.
    resp = client.post(
        "/session/shipx_2026-08-10/open",
        params={"source": "draft"},
        headers=headers_a,
    )
    assert resp.status_code == 404

    # If the failed open above had left a Lock row behind, this would
    # come back 409 (locked by editor7) instead of succeeding.
    resp = client.post(
        "/session/shipx_2026-08-10/open",
        params={"source": "raw"},
        headers=headers_b,
    )
    assert resp.status_code == 200
