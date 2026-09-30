import os
import sys

import pytest

from app.dir_browser import list_directory


def test_lists_subdirectories_only_sorted_and_skips_hidden(tmp_path):
    (tmp_path / "beta").mkdir()
    (tmp_path / "Alpha").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "file.nc").write_text("x")

    result = list_directory(str(tmp_path))

    assert result["path"] == str(tmp_path)
    assert result["parent"] == str(tmp_path.parent)
    assert [d["name"] for d in result["dirs"]] == ["Alpha", "beta"]
    assert result["dirs"][0]["path"] == str(tmp_path / "Alpha")
    assert result["readable"] and result["writable"]


def test_normalizes_path(tmp_path):
    (tmp_path / "a").mkdir()
    result = list_directory(str(tmp_path / "a" / ".."))
    assert result["path"] == str(tmp_path)


def test_root_has_no_parent():
    root = os.path.abspath(os.sep)
    assert list_directory(root)["parent"] is None


@pytest.mark.parametrize("bad", ["relative/dir", "", "/nope/definitely/missing"])
def test_rejects_bad_paths(bad):
    with pytest.raises(ValueError):
        list_directory(bad)


def test_rejects_file(tmp_path):
    f = tmp_path / "f.txt"
    f.write_text("x")
    with pytest.raises(ValueError, match="is not a directory"):
        list_directory(str(f))


@pytest.mark.skipif(sys.platform == "win32" or os.geteuid() == 0, reason="chmod has no effect")
def test_reports_unwritable_subdir(tmp_path):
    ro = tmp_path / "ro"
    ro.mkdir()
    ro.chmod(0o555)
    try:
        entry = list_directory(str(tmp_path))["dirs"][0]
        assert entry["name"] == "ro"
        assert entry["readable"] is True
        assert entry["writable"] is False
    finally:
        ro.chmod(0o755)


def test_browse_route_defaults_to_data_dir_and_requires_admin(client, auth_header):
    os.makedirs(os.environ["DATA_DIR"], exist_ok=True)
    admin = auth_header("browseadmin", is_admin=True)
    body = client.get("/admin/browse", headers=admin).json()
    assert body["path"] == os.path.abspath(os.environ["DATA_DIR"])
    labels = [s["label"] for s in body["shortcuts"]]
    assert labels == ["Data folder", "Home", "Root"]

    plain = auth_header("browseplain")
    assert client.get("/admin/browse", headers=plain).status_code == 403


def test_browse_route_lists_given_path_and_reports_errors(client, auth_header, tmp_path):
    (tmp_path / "sub").mkdir()
    admin = auth_header("browseadmin2", is_admin=True)
    body = client.get("/admin/browse", params={"path": str(tmp_path)}, headers=admin).json()
    assert [d["name"] for d in body["dirs"]] == ["sub"]

    resp = client.get("/admin/browse", params={"path": str(tmp_path / "missing")}, headers=admin)
    assert resp.status_code == 400
    assert "does not exist" in resp.text


def test_browse_route_starts_at_home_when_data_dir_missing(client, auth_header, monkeypatch, tmp_path):
    monkeypatch.setattr("app.storage.settings.data_dir", str(tmp_path / "not-created"))
    admin = auth_header("browseadmin3", is_admin=True)
    body = client.get("/admin/browse", headers=admin).json()
    assert body["path"] == os.path.normpath(os.path.expanduser("~"))
