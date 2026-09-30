import os
import sys

import pytest


def _admin(auth_header, name="pathadmin"):
    return auth_header(name, is_admin=True)


def test_get_paths_defaults(client, auth_header):
    body = client.get("/admin/paths", headers=_admin(auth_header, "pa1")).json()
    assert body["raw_dirs"] == [] and body["draft_dirs"] == [] and body["published_dirs"] == []
    assert body["defaults"]["raw"].endswith("raw")
    assert body["defaults"]["draft"].endswith("drafts")
    assert body["defaults"]["published"].endswith("published")


def test_put_paths_round_trip_and_dedupe(client, auth_header, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir(); b.mkdir()
    headers = _admin(auth_header, "pa2")
    body = {"raw_dirs": [str(a), str(b), str(a) + "/"], "draft_dirs": [str(a)], "published_dirs": [str(b)]}
    resp = client.put("/admin/paths", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["raw_dirs"] == [str(a), str(b)]
    assert client.get("/admin/paths", headers=headers).json()["draft_dirs"] == [str(a)]


def test_paths_require_admin(client, auth_header):
    headers = auth_header("paplain")
    assert client.get("/admin/paths", headers=headers).status_code == 403
    assert client.put("/admin/paths", json={"raw_dirs": [], "draft_dirs": [], "published_dirs": []}, headers=headers).status_code == 403


@pytest.mark.parametrize("bad,msg", [("relative/dir", "absolute"), ("", "blank"), ("   ", "blank")])
def test_put_paths_rejects_bad_entries(client, auth_header, bad, msg):
    resp = client.put(
        "/admin/paths",
        json={"raw_dirs": [bad], "draft_dirs": [], "published_dirs": []},
        headers=_admin(auth_header, f"pa3{abs(hash(bad))}"),
    )
    assert resp.status_code == 422
    assert msg in resp.text


def test_put_paths_rejects_missing_and_file(client, auth_header, tmp_path):
    f = tmp_path / "file.txt"
    f.write_text("x")
    headers = _admin(auth_header, "pa4")
    for path, msg in [(tmp_path / "nope", "does not exist"), (f, "is not a directory")]:
        resp = client.put("/admin/paths", json={"raw_dirs": [str(path)], "draft_dirs": [], "published_dirs": []}, headers=headers)
        assert resp.status_code == 422
        assert msg in resp.text and str(path) in resp.text


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0, reason="chmod has no effect")
def test_put_paths_rejects_unwritable_write_dir(client, auth_header, tmp_path):
    ro = tmp_path / "ro"
    ro.mkdir()
    ro.chmod(0o555)
    try:
        resp = client.put(
            "/admin/paths",
            json={"raw_dirs": [str(ro)], "draft_dirs": [str(ro)], "published_dirs": []},
            headers=_admin(auth_header, "pa5"),
        )
        assert resp.status_code == 422
        assert "is not writable" in resp.text
    finally:
        ro.chmod(0o755)


def test_put_paths_rejects_more_than_ten(client, auth_header, tmp_path):
    dirs = []
    for i in range(11):
        d = tmp_path / f"d{i}"
        d.mkdir()
        dirs.append(str(d))
    resp = client.put("/admin/paths", json={"raw_dirs": dirs, "draft_dirs": [], "published_dirs": []}, headers=_admin(auth_header, "pa6"))
    assert resp.status_code == 422
    assert "at most 10" in resp.text
