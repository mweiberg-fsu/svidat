from app import storage


def test_save_copies_temp_to_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-15")
    headers = auth_header("saver1", is_qca=True)
    client.post("/session/shipx_2026-08-15/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/save", json={"filename": "shipx_2026-08-15"}, headers=headers)
    assert resp.status_code == 200
    draft = storage.draft_path("saver1", "shipx_2026-08-15")
    assert draft.exists()


def test_save_overwrites_previous_draft(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-16")
    headers = auth_header("saver2", is_qca=True)
    client.post("/session/shipx_2026-08-16/open", params={"source": "raw"}, headers=headers)
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    temp = storage.temp_path("saver2", "shipx_2026-08-16")
    temp.write_bytes(b"second-save-marker")
    client.post("/save", json={"filename": "shipx_2026-08-16"}, headers=headers)

    draft = storage.draft_path("saver2", "shipx_2026-08-16")
    assert draft.read_bytes() == b"second-save-marker"


def test_publish_copies_temp_to_shared_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-17")
    headers = auth_header("publisher1", is_qca=True)
    client.post("/session/shipx_2026-08-17/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-17"}, headers=headers)
    assert resp.status_code == 200
    published = storage.published_path("shipx_2026-08-17")
    assert published.exists()


def test_publish_does_not_require_prior_save(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-18")
    headers = auth_header("publisher2", is_qca=True)
    client.post("/session/shipx_2026-08-18/open", params={"source": "raw"}, headers=headers)

    resp = client.post("/publish", json={"filename": "shipx_2026-08-18"}, headers=headers)
    assert resp.status_code == 200


def test_republish_overwrites_existing_v300(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-19")
    headers = auth_header("publisher3", is_qca=True)
    client.post("/session/shipx_2026-08-19/open", params={"source": "raw"}, headers=headers)
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    temp = storage.temp_path("publisher3", "shipx_2026-08-19")
    temp.write_bytes(b"republish-marker")
    client.post("/publish", json={"filename": "shipx_2026-08-19"}, headers=headers)

    published = storage.published_path("shipx_2026-08-19")
    assert published.read_bytes() == b"republish-marker"


def test_save_and_publish_require_open_session(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-20")
    headers = auth_header("nosessuser", is_qca=True)
    resp = client.post("/save", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404
    resp = client.post("/publish", json={"filename": "shipx_2026-08-20"}, headers=headers)
    assert resp.status_code == 404


def test_publish_with_stale_temp_but_no_active_lock_is_rejected(client, auth_header, synthetic_nc):
    synthetic_nc("shipx_2026-08-21b")
    headers_a = auth_header("publisher_stale_a", is_qca=True)
    headers_b = auth_header("publisher_stale_b", is_qca=True)

    client.post("/session/shipx_2026-08-21b/open", params={"source": "raw"}, headers=headers_a)
    client.post("/session/shipx_2026-08-21b/close", headers=headers_a)

    # a's temp file still exists (recovery copy), but a no longer holds the lock,
    # and no one else has opened it either -> publish must still be rejected.
    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_a)
    assert resp.status_code == 409

    # now b opens (and thus holds) the lock; a's stale temp must not be publishable
    # over b's active session.
    client.post("/session/shipx_2026-08-21b/open", params={"source": "raw"}, headers=headers_b)
    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_a)
    assert resp.status_code == 409

    resp = client.post("/publish", json={"filename": "shipx_2026-08-21b"}, headers=headers_b)
    assert resp.status_code == 200
