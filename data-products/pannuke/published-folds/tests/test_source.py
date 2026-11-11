import hashlib
import io
import json
import urllib.request
import zipfile
from http.client import HTTPMessage
from pathlib import Path

import numpy as np
import pytest

from pannuke_source_data.models import SourceManifest
from pannuke_source_data.source import (
    SourceDataError,
    _HttpsOnlyRedirectHandler,
    _safe_archive,
    acquire_dataset,
    index_dataset,
    load_manifest,
    verify_archive,
    verify_publisher_metadata,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _array_bytes(value: np.ndarray) -> bytes:
    target = io.BytesIO()
    np.save(target, value, allow_pickle=False)
    return target.getvalue()


def _fold_zip(fold: int, tissues: list[str], *, mask_channels: int = 6) -> bytes:
    count = len(tissues)
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        prefix = f"Fold {fold}"
        archive.writestr(f"{prefix}/README.md", f"PanNuke fold {fold}\n")
        archive.writestr(f"{prefix}/masks/by-nc-sa.md", "CC BY-NC-SA 4.0\n")
        archive.writestr(
            f"{prefix}/images/fold{fold}/images.npy",
            _array_bytes(np.zeros((count, 2, 2, 3), dtype=np.float64)),
        )
        archive.writestr(
            f"{prefix}/images/fold{fold}/types.npy",
            _array_bytes(np.array(tissues, dtype="<U13")),
        )
        archive.writestr(
            f"{prefix}/masks/fold{fold}/masks.npy",
            _array_bytes(np.zeros((count, 2, 2, mask_channels), dtype=np.float64)),
        )
    return target.getvalue()


def _fixture_root(tmp_path: Path, *, mask_channels: int = 6) -> tuple[Path, dict[str, bytes]]:
    root = tmp_path / "source"
    raw = root / "data/raw"
    raw.mkdir(parents=True)
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["array_contract"]["height"] = 2
    payload["array_contract"]["width"] = 2
    tissues = payload["tissue_identities"]
    fold_tissues = {1: tissues[:7], 2: tissues[7:13], 3: tissues[13:]}
    contents: dict[str, bytes] = {}
    for archive in payload["archives"]:
        fold = archive["fold"]
        value = _fold_zip(fold, fold_tissues[fold], mask_channels=mask_channels)
        contents[archive["filename"]] = value
        (raw / archive["filename"]).write_bytes(value)
        sha1 = hashlib.sha1(value).hexdigest()
        archive.update(
            {
                "bytes": len(value),
                "sha1": sha1,
                "sha256": hashlib.sha256(value).hexdigest(),
                "publisher_etag": sha1,
                "record_count": len(fold_tissues[fold]),
            }
        )
    (root / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    return root, contents


def _headers(archive: dict[str, object]) -> HTTPMessage:
    headers = HTTPMessage()
    headers["Content-Length"] = str(archive["bytes"])
    headers["ETag"] = f'"{archive["publisher_etag"]}"'
    headers["Last-Modified"] = str(archive["publisher_last_modified"])
    headers["Content-Type"] = str(archive["publisher_content_type"])
    return headers


class _FakeResponse(io.BytesIO):
    def __init__(self, value: bytes, headers: HTTPMessage | None = None) -> None:
        super().__init__(value)
        self.headers = headers if headers is not None else HTTPMessage()


def test_committed_manifest_preserves_publisher_semantics() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert isinstance(manifest, SourceManifest)
    assert [archive.fold for archive in manifest.archives] == [1, 2, 3]
    assert sum(archive.record_count for archive in manifest.archives) == 7901
    assert [
        (item.training_fold, item.validation_fold, item.testing_fold)
        for item in manifest.publisher_role_arrangements
    ] == [(1, 2, 3), (2, 1, 3), (3, 2, 1)]
    assert len(manifest.tissue_identities) == 19
    assert [channel.publisher_name for channel in manifest.array_contract.cell_class_channels] == [
        "Neoplastic cells",
        "Inflammatory",
        "Connective/Soft tissue cells",
        "Dead Cells",
        "Epithelial",
        "Background",
    ]
    background = manifest.array_contract.cell_class_channels[-1]
    assert background.channel_index == 5
    assert background.publisher_readme_value == 6
    assert manifest.license.spdx_id == "CC-BY-NC-SA-4.0"
    assert "no sample, slide, patient, or group identifier" in manifest.identity_evidence
    assert "publishes no checksum manifest" in manifest.checksum_provenance


def test_manifest_rejects_changed_fold_identity() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["archives"][0]["filename"] = "fold_2.zip"

    with pytest.raises(ValueError, match="filename must match"):
        SourceManifest.model_validate(payload)


def test_index_keeps_source_coordinates_and_artifact_references(tmp_path: Path) -> None:
    root, _ = _fixture_root(tmp_path)

    metrics = index_dataset(root)

    records = [
        json.loads(line)
        for line in (root / "outputs/native-index.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    first = records[0]
    assert metrics["record_count"] == 19
    assert metrics["records_by_fold"] == {"1": 7, "2": 6, "3": 6}
    assert first["repository_record_id"] == "pannuke:fold-1:000000"
    assert first["source_fold"] == 1
    assert first["source_index"] == 0
    assert first["tissue_identity"] == "Adrenal_gland"
    assert first["publisher_roles"] == {
        "arrangement_1": "training",
        "arrangement_2": "validation",
        "arrangement_3": "testing",
    }
    assert first["image_artifact"]["member"] == "Fold 1/images/fold1/images.npy"
    assert first["image_artifact"]["array_index"] == 0
    assert first["instance_mask_annotation"]["member"] == "Fold 1/masks/fold1/masks.npy"
    assert first["instance_mask_annotation"]["element_shape"] == [2, 2, 6]
    assert "patient_id" not in first


def test_index_rejects_mask_shape_drift(tmp_path: Path) -> None:
    root, _ = _fixture_root(tmp_path, mask_channels=5)

    with pytest.raises(SourceDataError, match="array shape differs"):
        index_dataset(root)


def test_safe_archive_rejects_traversal() -> None:
    value = io.BytesIO()
    with zipfile.ZipFile(value, "w") as archive:
        archive.writestr("../outside", b"bad")
    value.seek(0)

    with zipfile.ZipFile(value) as archive, pytest.raises(SourceDataError, match="unsafe"):
        _safe_archive(archive)


def test_verify_archive_rejects_changed_bytes(tmp_path: Path) -> None:
    root, _ = _fixture_root(tmp_path)
    manifest = load_manifest(root)
    path = root / "data/raw/fold_1.zip"
    path.write_bytes(b"changed")

    with pytest.raises(SourceDataError, match="byte count differs"):
        verify_archive(path, manifest.archives[0])


def test_acquire_streams_and_verifies_all_archives(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root, contents = _fixture_root(tmp_path)
    for path in (root / "data/raw").glob("*.zip"):
        path.unlink()

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> _FakeResponse:
            assert timeout == 60
            return _FakeResponse(contents[Path(request.full_url).name])

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FakeOpener())

    acquired = acquire_dataset(root)

    assert [path.name for path in acquired] == ["fold_1.zip", "fold_2.zip", "fold_3.zip"]
    assert (root / "data/raw/acquisition.json").is_file()
    assert not list((root / "data/raw").glob("*.part"))


def test_metadata_verification_uses_headers_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    archives = {archive["filename"]: archive for archive in payload["archives"]}

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> _FakeResponse:
            assert request.method == "HEAD"
            assert timeout == 60
            return _FakeResponse(b"", _headers(archives[Path(request.full_url).name]))

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FakeOpener())
    output = tmp_path / "publisher-metadata.json"

    evidence = verify_publisher_metadata(PROJECT_DIR, output)

    assert len(evidence.archives) == 3
    assert evidence.archives[0].bytes == 700275281
    assert output.is_file()


def test_metadata_verification_rejects_header_drift(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    headers = _headers(payload["archives"][0])
    headers.replace_header("Content-Length", "1")

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> _FakeResponse:
            del request, timeout
            return _FakeResponse(b"", headers)

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FakeOpener())

    with pytest.raises(SourceDataError, match="Content-Length differs"):
        verify_publisher_metadata(PROJECT_DIR)


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = _HttpsOnlyRedirectHandler()

    with pytest.raises(SourceDataError, match="redirect must use HTTPS"):
        handler.redirect_request(
            urllib.request.Request("https://example.test/fold.zip"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/fold.zip",
        )
