def test_get_theme_default(client, auth_header):
    headers = auth_header("themeuser1", is_qca=True)
    resp = client.get("/theme", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {
        "primary_color": "#ed1f21",
        "secondary_color": "#5e6cb3",
        "tertiary_color": "#cbe3f5",
    }


def test_get_theme_works_for_plain_user(client, auth_header):
    headers = auth_header("themeuser2")
    resp = client.get("/theme", headers=headers)
    assert resp.status_code == 200


def test_get_theme_rejects_anonymous(client):
    resp = client.get("/theme")
    assert resp.status_code == 401


def test_update_theme_settings_requires_admin(client, auth_header):
    headers = auth_header("themeuser3", is_qca=True)
    resp = client.put(
        "/admin/theme-settings",
        headers=headers,
        json={
            "primary_color": "#111111",
            "secondary_color": "#222222",
            "tertiary_color": "#333333",
        },
    )
    assert resp.status_code == 403


def test_update_theme_settings_rejects_anonymous(client):
    resp = client.put(
        "/admin/theme-settings",
        json={
            "primary_color": "#111111",
            "secondary_color": "#222222",
            "tertiary_color": "#333333",
        },
    )
    assert resp.status_code == 401


def test_update_and_get_theme_round_trip(client, auth_header):
    admin_headers = auth_header("themeadmin1", is_admin=True)
    resp = client.put(
        "/admin/theme-settings",
        headers=admin_headers,
        json={
            "primary_color": "#111111",
            "secondary_color": "#222222",
            "tertiary_color": "#333333",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "primary_color": "#111111",
        "secondary_color": "#222222",
        "tertiary_color": "#333333",
    }

    other_headers = auth_header("themeuser4", is_qca=True)
    resp = client.get("/theme", headers=other_headers)
    assert resp.json() == {
        "primary_color": "#111111",
        "secondary_color": "#222222",
        "tertiary_color": "#333333",
    }


def test_update_theme_settings_rejects_invalid_hex(client, auth_header):
    headers = auth_header("themeadmin2", is_admin=True)
    resp = client.put(
        "/admin/theme-settings",
        headers=headers,
        json={
            "primary_color": "not-a-color",
            "secondary_color": "#222222",
            "tertiary_color": "#333333",
        },
    )
    assert resp.status_code == 422
