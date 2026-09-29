from app.app_config import DEFAULT_DOCUMENTATION, DEFAULT_KEYBINDINGS

VALID = {
    "keybindings": {
        "x_zoom": "alt",
        "y_zoom": "shift",
        "box_zoom": "ctrl+meta",
        "flag_select": "none",
        "undo": "dblclick",
        "redo": "meta",
    },
    "documentation": [
        {"title": "  Intro  ", "body": "# Hello\n\n- one"},
        {"title": "Keys", "body": "{{x_zoom}} zooms X"},
    ],
}


def test_get_config_defaults(client, auth_header):
    headers = auth_header("cfguser1")
    resp = client.get("/config", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "keybindings": DEFAULT_KEYBINDINGS,
        "documentation": DEFAULT_DOCUMENTATION,
        "user_keybindings": None,
        "custom_triggers": [],
        "user_custom_triggers": [],
    }
    assert body["keybindings"]["box_zoom"] == "shift+ctrl"
    assert body["keybindings"]["flag_select"] == "none"


def test_config_user_keybindings_null_by_default(client, auth_header):
    resp = client.get("/config", headers=auth_header("kbuser1"))
    assert resp.status_code == 200
    assert resp.json()["user_keybindings"] is None


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


def test_update_config_rejects_duplicate_among_new_keys(client, auth_header):
    headers = auth_header("cfgadmin6", is_admin=True)
    # box_zoom sharing x_zoom's trigger is just as invalid as any other pair.
    body = {**VALID, "keybindings": {**VALID["keybindings"], "box_zoom": VALID["keybindings"]["x_zoom"]}}
    assert client.put("/admin/config", headers=headers, json=body).status_code == 422


def test_update_config_rejects_invalid_triggers(client, auth_header):
    headers = auth_header("cfgadmin3", is_admin=True)
    # dblclick is only valid for click gestures, not drags.
    for bindings in (
        {**VALID["keybindings"], "x_zoom": "dblclick", "undo": "ctrl"},
        {**VALID["keybindings"], "undo": "hyper"},
        # "none" is a drag-only trigger, not valid for a click gesture.
        {**VALID["keybindings"], "undo": "none"},
        # Pairs are drag-only, not valid for a click gesture.
        {**VALID["keybindings"], "undo": "shift+ctrl"},
        # Non-canonical modifier order is rejected even though shift+ctrl is valid.
        {**VALID["keybindings"], "x_zoom": "ctrl+shift"},
    ):
        resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
        assert resp.status_code == 422, bindings


def test_update_config_returns_admins_own_keybindings(client, auth_header):
    admin_headers = auth_header("cfgadmin5", is_admin=True)
    mine = {
        "x_zoom": "alt",
        "y_zoom": "shift",
        "box_zoom": "shift+meta",
        "flag_select": "none",
        "undo": "meta",
        "redo": "dblclick",
    }
    save_resp = client.put("/users/me/keybindings", headers=admin_headers, json=mine)
    assert save_resp.status_code == 200, save_resp.text

    resp = client.put("/admin/config", headers=admin_headers, json=VALID)
    assert resp.status_code == 200, resp.text
    assert resp.json()["user_keybindings"] == mine


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


def test_update_config_accepts_canonical_triggers(client, auth_header):
    headers = auth_header("cfgadmin7", is_admin=True)
    bindings = {
        "x_zoom": "shift+alt/right/drag",
        "y_zoom": "shift",
        "box_zoom": "ctrl+meta",
        "flag_select": "none",
        "undo": "none/middle/click",
        "redo": "meta",
    }
    resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
    assert resp.status_code == 200, resp.text
    assert resp.json()["keybindings"] == bindings


def test_update_config_rejects_legacy_canonical_duplicate(client, auth_header):
    headers = auth_header("cfgadmin8", is_admin=True)
    # box_zoom's canonical form duplicates x_zoom's legacy "shift" (rule 4).
    bindings = {
        **VALID["keybindings"],
        "x_zoom": "shift",
        "box_zoom": "shift/left/drag",
    }
    resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
    assert resp.status_code == 422, resp.text
    assert 'each gesture needs a different binding' in resp.text


def test_update_config_rejects_click_vs_drag_conflict(client, auth_header):
    headers = auth_header("cfgadmin9", is_admin=True)
    # undo's click shares (mods, button) with x_zoom's drag (rule 5).
    bindings = {
        **VALID["keybindings"],
        "x_zoom": "shift",
        "y_zoom": "ctrl",  # keep the six distinct so only rule 5 applies
        "undo": "shift/left/click",
    }
    resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
    assert resp.status_code == 422, resp.text
    assert "a click binding can't use the same keys and button as a drag binding" in resp.text


def test_update_config_rejects_undo_redo_click_dblclick_conflict(client, auth_header):
    headers = auth_header("cfgadmin10", is_admin=True)
    # undo and redo share (mods, button) with click vs dblclick (rule 6).
    bindings = {
        **VALID["keybindings"],
        "undo": "alt/right/click",
        "redo": "alt/right/dblclick",
    }
    resp = client.put("/admin/config", headers=headers, json={**VALID, "keybindings": bindings})
    assert resp.status_code == 422, resp.text
    assert "undo and redo can't be the click and double-click of the same keys and button" in resp.text


def test_get_config_custom_triggers_empty_by_default(client, auth_header):
    headers = auth_header("ctdefault")
    body = client.get("/config", headers=headers).json()
    assert body["custom_triggers"] == []
    assert body["user_custom_triggers"] == []
