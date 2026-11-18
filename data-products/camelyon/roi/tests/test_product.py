import hashlib
import io
import json
import zipfile
from http.client import HTTPMessage
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from camelyon_roi_product import acquisition, freeze
from camelyon_roi_product.acquisition import (
    _download,
    _HttpsOnlyRedirectHandler,
    _validated_xml_members,
    acquire_annotations,
    acquire_artifact,
    acquire_metadata,
    parse_xml,
    verify_metadata,
)
from camelyon_roi_product.cli import Application
from camelyon_roi_product.models import ArtifactManifest, NativeRecord, SourceContract
from camelyon_roi_product.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_source(root: Path) -> dict[str, Any]:
    (root / "contracts").mkdir()
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    (root / "contracts/source.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _artifact(artifact_id: str, challenge: str, role: str, slides: list[str]) -> dict[str, object]:
    return {
        "artifact_id": artifact_id,
        "challenge": challenge,
        "source_role": role,
        "path": f"{challenge}/{artifact_id}.zip",
        "source_url": f"https://example.test/{artifact_id}.zip",
        "bytes": 1,
        "md5": "0" * 32,
        "format": "pyramidal_tiff" if challenge == "CAMELYON16" else "patient_zip",
        "contains_slide_ids": slides,
    }


def _record(
    *,
    challenge: str,
    role: str,
    slide_id: str,
    artifact_id: str,
    patient_id: str | None = None,
    centre_id: str | None = None,
    node_id: str | None = None,
    annotated: bool = False,
    incomplete: bool = False,
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "dataset_id": "camelyon-gigadb-100439-roi-v1",
        "record_id": f"{challenge}:{slide_id}",
        "challenge": challenge,
        "source_role": role,
        "patient_id": patient_id,
        "centre_id": centre_id,
        "node_id": node_id,
        "slide_id": slide_id,
        "stain": "H&E",
        "slide_label": "Normal",
        "lesion_category": "None",
        "patient_stage": "pN0" if patient_id else None,
        "identity_completeness": "complete" if patient_id else "not_published_for_camelyon16",
        "annotation_completeness": "non_exhaustive" if incomplete else "exhaustive",
        "annotation_completeness_detail": {
            "all_tumor_areas": "non_exhaustive" if incomplete else "exhaustive"
        },
        "slide_artifact": {
            "artifact_id": artifact_id,
            "archive_member": f"{slide_id}.tif" if patient_id else None,
        },
        "lesion_annotation": (
            {
                "artifact_id": (
                    "camelyon17-training-lesion-annotations"
                    if patient_id
                    else "camelyon16-training-lesion-annotations"
                ),
                "archive_member": f"{slide_id}.xml",
                "native_groups": ["metastases", "normal"] if patient_id else ["_0", "_1", "_2"],
            }
            if annotated
            else None
        ),
        "scale": {
            "coordinate_space": "whole_slide_level_0",
            "coordinate_unit": "pixel",
            "axes": "X,Y",
            "physical_spacing": "embedded_in_pyramidal_tiff",
        },
    }


def _snapshot() -> tuple[ArtifactManifest, list[NativeRecord]]:
    artifacts: list[dict[str, object]] = []
    records: list[dict[str, object]] = []
    for index in range(399):
        slide_id = f"cam16_{index:03d}"
        artifact_id = f"camelyon16-{slide_id}-wsi"
        role = "training" if index < 270 else "testing"
        artifacts.append(_artifact(artifact_id, "CAMELYON16", role, [slide_id]))
        records.append(
            _record(
                challenge="CAMELYON16",
                role=role,
                slide_id=slide_id,
                artifact_id=artifact_id,
                annotated=index < 159,
                incomplete=index < 21,
            )
        )
    slide_count = 0
    for patient_index in range(43):
        patient_id = f"patient_{patient_index:03d}"
        slide_ids = [f"{patient_id}_node_{index}" for index in range(2 if patient_index < 7 else 1)]
        artifact_id = f"camelyon17-{patient_id}-slides"
        artifacts.append(_artifact(artifact_id, "CAMELYON17", "training", slide_ids))
        for node_index, slide_id in enumerate(slide_ids):
            records.append(
                _record(
                    challenge="CAMELYON17",
                    role="training",
                    slide_id=slide_id,
                    artifact_id=artifact_id,
                    patient_id=patient_id,
                    centre_id=f"center_{patient_index % 5}",
                    node_id=f"node_{node_index}",
                    annotated=True,
                    incomplete=True,
                )
            )
            slide_count += 1
    assert slide_count == 50
    manifest = ArtifactManifest.model_validate(
        {
            "schema_version": "1.0.0",
            "dataset_id": "camelyon-gigadb-100439-roi-v1",
            "artifacts": artifacts,
        }
    )
    return manifest, [NativeRecord.model_validate(record) for record in records]


def _zip_bytes(name: str, content: bytes) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(name, content)
    return output.getvalue()


def _xml(group: str = "metastases") -> bytes:
    return (
        f'<ASAP_Annotations><Annotations><Annotation Name="A" Type="Polygon" '
        f'PartOfGroup="{group}"><Coordinates><Coordinate Order="1" X="3.5" Y="4"/>'
        '<Coordinate Order="0" X="1" Y="2"/></Coordinates></Annotation></Annotations>'
        "</ASAP_Annotations>"
    ).encode()


def _publish_with_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    _copy_source(tmp_path)
    snapshot = _snapshot()
    monkeypatch.setattr(freeze, "build_snapshot", lambda _root: snapshot)
    return publish_product(tmp_path)


def test_publish_preserves_source_scope_and_stable_references(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    metrics = _publish_with_snapshot(tmp_path, monkeypatch)
    assert metrics == {
        "artifact_count": 442,
        "camelyon16_slide_count": 399,
        "camelyon17_annotated_slide_count": 50,
        "non_exhaustive_annotation_count": 71,
        "patient_count": 43,
        "record_count": 449,
        "xml_referenced_slide_count": 209,
    }
    assert len((tmp_path / "outputs/native-records.jsonl").read_text().splitlines()) == 449
    references = json.loads((tmp_path / "outputs/artifact-references.json").read_text())
    assert len(references["slide_artifacts"]) == 442
    assert len(references["annotation_archives"]) == 3


def test_source_contract_rejects_changed_publisher_scope() -> None:
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text())
    payload["scope"]["camelyon16_slides"] = 400
    with pytest.raises(ValidationError, match="source contract scope differs"):
        SourceContract.model_validate(payload)


def test_camelyon16_mapping_preserves_native_labels_and_completeness(tmp_path: Path) -> None:
    metadata = tmp_path / "metadata"
    annotations = tmp_path / "annotations"
    metadata.mkdir()
    (annotations / "CAMELYON16/training").mkdir(parents=True)
    (annotations / "CAMELYON16/testing").mkdir(parents=True)
    (metadata / "camelyon16_checksums.md5").write_text(
        "a" * 32 + "  training/tumor/tumor_001.tif\n" + "b" * 32 + "  testing/images/test_001.tif\n"
    )
    (metadata / "camelyon16_reference.csv").write_text("test_001,Tumor,x,Macro\n")
    (metadata / "camelyon16_readme.md").write_text("* tumor_001 is not exhaustive\n")
    (annotations / "CAMELYON16/training/lesion_annotations.zip").write_bytes(
        _zip_bytes("tumor_001.xml", _xml("_0"))
    )
    (annotations / "CAMELYON16/testing/lesion_annotations.zip").write_bytes(
        _zip_bytes("test_001.xml", _xml("_1"))
    )
    files = [
        {
            "url": "https://example.test/CAMELYON16/training/tumor/tumor_001.tif",
            "file_size": 10,
        },
        {
            "url": "https://example.test/CAMELYON16/testing/images/test_001.tif",
            "file_size": 20,
        },
    ]

    artifacts, records = freeze._camelyon16(metadata, annotations, files)

    assert [artifact["contains_slide_ids"] for artifact in artifacts] == [
        ["test_001"],
        ["tumor_001"],
    ]
    by_slide = {record["slide_id"]: record for record in records}
    assert by_slide["test_001"]["lesion_category"] == "Macro"
    assert by_slide["tumor_001"]["annotation_completeness"] == "non_exhaustive"
    assert by_slide["tumor_001"]["lesion_annotation"] == {
        "artifact_id": "camelyon16-training-lesion-annotations",
        "archive_member": "tumor_001.xml",
        "native_groups": ["_0", "_1", "_2"],
    }


def test_camelyon17_mapping_preserves_patient_centre_node_and_members(tmp_path: Path) -> None:
    metadata = tmp_path / "metadata"
    annotations = tmp_path / "annotations"
    metadata.mkdir()
    (annotations / "CAMELYON17/training").mkdir(parents=True)
    source_path = "training/center_0/patient_001.zip"
    (metadata / "camelyon17_checksums.md5").write_text("c" * 32 + f"  {source_path}\n")
    (metadata / "camelyon17_stage_labels.csv").write_text(
        "patient,stage\npatient_001.zip,pN1mi\npatient_001_node_3.tif,Micro\n"
    )
    (annotations / "CAMELYON17/training/lesion_annotations.zip").write_bytes(
        _zip_bytes("patient_001_node_3.xml", _xml())
    )
    files = [
        {
            "url": f"https://example.test/CAMELYON17/{source_path}",
            "file_name": "patient_001.zip",
            "file_size": 30,
        }
    ]

    artifacts, records = freeze._camelyon17(metadata, annotations, files)

    assert artifacts[0]["contains_slide_ids"] == [f"patient_001_node_{index}" for index in range(5)]
    record = records[0]
    assert (record["patient_id"], record["centre_id"], record["node_id"]) == (
        "patient_001",
        "center_0",
        "node_3",
    )
    slide_artifact = record["slide_artifact"]
    assert isinstance(slide_artifact, dict)
    assert slide_artifact["archive_member"] == "patient_001_node_3.tif"
    assert record["patient_stage"] == "pN1mi"


def test_publish_rejects_invented_camelyon16_patient(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _copy_source(tmp_path)
    manifest, records = _snapshot()
    records[0] = records[0].model_copy(update={"patient_id": "invented"})
    monkeypatch.setattr(freeze, "build_snapshot", lambda _root: (manifest, records))
    with pytest.raises(ProductError, match="must not invent"):
        publish_product(tmp_path)


def test_publish_rejects_record_and_artifact_scope_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _copy_source(tmp_path)
    manifest, records = _snapshot()
    records[0] = records[0].model_copy(update={"source_role": "testing"})
    monkeypatch.setattr(freeze, "build_snapshot", lambda _root: (manifest, records))
    with pytest.raises(ProductError, match="slide artifact scope differs"):
        publish_product(tmp_path)


def test_parse_xml_keeps_native_group_and_coordinate_order(tmp_path: Path) -> None:
    path = tmp_path / "annotation.xml"
    path.write_bytes(_xml())
    annotations = parse_xml(path, "patient_004_node_4")
    assert annotations[0].group == "metastases"
    assert [(point.order, point.x, point.y) for point in annotations[0].coordinates] == [
        (0, 1.0, 2.0),
        (1, 3.5, 4.0),
    ]


def test_archive_validation_rejects_non_xml_and_traversal(tmp_path: Path) -> None:
    for name in ("notes.txt", "../annotation.xml"):
        path = tmp_path / f"{name.replace('/', '_')}.zip"
        path.write_bytes(_zip_bytes(name, b"bad"))
        with zipfile.ZipFile(path) as source, pytest.raises(ProductError, match="unexpected"):
            _validated_xml_members(source)


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = _HttpsOnlyRedirectHandler()
    with pytest.raises(ProductError, match="redirect must use HTTPS"):
        handler.redirect_request(
            acquisition.urllib.request.Request("https://example.test/source"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/source",
        )


def test_download_stops_before_exceeding_byte_limit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeOpener:
        def open(self, _request: object, timeout: int) -> io.BytesIO:
            assert timeout == 60
            return io.BytesIO(b"oversized")

    monkeypatch.setattr(acquisition.urllib.request, "build_opener", lambda _handler: FakeOpener())
    destination = tmp_path / "download"
    with pytest.raises(ProductError, match="exceeds 4 byte limit"):
        _download("https://example.test/source", destination, 4)
    assert destination.read_bytes() == b""


def test_metadata_verification_and_dvc_acquisition(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = _copy_source(tmp_path)
    content = b"official metadata"
    digest = hashlib.sha256(content).hexdigest()
    for index, source in enumerate(payload["metadata_sources"]):
        source["source_id"] = f"source-{index}"
        source["url"] = f"https://example.test/source-{index}"
        source["sha256"] = digest
    (tmp_path / "contracts/source.json").write_text(json.dumps(payload))
    monkeypatch.setattr(acquisition, "_download", lambda _url, path: path.write_bytes(content))
    assert verify_metadata(tmp_path) == 7
    assert not (tmp_path / "data").exists()
    assert acquire_metadata(tmp_path) == 7
    assert len(list((tmp_path / "data/metadata").iterdir())) == 7
    monkeypatch.setattr(acquisition, "_download", lambda _url, _path: pytest.fail("must reuse"))
    assert acquire_metadata(tmp_path) == 7


def _write_artifact_references(root: Path, content: bytes) -> None:
    (root / "outputs").mkdir()
    payload = {
        "schema_version": "1.0.0",
        "dataset_id": "camelyon-gigadb-100439-roi-v1",
        "slide_artifacts": [
            {
                "artifact_id": "slide",
                "challenge": "CAMELYON16",
                "source_role": "training",
                "path": "CAMELYON16/training/normal/normal_001.tif",
                "source_url": "https://example.test/normal_001.tif",
                "bytes": len(content),
                "md5": hashlib.md5(content).hexdigest(),  # noqa: S324 - publisher checksum.
                "format": "pyramidal_tiff",
                "contains_slide_ids": ["normal_001"],
            }
        ],
        "annotation_archives": [],
    }
    (root / "outputs/artifact-references.json").write_text(json.dumps(payload))


def test_acquire_artifact_requires_budget_verifies_and_reuses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    content = b"pinned WSI fixture"
    _write_artifact_references(tmp_path, content)

    def write_content(_url: str, path: Path, max_bytes: int) -> None:
        assert max_bytes == len(content)
        path.write_bytes(content)

    monkeypatch.setattr(acquisition, "_download", write_content)
    with pytest.raises(ProductError, match="limit"):
        acquire_artifact("slide", len(content) - 1, tmp_path)
    destination = acquire_artifact("slide", len(content), tmp_path)
    assert destination.read_bytes() == content
    monkeypatch.setattr(
        acquisition,
        "_download",
        lambda _url, _path, _max_bytes: pytest.fail("verified artifact should be reused"),
    )
    assert acquire_artifact("slide", len(content), tmp_path) == destination
    with pytest.raises(ProductError, match="unknown CAMELYON artifact"):
        acquire_artifact("missing", len(content), tmp_path)


def test_acquire_annotations_checks_archives_and_indexes_coordinates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = _copy_source(tmp_path)
    members = ["tumor_001.xml", "test_001.xml", "patient_004_node_4.xml"]
    url_content: dict[str, bytes] = {}
    for index, (archive, member) in enumerate(
        zip(source["annotation_archives"], members, strict=True)
    ):
        content = _zip_bytes(member, _xml("_0" if index < 2 else "metastases"))
        archive["source_url"] = f"https://example.test/{archive['artifact_id']}.zip"
        archive["bytes"] = len(content)
        archive["md5"] = hashlib.md5(content).hexdigest()  # noqa: S324 - publisher checksum.
        archive["sha256"] = hashlib.sha256(content).hexdigest()
        url_content[archive["source_url"]] = content
    (tmp_path / "contracts/source.json").write_text(json.dumps(source))

    def write_archive(url: str, path: Path, max_bytes: int) -> None:
        assert max_bytes == len(url_content[url])
        path.write_bytes(url_content[url])

    monkeypatch.setattr(acquisition, "_download", write_archive)
    monkeypatch.setattr(acquisition, "EXPECTED_XML_SLIDES", 3)
    monkeypatch.setattr(acquisition, "EXPECTED_LESION_ANNOTATIONS", 3)
    assert acquire_annotations(tmp_path) == 3
    rows = (tmp_path / "outputs/lesion-annotations.jsonl").read_text().splitlines()
    assert len(rows) == 3
    assert json.loads(rows[-1])["coordinates"][0] == {"order": 0, "x": 1.0, "y": 2.0}


def test_cli_validates_acquire_budget(tmp_path: Path) -> None:
    application = Application(str(tmp_path))
    with pytest.raises(ValidationError, match="greater than 0"):
        application.acquire("slide", 0)
