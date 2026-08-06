import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.deps import get_current_user, require_role
from app.models import Role


def _build_test_app():
    test_app = FastAPI()

    @test_app.get("/whoami")
    def whoami(user=Depends(get_current_user)):
        return {"username": user.username, "role": user.role.value}

    @test_app.get("/admin-only")
    def admin_only(user=Depends(require_role(Role.admin))):
        return {"username": user.username}

    return test_app


def test_get_current_user_valid_token(make_user):
    from app.security import create_access_token

    make_user("carol", Role.user)
    token = create_access_token("carol", Role.user.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"username": "carol", "role": "user"}


def test_get_current_user_invalid_token_401():
    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_require_role_blocks_wrong_role(make_user):
    from app.security import create_access_token

    make_user("dave", Role.user)
    token = create_access_token("dave", Role.user.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_require_role_allows_correct_role(make_user):
    from app.security import create_access_token

    make_user("erin", Role.admin)
    token = create_access_token("erin", Role.admin.value)

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
