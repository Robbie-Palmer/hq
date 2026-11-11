import hashlib
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Never, Self

import pytest
from PIL import Image

from skin_frozen_ffpe_preview.models import SourceFile, SourceManifest
from skin_frozen_ffpe_preview.source import (
    SourceDataError,
    _download,
    _json_response,
    _probe_mrxs_named_jpeg,
    _verify_xml,
    acquire_file,
    load_manifest,
    publish_contracts,
    publish_index,
    verify_live_metadata,
    verify_live_payloads,
    verify_local_file,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _manifest_copy(root: Path) -> None:
    (root / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )


def _manifest() -> SourceManifest:
    return load_manifest(PROJECT_DIR)


def _live_payload() -> dict[str, object]:
    manifest = _manifest()
    return {
        "id": manifest.source.record_id,
        "doi": manifest.source.doi,
        "updated": "2026-06-24T06:16:22.727435+00:00",
        "metadata": {
            "title": manifest.title,
            "publication_date": "2026-02-26",
            "license": {"id": "cc-by-4.0"},
        },
        "files": [
            {"key": item.name, "size": item.bytes, "checksum": f"md5:{item.md5}"}
            for item in reversed(manifest.files)
        ],
    }


def test_manifest_preserves_preview_cases_preparations_and_files() -> None:
    manifest = _manifest()

    assert [case.case_id for case in manifest.preview.cases] == [
        "YW_DP1_045",
        "YW_DP2_129",
        "YW_DP3_011",
        "YW_DP4_071",
        "YW_DP5_030",
    ]
    assert {case.subtype for case in manifest.preview.cases} == {
        "extramammary Paget disease",
        "Bowen disease",
        "invasive squamous cell carcinoma",
        "basal cell carcinoma",
        "melanoma",
    }
    assert len(manifest.files) == 30
    assert sum(item.bytes for item in manifest.files) == 418147
    assert sum(item.role == "mrxs_named_slide_file" for item in manifest.files) == 10
    assert sum(item.role == "scanner_metadata_xml" for item in manifest.files) == 10
    assert sum(item.role == "annotation_xml" for item in manifest.files) == 10
    assert {item.preparation for item in manifest.files} == {"frozen", "ffpe"}


def test_manifest_keeps_preview_separate_from_full_paper_cohort() -> None:
    manifest = _manifest()
    paper = manifest.paper_context

    assert manifest.preview.preparation_pair_count == 5
    assert paper.paired_frozen_ffpe_slide_count == 1192
    assert paper.total_slide_count == 2594
    assert paper.patient_count == 283
    assert paper.additional_main_tumor_ffpe_slide_count == 210
    assert paper.preview_contains_full_cohort is False
    assert paper.section_relation.relationship == "adjacent, non-identical tissue levels"
    assert paper.section_relation.spatial_registration is False
    assert "deeper" in paper.section_relation.published_mismatch


def test_manifest_preserves_diagnostic_workflow_roles_and_rights() -> None:
    manifest = _manifest()
    discrepancy = manifest.paper_context.diagnostic_discrepancy

    assert discrepancy.grades == ["concordant", "minimal", "minor", "major"]
    assert (discrepancy.minimal_count, discrepancy.minor_count, discrepancy.major_count) == (
        30,
        14,
        16,
    )
    assert discrepancy.total_count == 60
    assert discrepancy.expert_reassessment_case_count == 55
    assert manifest.paper_context.workflow.frozen_preparation_minutes == 8
    assert manifest.paper_context.workflow.standard_ffpe_processing_hours_minimum == 24
    assert manifest.rights.preview_dataset.spdx_id == "CC-BY-4.0"
    assert manifest.rights.paper.spdx_id == "CC-BY-NC-ND-4.0"
    assert manifest.rights.full_study_data.public is False


def test_publish_index_writes_ten_metadata_only_records(tmp_path: Path) -> None:
    _manifest_copy(tmp_path)

    metrics = publish_index(tmp_path)

    lines = (tmp_path / "outputs/native-index.jsonl").read_text(encoding="utf-8").splitlines()
    records = [json.loads(line) for line in lines]
    assert metrics["metadata_record_count"] == 10
    assert metrics["records_by_preparation"] == {"ffpe": 5, "frozen": 5}
    assert metrics["usable_wsi_count"] == 0
    assert metrics["records_missing_companion_pixel_directory"] == 10
    assert metrics["preview_contains_full_cohort"] is False
    assert len(records) == 10
    assert len({record["record_ref"] for record in records}) == 10
    assert all(record["availability"] == "metadata_only" for record in records)
    assert all(record["usable_wsi"] is False for record in records)
    assert all(len(record["artifacts"]) == 3 for record in records)
    assert all(record["publisher_partition"] is None for record in records)
    assert all(record["spatial_registration"] is False for record in records)


def test_publish_contracts_writes_both_schemas(tmp_path: Path) -> None:
    publish_contracts(tmp_path)

    source_schema = json.loads(
        (tmp_path / "contracts/source-manifest.schema.json").read_text(encoding="utf-8")
    )
    record_schema = json.loads(
        (tmp_path / "contracts/native-record.schema.json").read_text(encoding="utf-8")
    )
    assert source_schema["title"] == "SourceManifest"
    assert record_schema["title"] == "NativeRecord"


def test_live_metadata_matches_pinned_record_without_payload_download() -> None:
    report = verify_live_metadata(PROJECT_DIR, _live_payload())

    assert report == {
        "record_id": 18780726,
        "doi": "10.5281/zenodo.18780726",
        "file_count": 30,
        "total_bytes": 418147,
        "license_spdx_id": "CC-BY-4.0",
        "metadata_matches": True,
        "payloads_downloaded": False,
    }


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda value: value.update({"id": 1}), "identity differs"),
        (lambda value: value["metadata"].update({"title": "changed"}), "title or publication"),
        (lambda value: value["metadata"].update({"license": {"id": "cc0"}}), "rights differ"),
        (lambda value: value.update({"updated": "2026-06-25T00:00:00+00:00"}), "timestamp differs"),
        (lambda value: value["files"][0].update({"size": 1}), "file identities"),
    ],
)
def test_live_metadata_rejects_source_drift(
    mutation: Callable[[dict[str, object]], object], message: str
) -> None:
    payload = _live_payload()
    mutation(payload)

    with pytest.raises(SourceDataError, match=message):
        verify_live_metadata(PROJECT_DIR, payload)


