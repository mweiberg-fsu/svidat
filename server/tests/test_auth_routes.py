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


from unittest.mock import patch

from sqlalchemy import func

from app.models import OAuthSettings, Role, User


def test_oauth_google_creates_new_user(client, db_session):
    with patch("app.routers.auth.verify_google_id_token", return_value="new@example.com"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "user"
    assert body["token_type"] == "bearer"
    assert body["access_token"]

    user = db_session.query(User).filter(User.username == "new@example.com").first()
    assert user is not None
    assert user.auth_provider == "google"
    assert user.role == Role.user


def test_oauth_google_existing_user_keeps_their_role(client, make_user):
    make_user("existing@example.com", Role.qca)
    with patch("app.routers.auth.verify_google_id_token", return_value="existing@example.com"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "qca"


def test_oauth_google_invalid_token_rejected(client):
    with patch("app.routers.auth.verify_google_id_token", side_effect=ValueError("bad token")):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 401


def test_oauth_microsoft_creates_new_user(client, db_session):
    with patch("app.routers.auth.verify_microsoft_id_token", return_value="ms@example.com"):
        resp = client.post("/auth/oauth/microsoft", json={"id_token": "fake"})
    assert resp.status_code == 200
    user = db_session.query(User).filter(User.username == "ms@example.com").first()
    assert user.auth_provider == "microsoft"


def test_oauth_new_user_rejected_when_domain_not_allowed(client, db_session):
    db_session.add(OAuthSettings(allowed_domains="fsu.edu"))
    db_session.commit()
    with patch("app.routers.auth.verify_google_id_token", return_value="rando@gmail.com"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 403


def test_oauth_new_user_allowed_when_domain_matches(client, db_session):
    db_session.add(OAuthSettings(allowed_domains="fsu.edu,example.com"))
    db_session.commit()
    with patch("app.routers.auth.verify_google_id_token", return_value="person@example.com"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 200


def test_oauth_domain_restriction_not_enforced_on_existing_user(client, make_user, db_session):
    make_user("old@random.com", Role.user)
    db_session.add(OAuthSettings(allowed_domains="fsu.edu"))
    db_session.commit()
    with patch("app.routers.auth.verify_google_id_token", return_value="old@random.com"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 200


def test_oauth_login_matches_existing_user_case_insensitively(client, make_user, db_session):
    make_user("Jane.Doe@FSU.edu", Role.qca)
    with patch("app.routers.auth.verify_google_id_token", return_value="jane.doe@fsu.edu"):
        resp = client.post("/auth/oauth/google", json={"id_token": "fake"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "qca"

    matches = (
        db_session.query(User)
        .filter(func.lower(User.username) == "jane.doe@fsu.edu")
        .all()
    )
    assert len(matches) == 1
