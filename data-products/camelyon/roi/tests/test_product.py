import hashlib
import io
import json
import zipfile
from http.client import HTTPMessage
from pathlib import Path

import pytest
from pydantic import ValidationError

from camelyon_roi_product import acquisition
from camelyon_roi_product.acquisition import (
    _HttpsOnlyRedirectHandler,
    _safe_extract,
    acquire_annotations,
    acquire_artifact,
    parse_xml,
    verify_metadata,
)
from camelyon_roi_product.models import SourceContract
from camelyon_roi_product.product import ProductError, publish_product

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _copy_contract(root: Path) -> None:
    (root / "contracts").mkdir()
    (root / "records").mkdir()
    for relative in (
        "contracts/source.json",
        "contracts/artifacts.json",
        "records/native-records.json",
    ):
        destination = root / relative
        destination.write_text(
            (PROJECT_DIR / relative).read_text(encoding="utf-8"), encoding="utf-8"
        )


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


def test_publish_preserves_source_scope_and_stable_references(tmp_path: Path) -> None:
    _copy_contract(tmp_path)

    metrics = publish_product(tmp_path)

    assert metrics == {
        "artifact_count": 442,
        "camelyon16_slide_count": 399,
        "camelyon17_annotated_slide_count": 50,
        "non_exhaustive_annotation_count": 71,
        "patient_count": 43,
        "record_count": 449,
        "xml_referenced_slide_count": 209,
    }
    records = (tmp_path / "outputs/native-records.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(records) == 449
    references = json.loads(
        (tmp_path / "outputs/artifact-references.json").read_text(encoding="utf-8")
    )
    assert len(references["slide_artifacts"]) == 442
    assert len(references["annotation_archives"]) == 3


def test_source_contract_rejects_changed_publisher_scope() -> None:
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    payload["scope"]["camelyon16_slides"] = 400

    with pytest.raises(ValidationError, match="source contract scope differs"):
        SourceContract.model_validate(payload)


def test_publish_rejects_invented_camelyon16_patient(tmp_path: Path) -> None:
    _copy_contract(tmp_path)
    records_path = tmp_path / "records/native-records.json"
    payload = json.loads(records_path.read_text(encoding="utf-8"))
    payload["records"][0]["patient_id"] = "invented"
    records_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ProductError, match="must not invent"):
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


def test_safe_extract_rejects_non_xml_and_traversal(tmp_path: Path) -> None:
    for name in ("notes.txt", "../annotation.xml"):
        path = tmp_path / f"{name.replace('/', '_')}.zip"
        path.write_bytes(_zip_bytes(name, b"bad"))
        with (
            zipfile.ZipFile(path) as source,
            pytest.raises(ProductError, match="unexpected annotation archive member"),
        ):
            _safe_extract(source, tmp_path / "output")


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


def test_verify_metadata_is_metadata_only_and_digest_gated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "contracts").mkdir()
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    content = b"official metadata"
    digest = hashlib.sha256(content).hexdigest()
    for index, source in enumerate(payload["metadata_sources"]):
        source["source_id"] = f"source-{index}"
        source["url"] = f"https://example.test/source-{index}"
        source["sha256"] = digest
    (tmp_path / "contracts/source.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(acquisition, "_download", lambda _url, path: path.write_bytes(content))

    assert verify_metadata(tmp_path) == 6
    assert not (tmp_path / "data").exists()

    payload["metadata_sources"][0]["sha256"] = "0" * 64
    (tmp_path / "contracts/source.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ProductError, match="official metadata changed"):
        verify_metadata(tmp_path)


def test_acquire_artifact_requires_budget_verifies_and_reuses(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "contracts").mkdir()
    content = b"pinned WSI fixture"
    manifest = {
        "schema_version": "1.0.0",
        "dataset_id": "camelyon-gigadb-100439-roi-v1",
        "artifacts": [
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
    }
    (tmp_path / "contracts/artifacts.json").write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(acquisition, "_download", lambda _url, path: path.write_bytes(content))

    with pytest.raises(ProductError, match="limit"):
        acquire_artifact("slide", len(content) - 1, tmp_path)
    destination = acquire_artifact("slide", len(content), tmp_path)
    assert destination.read_bytes() == content

    monkeypatch.setattr(
        acquisition,
        "_download",
        lambda _url, _path: pytest.fail("verified artifact should be reused"),
    )
    assert acquire_artifact("slide", len(content), tmp_path) == destination
    with pytest.raises(ProductError, match="unknown CAMELYON artifact"):
        acquire_artifact("missing", len(content), tmp_path)


def test_acquire_annotations_checks_archives_and_indexes_coordinates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "contracts").mkdir()
    (tmp_path / "records").mkdir()
    source = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    members = ["tumor_001.xml", "test_001.xml", "patient_004_node_4.xml"]
    contents = {
        archive["artifact_id"]: _zip_bytes(member, _xml("_0" if index < 2 else "metastases"))
        for index, (archive, member) in enumerate(
            zip(source["annotation_archives"], members, strict=True)
        )
    }
    url_content: dict[str, bytes] = {}
    for archive, content in zip(source["annotation_archives"], contents.values(), strict=True):
        archive["source_url"] = f"https://example.test/{archive['artifact_id']}.zip"
        archive["bytes"] = len(content)
        archive["md5"] = hashlib.md5(content).hexdigest()  # noqa: S324 - publisher checksum.
        archive["sha256"] = hashlib.sha256(content).hexdigest()
        url_content[archive["source_url"]] = content
    (tmp_path / "contracts/source.json").write_text(json.dumps(source), encoding="utf-8")
    records = {
        "records": [
            {
                "slide_id": Path(member).stem,
                "lesion_annotation": {
                    "artifact_id": archive["artifact_id"],
                    "archive_member": member,
                },
            }
            for archive, member in zip(source["annotation_archives"], members, strict=True)
        ]
    }
    (tmp_path / "records/native-records.json").write_text(json.dumps(records), encoding="utf-8")
    monkeypatch.setattr(
        acquisition,
        "_download",
        lambda url, path: path.write_bytes(url_content[url]),
    )

    assert acquire_annotations(tmp_path) == 3
    rows = (tmp_path / "data/annotation-index.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 3
    assert json.loads(rows[-1])["coordinates"][0] == {"order": 0, "x": 1.0, "y": 2.0}