def test_live_metadata_rejects_missing_metadata_and_files() -> None:
    with pytest.raises(SourceDataError, match="no metadata"):
        verify_live_metadata(PROJECT_DIR, {"id": 18780726})
    payload = _live_payload()
    payload["files"] = "not a list"
    with pytest.raises(SourceDataError, match="no file list"):
        verify_live_metadata(PROJECT_DIR, payload)


def test_local_file_integrity_checks_bytes_and_md5(tmp_path: Path) -> None:
    content = b"publisher bytes"
    path = tmp_path / "source.bin"
    path.write_bytes(content)
    file = SourceFile(
        name="source.bin",
        bytes=len(content),
        md5=hashlib.md5(content, usedforsecurity=False).hexdigest(),
        case_id="YW_DP1_045",
        preparation="frozen",
        role="mrxs_named_slide_file",
    )

    verify_local_file(path, file)
    with pytest.raises(SourceDataError, match="byte count differs"):
        verify_local_file(path, file.model_copy(update={"bytes": 1}))
    with pytest.raises(SourceDataError, match="MD5 differs"):
        verify_local_file(path, file.model_copy(update={"md5": "0" * 32}))
    with pytest.raises(SourceDataError, match="missing regular"):
        verify_local_file(tmp_path / "absent", file)


def test_xml_probe_requires_empty_annotation_container(tmp_path: Path) -> None:
    empty = tmp_path / "empty.xml"
    empty.write_text("<annotation_meta_data><annotations/></annotation_meta_data>")
    _verify_xml(empty, "annotation_xml")
    _verify_xml(empty, "scanner_metadata_xml")

    populated = tmp_path / "populated.xml"
    populated.write_text(
        "<annotation_meta_data><annotations><item/></annotations></annotation_meta_data>"
    )
    with pytest.raises(SourceDataError, match="annotation missingness differs"):
        _verify_xml(populated, "annotation_xml")


def test_mrxs_probe_opens_jpeg_then_requires_openslide_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "preview.mrxs"
    Image.new("RGB", (12, 7), "white").save(path, format="JPEG")

    def unsupported(_path: Path) -> Never:
        raise __import__("openslide").OpenSlideUnsupportedFormatError("unsupported")

    monkeypatch.setattr("skin_frozen_ffpe_preview.source.openslide.OpenSlide", unsupported)
    assert _probe_mrxs_named_jpeg(path) == (12, 7)


