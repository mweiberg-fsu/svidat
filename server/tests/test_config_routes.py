from app.app_config import DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS

VALID = {
    "keybindings": {"x_zoom": "alt", "y_zoom": "shift", "undo": "dblclick", "redo": "meta"},
    "documentation": [
        {"title": "  Intro  ", "body": "# Hello\n\n- one"},
        {"title": "Keys", "body": "{{x_zoom}} zooms X"},
    ],
}


def test_get_config_defaults(client, auth_header):
    headers = auth_header("cfguser1")
    resp = client.get("/config", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {
        "keybindings": DEFAULT_KEYBINDINGS,
        "documentation": DEFAULT_DOCUMENTATION,
    }


def test_get_config_requires_auth(client):
    assert client.get("/config").status_code == 401


def test_update_config_round_trip(client, auth_header):
    admin_headers = auth_header("cfgadmin1", is_admin=True)
    resp = client.put("/admin/config", headers=admin_headers, json=VALID)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["keybindings"] == VALID["keybindings"]
    assert [t["title"] for t in body["documentation"]] == ["Intro", "Keys"]

    other = auth_header("cfguser2")
    assert client.get("/config", headers=other).json() == body


def test_update_config_requires_admin(client, auth_header):
    headers = auth_header("cfgqca1", is_qca=True)
    assert client.put("/admin/config", headers=headers, json=VALID).status_code == 403


def test_update_config_rejects_duplicate_bindings(client, auth_header):
    headers = auth_header("cfgadmin2", is_admin=True)
    body = {**VALID, "keybindings": {**VALID["keybindings"], "y_zoom": "alt"}}
    assert client.put("/admin/config", headers=headers, json=body).status_code == 422


def test_update_config_rejects_invalid_triggers(client, auth_header):
    headers = auth_header("cfgadmin3", is_admin=True)
    # dblclick is only valid for click gestures, not drags.
    for bindings in (
        {**VALID["keybindings"], "x_zoom": "dblclick", "undo": "ctrl"},
        {**VALID["keybindings"], "undo": "hyper"},
    ):
        resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
        assert resp.status_code == 422, bindings


def test_update_config_rejects_bad_documentation(client, auth_header):
    headers = auth_header("cfgadmin4", is_admin=True)
    for docs in (
        [],
        [{"title": "   ", "body": "x"}],
        [{"title": "x" * 41, "body": "x"}],
        [{"title": "t", "body": "x" * 20001}],
        [{"title": f"t{i}", "body": ""} for i in range(11)],
    ):
        resp = client.put("/admin/config", headers=headers, json={**VALID, "documentation": docs})
        assert resp.status_code == 422, docs
