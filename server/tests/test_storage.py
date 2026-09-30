import os

import pytest

from app import storage


def test_paths_use_data_dir():
    assert storage.raw_path("shipx_2026-07-30") == storage.base_dir() / "raw" / "shipx_2026-07-30.nc"
    assert storage.temp_path("alice", "shipx_2026-07-30") == (
        storage.base_dir() / "temp" / "alice" / "shipx_2026-07-30_temp.nc"
    )
    assert storage.draft_path("alice", "shipx_2026-07-30") == (
        storage.base_dir() / "drafts" / "alice" / "v250" / "shipx_2026-07-30_v250.nc"
    )
    assert storage.published_path("shipx_2026-07-30") == (
        storage.base_dir() / "published" / "shipx_2026-07-30_v300.nc"
    )


def test_raw_path_rejects_traversal_and_empty():
    with pytest.raises(ValueError):
        storage.raw_path("../../etc/passwd")
    with pytest.raises(ValueError):
        storage.raw_path("")


def test_temp_path_rejects_traversal_and_empty():
    with pytest.raises(ValueError):
        storage.temp_path("../../../tmp", "shipx_2026-07-30")
    with pytest.raises(ValueError):
        storage.temp_path("alice", "../../etc/passwd")
    with pytest.raises(ValueError):
        storage.temp_path("", "shipx_2026-07-30")
    with pytest.raises(ValueError):
        storage.temp_path("alice", "")


def test_draft_path_rejects_traversal_and_empty():
    with pytest.raises(ValueError):
        storage.draft_path("../../../tmp", "shipx_2026-07-30")
    with pytest.raises(ValueError):
        storage.draft_path("alice", "../../etc/passwd")
    with pytest.raises(ValueError):
        storage.draft_path("", "shipx_2026-07-30")
    with pytest.raises(ValueError):
        storage.draft_path("alice", "")


def test_published_path_rejects_traversal_and_empty():
    with pytest.raises(ValueError):
        storage.published_path("../../etc/passwd")
    with pytest.raises(ValueError):
        storage.published_path("")


def test_atomic_copy_creates_dest_and_no_partial_on_failure(tmp_path):
    src = tmp_path / "source.nc"
    src.write_bytes(b"fake netcdf bytes")
    dst = tmp_path / "nested" / "dir" / "dest.nc"

    storage.atomic_copy(src, dst)

    assert dst.exists()
    assert dst.read_bytes() == b"fake netcdf bytes"
    assert not (dst.parent / (dst.name + ".tmp")).exists()


def test_avatar_path_layout():
    assert storage.avatar_path(1, "png") == storage.base_dir() / "avatars" / "1.png"
    assert storage.avatar_path(42, "jpg") == storage.base_dir() / "avatars" / "42.jpg"


# --- configurable dirs ---------------------------------------------------


def _iso(monkeypatch, tmp_path):
    monkeypatch.setattr("app.storage.settings.data_dir", str(tmp_path / "data"))
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    return a, b


def test_raw_dirs_default_and_configured(monkeypatch, tmp_path):
    a, b = _iso(monkeypatch, tmp_path)
    assert storage.raw_dirs([]) == [storage.base_dir() / "raw"]
    assert storage.raw_dirs([a, b]) == [a, b]


def test_find_raw(monkeypatch, tmp_path):
    a, b = _iso(monkeypatch, tmp_path)
    assert storage.find_raw("f", []) == storage.raw_path("f")
    assert storage.find_raw("f", [a, b]) == a / "f.nc"  # none exist
    (b / "f.nc").write_bytes(b"x")
    assert storage.find_raw("f", [a, b]) == b / "f.nc"
    (a / "f.nc").write_bytes(b"x")
    assert storage.find_raw("f", [a, b]) == a / "f.nc"