def test_mrxs_probe_rejects_non_jpeg_and_unexpected_readable_slide(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    png = tmp_path / "preview.mrxs"
    Image.new("RGB", (2, 2), "white").save(png, format="PNG")
    with pytest.raises(SourceDataError, match="no longer a JFIF JPEG"):
        _probe_mrxs_named_jpeg(png)

    Image.new("RGB", (2, 2), "white").save(png, format="JPEG")

    class FakeSlide:
        def __init__(self, _path: Path) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr("skin_frozen_ffpe_preview.source.openslide.OpenSlide", FakeSlide)
    with pytest.raises(SourceDataError, match="now opens as a WSI"):
        _probe_mrxs_named_jpeg(png)


def test_payload_check_downloads_to_temporary_storage_and_records_source_defect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "skin_frozen_ffpe_preview.source.verify_live_metadata", lambda _root: {"ok": True}
    )

    def fake_download(file: SourceFile, _manifest: SourceManifest, destination: Path) -> None:
        if file.role == "mrxs_named_slide_file":
            Image.new("RGB", (8, 5), "white").save(destination, format="JPEG")
        elif file.role == "annotation_xml":
            destination.write_text("<annotation_meta_data><annotations/></annotation_meta_data>")
        else:
            destination.write_text("<CaseCenterSlideMetadata/>")

    monkeypatch.setattr("skin_frozen_ffpe_preview.source._download", fake_download)

    report = verify_live_payloads(PROJECT_DIR)

    assert report["file_count"] == 30
    assert report["checksums_matched"] == 30
    assert report["xml_payloads_parsed"] == 20
    assert report["mrxs_named_jpeg_payloads"] == 10
    assert report["openslide_unsupported_payloads"] == 10
    assert report["companion_pixel_directories_present"] is False
    assert report["usable_wsi_count"] == 0
    assert report["availability"] == "metadata_only"
    assert report["temporary_payloads_removed"] is True


def test_acquire_rejects_unknown_name_and_reuses_verified_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _manifest_copy(tmp_path)
    with pytest.raises(SourceDataError, match="unknown source filename"):
        acquire_file("unknown", tmp_path)

    manifest = load_manifest(tmp_path)
    file = manifest.files[0]
    content = b"a" * file.bytes
    replacement = file.model_copy(
        update={
            "bytes": len(content),
            "md5": hashlib.md5(content, usedforsecurity=False).hexdigest(),
        }
    )
    updated = manifest.model_copy(update={"files": [replacement, *manifest.files[1:]]})
    (tmp_path / "manifest.json").write_text(updated.model_dump_json(), encoding="utf-8")

    def fake_download(_file: SourceFile, _manifest: SourceManifest, destination: Path) -> None:
        destination.write_bytes(content)

    monkeypatch.setattr("skin_frozen_ffpe_preview.source._download", fake_download)
    destination = acquire_file(file.name, tmp_path)
    assert destination.read_bytes() == content
    assert acquire_file(file.name, tmp_path) == destination


def test_json_response_and_download_use_bounded_http_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content = b"abc"

    class FakeResponse:
        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, bool]:
            return {"ok": True}

        def iter_content(self, chunk_size: int) -> Iterator[bytes]:
            assert chunk_size == 64 * 1024
            yield content

    monkeypatch.setattr(
        "skin_frozen_ffpe_preview.source.requests.get",
        lambda *_args, **_kwargs: FakeResponse(),
    )
    assert _json_response("https://example.test") == {"ok": True}

    manifest = _manifest()
    file = manifest.files[0].model_copy(
        update={"bytes": 3, "md5": hashlib.md5(content, usedforsecurity=False).hexdigest()}
    )
    destination = tmp_path / file.name
    _download(file, manifest, destination)
    assert destination.read_bytes() == content


def test_json_response_rejects_non_object(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> list[object]:
            return []

    monkeypatch.setattr(
        "skin_frozen_ffpe_preview.source.requests.get",
        lambda *_args, **_kwargs: FakeResponse(),
    )
    with pytest.raises(SourceDataError, match="non-object"):
        _json_response("https://example.test")
