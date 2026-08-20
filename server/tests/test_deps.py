import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.deps import get_current_user, require_role
from app.models import Role


def _build_test_app():
    test_app = FastAPI()

    @test_app.get("/whoami")
    def whoami(user=Depends(get_current_user)):
        return {"username": user.username, "roles": [r.value for r in user.roles]}

    @test_app.get("/admin-only")
    def admin_only(user=Depends(require_role(Role.admin))):
        return {"username": user.username}

    @test_app.get("/qca-only")
    def qca_only(user=Depends(require_role(Role.qca))):
        return {"username": user.username}

    return test_app


def test_get_current_user_valid_token(make_user):
    from app.security import create_access_token

    make_user("carol")
    token = create_access_token("carol")

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"username": "carol", "roles": []}


def test_get_current_user_invalid_token_401():
    test_client = TestClient(_build_test_app())
    resp = test_client.get("/whoami", headers={"Authorization": "Bearer garbage"})
    assert resp.status_code == 401


def test_require_role_blocks_wrong_role(make_user):
    from app.security import create_access_token

    make_user("dave")
    token = create_access_token("dave")

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_require_role_allows_correct_role(make_user):
    from app.security import create_access_token

    make_user("erin", is_admin=True)
    token = create_access_token("erin")

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_require_role_admin_alone_does_not_satisfy_qca(make_user):
    from app.security import create_access_token

    make_user("frank_deps", is_admin=True)
    token = create_access_token("frank_deps")

    test_client = TestClient(_build_test_app())
    resp = test_client.get("/qca-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_require_role_qca_and_admin_together_satisfy_both(make_user):
    from app.security import create_access_token

    make_user("grace_deps", is_admin=True, is_qca=True)
    token = create_access_token("grace_deps")

    test_client = TestClient(_build_test_app())
    admin_resp = test_client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    qca_resp = test_client.get("/qca-only", headers={"Authorization": f"Bearer {token}"})
    assert admin_resp.status_code == 200
    assert qca_resp.status_code == 200
