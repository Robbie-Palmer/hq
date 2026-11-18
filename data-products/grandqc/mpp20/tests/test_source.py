import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest
from PIL import Image

from grandqc_source_data.models import SourceManifest
from grandqc_source_data.source import (
    SourceDataError,
    _mask_counts,
    _safe_members,
    acquire_archive,
    index_archive,
    load_manifest,
    verify_archive,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def test_committed_manifest_preserves_grandqc_native_language() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert isinstance(manifest, SourceManifest)
    assert manifest.native_role == "publisher_test_dataset"
    assert {label.name for label in manifest.native_labels} == {
        "non_annotated_ignore",
        "tissue",
        "fold",
        "dark_spot_and_foreign_object",
        "pen_marker",
        "edge_and_air_bubble",
        "out_of_focus",
        "background",
    }
    assert manifest.expected.paired_patch_count == 14242


def test_mask_counts_retain_native_values(tmp_path: Path) -> None:
    path = tmp_path / "mask.png"
    image = Image.new("L", (2, 2))
    image.putdata([0, 1, 5, 5])
    image.save(path)

    assert _mask_counts(path, set(range(8))) == {0: 1, 1: 1, 5: 2}


def test_safe_members_rejects_traversal(tmp_path: Path) -> None:
    path = tmp_path / "bad.tar"
    with tarfile.open(path, "w") as archive:
        payload = b"bad"
        member = tarfile.TarInfo("../outside")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))

    with tarfile.open(path, "r") as archive:
        try:
            _safe_members(archive)
        except RuntimeError as error:
            assert "unsafe archive member" in str(error)
        else:
            raise AssertionError("unsafe archive member was accepted")


def test_manifest_json_is_stable() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))

    assert payload["archive"]["bytes"] == 928040960
    assert payload["archive"]["sha256"] == (
        "1b0b412e7bbcb10311357cce24c890e60fc84e357d3b8d12e49f3b44d9c7613d"
    )


def _image_bytes(format_name: str, values: list[int]) -> bytes:
    image = Image.new("L", (2, 2))
    image.putdata(values)
    output = io.BytesIO()
    image.save(output, format=format_name)
    return output.getvalue()


def _add_bytes(archive: tarfile.TarFile, name: str, payload: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(payload)
    archive.addfile(member, io.BytesIO(payload))


def _fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "source"
    archive_path = root / "data/raw/MPP20.tar"
    archive_path.parent.mkdir(parents=True)
    with tarfile.open(archive_path, "w") as archive:
        prefix = "MPP20/Breast/source-group/ALL/sample"
        _add_bytes(archive, f"{prefix}.jpg", _image_bytes("JPEG", [1, 1, 1, 1]))
        _add_bytes(archive, f"{prefix}.png", _image_bytes("PNG", [0, 1, 2, 5]))
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    archive_bytes = archive_path.read_bytes()
    payload["archive"]["bytes"] = len(archive_bytes)
    payload["archive"]["md5"] = hashlib.md5(archive_bytes).hexdigest()  # noqa: S324
    payload["archive"]["sha256"] = hashlib.sha256(archive_bytes).hexdigest()
    payload["expected"]["paired_patch_count"] = 1
    (root / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    return root


def test_index_archive_extracts_pairs_and_writes_native_metrics(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)

    metrics = index_archive(root)

    assert metrics["paired_patch_count"] == 1
    assert metrics["nonempty_source_group_count"] == 1
    record = json.loads((root / "outputs/native-index.jsonl").read_text(encoding="utf-8"))
    assert record["source_group_id"] == "source-group"
    assert record["image_path"].startswith("data/native/mpp20/MPP20/")
    assert record["native_label_pixel_counts"] == {
        "edge_and_air_bubble": 1,
        "fold": 1,
        "non_annotated_ignore": 1,
        "tissue": 1,
    }


def test_verify_archive_rejects_changed_bytes(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)
    manifest = load_manifest(root)
    archive = root / "data/raw/MPP20.tar"
    archive.write_bytes(b"changed")

    try:
        verify_archive(archive, manifest)
    except SourceDataError as error:
        assert "byte count differs" in str(error)
    else:
        raise AssertionError("changed archive was accepted")


def test_acquire_archive_streams_and_verifies_pinned_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    archive = root / "data/raw/MPP20.tar"
    source_bytes = archive.read_bytes()
    archive.unlink()

    def fake_urlopen(_request: object, *, timeout: int) -> io.BytesIO:
        assert timeout == 60
        return io.BytesIO(source_bytes)

    monkeypatch.setattr(
        "grandqc_source_data.source.urlopen",
        fake_urlopen,
    )

    acquired = acquire_archive(root)

    assert acquired == archive
    assert acquired.read_bytes() == source_bytes
    assert not acquired.with_suffix(".tar.part").exists()
