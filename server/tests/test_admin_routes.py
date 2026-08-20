from app.models import Role


def test_get_oauth_settings_requires_admin(client, auth_header):
    headers = auth_header("oauthqca1", Role.qca)
    resp = client.get("/admin/oauth-settings", headers=headers)
    assert resp.status_code == 403


def test_get_oauth_settings_rejects_anonymous(client):
    resp = client.get("/admin/oauth-settings")
    assert resp.status_code == 401


def test_get_oauth_settings_default_empty(client, auth_header):
    headers = auth_header("oauthadmin1", Role.admin)
    resp = client.get("/admin/oauth-settings", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"allowed_domains": []}


def test_update_and_get_oauth_settings_round_trip(client, auth_header):
    headers = auth_header("oauthadmin2", Role.admin)
    resp = client.put(
        "/admin/oauth-settings",
        headers=headers,
        json={"allowed_domains": ["fsu.edu", "noaa.gov"]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"allowed_domains": ["fsu.edu", "noaa.gov"]}

    resp = client.get("/admin/oauth-settings", headers=headers)
    assert resp.json() == {"allowed_domains": ["fsu.edu", "noaa.gov"]}


def test_update_oauth_settings_requires_admin(client, auth_header):
    headers = auth_header("oauthqca2", Role.qca)
    resp = client.put("/admin/oauth-settings", headers=headers, json={"allowed_domains": []})
    assert resp.status_code == 403


def test_update_oauth_settings_normalizes_input(client, auth_header):
    headers = auth_header("oauthadmin3", Role.admin)
    resp = client.put(
        "/admin/oauth-settings",
        headers=headers,
        json={"allowed_domains": ["  FSU.edu  ", "", "NOAA.gov, extra.org"]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"allowed_domains": ["fsu.edu", "noaa.gov", "extra.org"]}
