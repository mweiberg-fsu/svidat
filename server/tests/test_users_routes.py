def test_admin_can_create_and_list_users(client, auth_header):
    headers = auth_header("admin1", is_admin=True)

    resp = client.post(
        "/users", json={"username": "newqca", "password": "pw12345", "role": "qca"}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["username"] == "newqca"

    resp = client.get("/users", headers=headers)
    assert resp.status_code == 200
    usernames = [u["username"] for u in resp.json()]
    assert "newqca" in usernames


def test_non_admin_cannot_create_user(client, auth_header):
    headers = auth_header("regular1")
    resp = client.post(
        "/users", json={"username": "x", "password": "pw12345", "role": "user"}, headers=headers
    )
    assert resp.status_code == 403


def test_duplicate_username_conflict(client, auth_header):
    headers = auth_header("admin2", is_admin=True)
    client.post("/users", json={"username": "dupe", "password": "pw12345", "role": "user"}, headers=headers)
    resp = client.post("/users", json={"username": "dupe", "password": "pw12345", "role": "user"}, headers=headers)
    assert resp.status_code == 409


def test_admin_can_delete_user(client, auth_header):
    headers = auth_header("admin3", is_admin=True)
    create_resp = client.post(
        "/users", json={"username": "todelete", "password": "pw12345", "role": "user"}, headers=headers
    )
    user_id = create_resp.json()["id"]

    resp = client.delete(f"/users/{user_id}", headers=headers)
    assert resp.status_code == 204

    resp = client.get("/users", headers=headers)
    assert "todelete" not in [u["username"] for u in resp.json()]


def test_get_me_returns_current_user(client, auth_header):
    headers = auth_header("meuser1", is_qca=True)
    resp = client.get("/users/me", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "meuser1"
    assert body["role"] == "qca"
    assert body["id"] > 0


def test_avatar_upload_and_fetch_roundtrip(client, auth_header):
    headers = auth_header("avatareditor1", is_qca=True)
    me = client.get("/users/me", headers=headers).json()

    png_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("photo.png", png_bytes, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200

    fetch_resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert fetch_resp.status_code == 200
    assert fetch_resp.content == png_bytes


def test_avatar_upload_rejects_bad_content_type(client, auth_header):
    headers = auth_header("avatareditor2", is_qca=True)
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("evil.txt", b"not an image", "text/plain")},
        headers=headers,
    )
    assert resp.status_code == 400


def test_avatar_upload_rejects_oversized_file(client, auth_header):
    headers = auth_header("avatareditor3", is_qca=True)
    big = b"0" * (2 * 1024 * 1024 + 1)
    resp = client.post(
        "/users/me/avatar",
        files={"file": ("big.png", big, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 400


def test_avatar_fetch_404_before_upload(client, auth_header):
    headers = auth_header("avatareditor4", is_qca=True)
    me = client.get("/users/me", headers=headers).json()
    resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert resp.status_code == 404


def test_avatar_reupload_replaces_old_file(client, auth_header):
    headers = auth_header("avatareditor5", is_qca=True)
    me = client.get("/users/me", headers=headers).json()

    client.post(
        "/users/me/avatar",
        files={"file": ("a.png", b"first" * 20, "image/png")},
        headers=headers,
    )
    client.post(
        "/users/me/avatar",
        files={"file": ("b.jpg", b"second" * 20, "image/jpeg")},
        headers=headers,
    )

    from app import storage

    png_path = storage.avatar_path(me["id"], "png")
    jpg_path = storage.avatar_path(me["id"], "jpg")
    assert not png_path.exists()
    assert jpg_path.exists()

    fetch_resp = client.get(f"/users/{me['id']}/avatar", headers=headers)
    assert fetch_resp.content == b"second" * 20
