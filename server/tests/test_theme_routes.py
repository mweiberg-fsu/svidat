def test_get_theme_default(client, auth_header):
    headers = auth_header("themeuser1", is_qca=True)
    resp = client.get("/theme", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {
        "primary_color": "#ed1f21",
        "secondary_color": "#5e6cb3",
        "tertiary_color": "#cbe3f5",
        "site_name": "SVIDAT",
        "save_draft_label": "Save draft (v250)",
        "publish_label": "Publish (v300)",
        "has_logo": False,
    }


def test_get_theme_works_for_plain_user(client, auth_header):
    headers = auth_header("themeuser2")
    resp = client.get("/theme", headers=headers)
    assert resp.status_code == 200


def test_get_theme_is_public(client):
    resp = client.get("/theme")
    assert resp.status_code == 200
    assert resp.json()["site_name"] == "SVIDAT"


def test_get_theme_logo_is_public(client, auth_header):
    assert client.get("/theme/logo").status_code == 404
    admin_headers = auth_header("themeadmin10", is_admin=True)
    client.post(
        "/admin/theme-logo",
        headers=admin_headers,
        files={"file": ("logo.png", PNG_BYTES, "image/png")},
    )
    resp = client.get("/theme/logo")
    assert resp.status_code == 200
    assert resp.content == PNG_BYTES
    client.delete("/admin/theme-logo", headers=admin_headers)


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
        "site_name": "SVIDAT",
        "save_draft_label": "Save draft (v250)",
        "publish_label": "Publish (v300)",
        "has_logo": False,
    }

    other_headers = auth_header("themeuser4", is_qca=True)
    resp = client.get("/theme", headers=other_headers)
    assert resp.json() == {
        "primary_color": "#111111",
        "secondary_color": "#222222",
        "tertiary_color": "#333333",
        "site_name": "SVIDAT",
        "save_draft_label": "Save draft (v250)",
        "publish_label": "Publish (v300)",
        "has_logo": False,
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


COLORS = {
    "primary_color": "#111111",
    "secondary_color": "#222222",
    "tertiary_color": "#333333",
}
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def test_update_site_name_round_trip(client, auth_header):
    admin_headers = auth_header("themeadmin3", is_admin=True)
    resp = client.put(
        "/admin/theme-settings",
        headers=admin_headers,
        json={**COLORS, "site_name": "  My QC Tool  "},
    )
    assert resp.status_code == 200
    assert resp.json()["site_name"] == "My QC Tool"

    # Omitting site_name leaves it unchanged.
    resp = client.put("/admin/theme-settings", headers=admin_headers, json=COLORS)
    assert resp.json()["site_name"] == "My QC Tool"

    other_headers = auth_header("themeuser5")
    assert client.get("/theme", headers=other_headers).json()["site_name"] == "My QC Tool"


def test_update_button_labels_round_trip(client, auth_header):
    admin_headers = auth_header("themelabels1", is_admin=True)
    resp = client.put(
        "/admin/theme-settings",
        headers=admin_headers,
        json={**COLORS, "save_draft_label": " Save QC ", "publish_label": "Release"},
    )
    assert resp.status_code == 200
    assert resp.json()["save_draft_label"] == "Save QC"
    assert resp.json()["publish_label"] == "Release"

    # Omitting labels leaves them unchanged.
    resp = client.put("/admin/theme-settings", headers=admin_headers, json=COLORS)
    assert resp.json()["save_draft_label"] == "Save QC"
    assert resp.json()["publish_label"] == "Release"


def test_update_button_labels_reject_blank_or_too_long(client, auth_header):
    headers = auth_header("themelabels2", is_admin=True)
    for body in (
        {"save_draft_label": "  "},
        {"publish_label": ""},
        {"save_draft_label": "x" * 33},
        {"publish_label": "x" * 33},
    ):
        resp = client.put("/admin/theme-settings", headers=headers, json={**COLORS, **body})
        assert resp.status_code == 422, body


def test_update_site_name_rejects_blank(client, auth_header):
    headers = auth_header("themeadmin4", is_admin=True)
    resp = client.put(
        "/admin/theme-settings", headers=headers, json={**COLORS, "site_name": "   "}
    )
    assert resp.status_code == 422


def test_update_site_name_rejects_too_long(client, auth_header):
    headers = auth_header("themeadmin5", is_admin=True)
    resp = client.put(
        "/admin/theme-settings", headers=headers, json={**COLORS, "site_name": "x" * 65}
    )
    assert resp.status_code == 422


def test_logo_upload_get_and_delete(client, auth_header):
    admin_headers = auth_header("themeadmin6", is_admin=True)
    user_headers = auth_header("themeuser6")

    assert client.get("/theme/logo", headers=user_headers).status_code == 404

    resp = client.post(
        "/admin/theme-logo",
        headers=admin_headers,
        files={"file": ("logo.png", PNG_BYTES, "image/png")},
    )
    assert resp.status_code == 200
    assert resp.json()["has_logo"] is True
    assert client.get("/theme", headers=user_headers).json()["has_logo"] is True

    resp = client.get("/theme/logo", headers=user_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == PNG_BYTES

    resp = client.delete("/admin/theme-logo", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["has_logo"] is False
    assert client.get("/theme/logo", headers=user_headers).status_code == 404


def test_logo_upload_replaces_previous_file(client, auth_header):
    from app import storage

    admin_headers = auth_header("themeadmin7", is_admin=True)
    client.post(
        "/admin/theme-logo",
        headers=admin_headers,
        files={"file": ("logo.png", PNG_BYTES, "image/png")},
    )
    client.post(
        "/admin/theme-logo",
        headers=admin_headers,
        files={"file": ("logo.jpg", b"\xff\xd8\xff", "image/jpeg")},
    )
    assert not storage.logo_path("png").exists()
    assert storage.logo_path("jpg").exists()
    client.delete("/admin/theme-logo", headers=admin_headers)


def test_logo_upload_requires_admin(client, auth_header):
    headers = auth_header("themeuser7", is_qca=True)
    resp = client.post(
        "/admin/theme-logo",
        headers=headers,
        files={"file": ("logo.png", PNG_BYTES, "image/png")},
    )
    assert resp.status_code == 403
    assert client.delete("/admin/theme-logo", headers=headers).status_code == 403


def test_logo_upload_rejects_unsupported_type(client, auth_header):
    headers = auth_header("themeadmin8", is_admin=True)
    resp = client.post(
        "/admin/theme-logo",
        headers=headers,
        files={"file": ("logo.svg", b"<svg/>", "image/svg+xml")},
    )
    assert resp.status_code == 400


def test_logo_upload_rejects_oversized_file(client, auth_header):
    headers = auth_header("themeadmin9", is_admin=True)
    resp = client.post(
        "/admin/theme-logo",
        headers=headers,
        files={"file": ("logo.png", b"\x00" * (2 * 1024 * 1024 + 1), "image/png")},
    )
    assert resp.status_code == 400