def test_list_raw_files_first_dir_wins(monkeypatch, tmp_path):
    a, b = _iso(monkeypatch, tmp_path)
    (a / "x.nc").write_bytes(b"x")
    (b / "x.nc").write_bytes(b"x")
    (b / "y.nc").write_bytes(b"x")
    (b / "z.txt").write_bytes(b"x")
    assert storage.list_raw_files([a, b]) == {"x": a / "x.nc", "y": b / "y.nc"}


def test_draft_paths_and_find_and_list(monkeypatch, tmp_path):
    a, b = _iso(monkeypatch, tmp_path)
    assert storage.draft_paths("u", "f", []) == [storage.draft_path("u", "f")]
    assert storage.draft_paths("u", "f", [a, b]) == [
        a / "u" / "f_v250.nc",
        b / "u" / "f_v250.nc",
    ]
    assert storage.find_draft("u", "f", [a, b]) == a / "u" / "f_v250.nc"
    (b / "u").mkdir()
    (b / "u" / "f_v250.nc").write_bytes(b"x")
    (a / "u").mkdir()
    (a / "u" / "g_v250.nc").write_bytes(b"x")
    assert storage.find_draft("u", "f", [a, b]) == b / "u" / "f_v250.nc"
    assert storage.list_drafts("u", [a, b]) == ["f", "g"]
    legacy = storage.draft_path("u", "h")
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"x")
    assert storage.list_drafts("u", []) == ["h"]


def test_published_paths(monkeypatch, tmp_path):
    a, b = _iso(monkeypatch, tmp_path)
    assert storage.published_paths("f", []) == [storage.published_path("f")]
    assert storage.published_paths("f", [a, b]) == [a / "f_v300.nc", b / "f_v300.nc"]


def test_configured_helpers_validate_segments(monkeypatch, tmp_path):
    a, _ = _iso(monkeypatch, tmp_path)
    for call in (
        lambda: storage.find_raw("../x", [a]),
        lambda: storage.draft_paths("u", "../x", [a]),
        lambda: storage.draft_paths("a/b", "f", [a]),
        lambda: storage.find_draft("a/b", "f", [a]),
        lambda: storage.list_drafts("a/b", [a]),
        lambda: storage.published_paths("../x", [a]),
    ):
        with pytest.raises(ValueError):
            call()


def test_helpers_skip_unreadable_dirs(monkeypatch, tmp_path):
    from pathlib import Path

    a, b = _iso(monkeypatch, tmp_path)
    (b / "f.nc").write_bytes(b"x")
    (b / "u").mkdir()
    (b / "u" / "f_v250.nc").write_bytes(b"x")

    real_exists, real_is_dir = Path.exists, Path.is_dir

    def exists(self):
        if a in self.parents or self == a:
            raise PermissionError("denied")
        return real_exists(self)

    def is_dir(self):
        if self == a or self == a / "u":
            raise PermissionError("denied")
        return real_is_dir(self)

    monkeypatch.setattr(Path, "exists", exists)
    monkeypatch.setattr(Path, "is_dir", is_dir)
    assert storage.find_raw("f", [a, b]) == b / "f.nc"
    assert storage.list_raw_files([a, b]) == {"f": b / "f.nc"}
    assert storage.find_draft("u", "f", [a, b]) == b / "u" / "f_v250.nc"
    assert storage.list_drafts("u", [a, b]) == ["f"]


def test_atomic_copy_cleans_tmp_on_failure(monkeypatch, tmp_path):
    src = tmp_path / "src.nc"
    src.write_bytes(b"new")
    dst = tmp_path / "out" / "dst.nc"
    dst.parent.mkdir()
    dst.write_bytes(b"old")

    def boom(s, d):
        open(d, "wb").write(b"par")
        raise OSError("disk full")

    monkeypatch.setattr("app.storage.shutil.copyfile", boom)
    with pytest.raises(OSError):
        storage.atomic_copy(src, dst)
    assert list(dst.parent.iterdir()) == [dst]
    assert dst.read_bytes() == b"old"
