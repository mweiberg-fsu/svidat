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
