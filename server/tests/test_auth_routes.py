from app.models import Role


def test_login_success(client, make_user):
    make_user("frank", Role.qca, password="hunter22")
    resp = client.post("/auth/login", data={"username": "frank", "password": "hunter22"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "qca"
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_login_wrong_password(client, make_user):
    make_user("gail", Role.user, password="correcthorse")
    resp = client.post("/auth/login", data={"username": "gail", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post("/auth/login", data={"username": "nobody", "password": "x"})
    assert resp.status_code == 401
