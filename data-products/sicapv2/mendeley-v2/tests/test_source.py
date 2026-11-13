import hashlib
import io
import json
import urllib.request
import zipfile
from http.client import HTTPMessage
from pathlib import Path

import pytest
from openpyxl import Workbook
from pydantic import ValidationError

from sicapv2_source_data.models import SourceManifest
from sicapv2_source_data.source import (
    SourceDataError,
    _HttpsOnlyRedirectHandler,
    _safe_infos,
    acquire_archive,
    grade_group,
    index_archive,
    load_manifest,
    parse_patch_name,
    verify_archive,
    verify_publisher_metadata,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]
PATCH_NAME = "16B0001851_Block_Region_1_0_1_xini_7827_yini_59786.jpg"


def _xlsx_bytes(header: list[str], rows: list[list[object]]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(header)
    for row in rows:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def _fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "source"
    archive_path = root / "data/raw/SICAPv2.zip"
    archive_path.parent.mkdir(parents=True)
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("SICAPv2/readme.txt", "Version 1: 2020-05\n")
        archive.writestr(
            "SICAPv2/wsi_labels.xlsx",
            _xlsx_bytes(
                ["slide_id", "patient_id", "Gleason_primary", "Gleason_secondary"],
                [["16B0001851", 667360, 4, 5]],
            ),
        )
        archive.writestr(f"SICAPv2/images/{PATCH_NAME}", b"image")
        archive.writestr(f"SICAPv2/masks/{PATCH_NAME}", b"mask")
        for path in (
            "SICAPv2/partition/Test",
            "SICAPv2/partition/Validation/Val1",
            "SICAPv2/partition/Validation/Val2",
            "SICAPv2/partition/Validation/Val3",
            "SICAPv2/partition/Validation/Val4",
        ):
            archive.writestr(
                f"{path}/Train.xlsx",
                _xlsx_bytes(
                    ["image_name", "NC", "G3", "G4", "G5", "G4C"],
                    [[PATCH_NAME, 0, 0, 0, 1, 0]],
                ),
            )
            archive.writestr(
                f"{path}/Test.xlsx",
                _xlsx_bytes(["image_name", "NC", "G3", "G4", "G5", "G4C"], []),
            )
            archive.writestr(
                f"{path}/TrainCribfriform.xlsx",
                _xlsx_bytes(["image_name", "G4C"], [[PATCH_NAME, 0]]),
            )
            archive.writestr(
                f"{path}/TestCribfriform.xlsx",
                _xlsx_bytes(["image_name", "G4C"], []),
            )
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    archive_bytes = archive_path.read_bytes()
    payload["archive"]["bytes"] = len(archive_bytes)
    payload["archive"]["sha256"] = hashlib.sha256(archive_bytes).hexdigest()
    payload["expected"] = {
        "patient_count": 1,
        "slide_count": 1,
        "patch_count": 1,
        "image_count": 1,
        "mask_count": 1,
        "archive_member_count": 24,
        "published_labelled_patch_count": 1,
        "published_patch_label_counts": {"NC": 0, "G3": 0, "G4": 0, "G5": 1, "G4C": 0},
    }
    (root / "manifest.json").write_text(json.dumps(payload), encoding="utf-8")
    return root


def test_committed_manifest_pins_authoritative_mendeley_version() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert isinstance(manifest, SourceManifest)
    assert manifest.doi == "10.17632/9xxm58dvs3.2"
    assert manifest.publisher_version == 2
    assert manifest.source_release == "Version 1: 2020-05"
    assert manifest.archive.bytes == 2159052394
    assert manifest.archive.sha256 == (
        "a28aa6a0e3831217bf31575cecfc1846607ace7ff25a4392f07052bbc7355916"
    )
    assert manifest.license.spdx_id == "CC-BY-4.0"
    assert [label.name for label in manifest.native_mask_labels] == ["NC", "GG3", "GG4", "GG5"]
    assert manifest.expected.patient_count == 95
    assert manifest.expected.slide_count == 155
    assert manifest.expected.patch_count == 18783


def test_manifest_rejects_changed_native_mask_semantics() -> None:
    payload = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    payload["native_mask_labels"][1]["name"] = "GG4"

    with pytest.raises(ValidationError, match="SICAPv2 mask labels"):
        SourceManifest.model_validate(payload)


@pytest.mark.parametrize(
    ("primary", "secondary", "expected"),
    [
        (0, 0, 0),
        (3, 3, 1),
        (3, 4, 2),
        (4, 3, 3),
        (4, 4, 4),
        (3, 5, 4),
        (5, 3, 4),
        (4, 5, 5),
        (5, 4, 5),
        (5, 5, 5),
    ],
)
def test_grade_group_preserves_published_global_score(
    primary: int, secondary: int, expected: int
) -> None:
    assert grade_group(primary, secondary) == expected


def test_grade_group_rejects_unknown_score() -> None:
    with pytest.raises(SourceDataError, match="unknown published Gleason score"):
        grade_group(3, 0)


def test_patch_name_preserves_coordinates() -> None:
    slide_id, coordinates = parse_patch_name(PATCH_NAME)

    assert slide_id == "16B0001851"
    assert coordinates.model_dump() == {
        "region": 1,
        "row": 0,
        "column": 1,
        "xini": 7827,
        "yini": 59786,
        "coordinate_frame": "publisher_wsi",
        "coordinate_unit": "source_pixel",
    }


def test_patch_name_rejects_non_native_identity() -> None:
    with pytest.raises(SourceDataError, match="invalid SICAPv2 patch filename"):
        parse_patch_name("made-up.jpg")


def test_index_archive_writes_stable_native_records(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)

    metrics = index_archive(root)

    assert metrics["patient_count"] == 1
    assert metrics["slide_count"] == 1
    assert metrics["patch_count"] == 1
    assert metrics["published_role_counts"] == {
        f"{partition}:{task}:train": 1
        for partition in (
            "test",
            "validation_val1",
            "validation_val2",
            "validation_val3",
            "validation_val4",
        )
        for task in ("cribriform_detection", "gleason_grading")
    }
    patient = json.loads((root / "outputs/patients.jsonl").read_text(encoding="utf-8"))
    slide = json.loads((root / "outputs/slides.jsonl").read_text(encoding="utf-8"))
    patch = json.loads((root / "outputs/patches.jsonl").read_text(encoding="utf-8"))
    catalog = json.loads((root / "outputs/catalog.json").read_text(encoding="utf-8"))
    assert patient["record_ref"] == "sicapv2:v2:patient:667360"
    assert slide["patient_ref"] == patient["record_ref"]
    assert slide["global_gleason_score"] == "4+5=9"
    assert slide["grade_group"] == 5
    assert patch["slide_ref"] == slide["record_ref"]
    assert patch["image"]["member_path"] == f"SICAPv2/images/{PATCH_NAME}"
    assert patch["gleason_pattern_mask"]["member_path"] == f"SICAPv2/masks/{PATCH_NAME}"
    assert patch["published_labels"] == {"NC": 0, "G3": 0, "G4": 0, "G5": 1, "G4C": 0}
    assert patch["mask_label_ids"] == [0, 1, 2, 3]
    assert catalog["archive_ref"].startswith("mendeley:9xxm58dvs3:v2:file:")
    assert len(catalog["table_artifacts"]) == 22


def test_safe_infos_rejects_archive_traversal(tmp_path: Path) -> None:
    path = tmp_path / "bad.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("../outside", b"bad")

    with zipfile.ZipFile(path) as archive, pytest.raises(SourceDataError, match="unsafe"):
        _safe_infos(archive)


def test_verify_archive_rejects_changed_bytes(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)
    archive = root / "data/raw/SICAPv2.zip"
    archive.write_bytes(b"changed")

    with pytest.raises(SourceDataError, match="byte count differs"):
        verify_archive(archive, load_manifest(root))


def test_acquire_archive_streams_and_verifies_pinned_bytes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    archive = root / "data/raw/SICAPv2.zip"
    source_bytes = archive.read_bytes()
    archive.unlink()

    class FakeOpener:
        def open(self, request: urllib.request.Request, timeout: int) -> io.BytesIO:
            assert request.full_url.startswith("https://data.mendeley.com/")
            assert timeout == 60
            return io.BytesIO(source_bytes)

    monkeypatch.setattr(urllib.request, "build_opener", lambda *_: FakeOpener())

    assert acquire_archive(root).read_bytes() == source_bytes
    assert not archive.with_suffix(".zip.part").exists()


def test_metadata_verification_uses_public_credential_free_records(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "source"
    root.mkdir()
    (root / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    def fake_json_request(url: str) -> object:
        if url.endswith("/versions"):
            return [{"version": 2, "publish_date": "2020-10-22", "available": True}]
        if "/files?" in url:
            return [
                {
                    "id": "6ab087a7-ca89-47ac-9698-f6546bb50f98",
                    "filename": "SICAPv2.zip",
                    "size": 2159052394,
                    "content_details": {
                        "sha256_hash": (
                            "a28aa6a0e3831217bf31575cecfc1846607ace7ff25a4392f07052bbc7355916"
                        ),
                        "content_type": "application/x-zip-compressed",
                    },
                }
            ]
        return {
            "id": "9xxm58dvs3",
            "doi": {"id": "10.17632/9xxm58dvs3.2"},
            "version": 2,
            "name": "SICAPv2 - Prostate Whole Slide Images with Gleason Grades Annotations",
            "publish_date": "2020-10-22T13:41:01.412Z",
            "data_licence": {
                "short_name": "CC BY 4.0",
                "full_name": "Creative Commons Attribution 4.0 International",
            },
            "contributors": [
                {
                    "profile_id": "f1d364e0-92ba-3975-9ba1-a288ab10c04e",
                    "first_name": "Julio",
                    "last_name": "Silva-Rodríguez",
                }
            ],
        }

    monkeypatch.setattr("sicapv2_source_data.source._json_request", fake_json_request)

    evidence = verify_publisher_metadata(root)

    assert evidence["verified"] is True
    assert evidence["credentials_required"] is False
    assert evidence["archive_bytes_downloaded"] is False
    committed = json.loads((root / "records/publisher-metadata.json").read_text(encoding="utf-8"))
    assert committed == evidence


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = _HttpsOnlyRedirectHandler()

    with pytest.raises(SourceDataError, match="redirect must use HTTPS"):
        handler.redirect_request(
            urllib.request.Request("https://example.test/archive.zip"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/archive.zip",
        )
