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
    _download,
    _HttpsOnlyRedirectHandler,
    _safe_extract,
    acquire_annotations,
    acquire_artifact,
    parse_xml,
    verify_metadata,
)
from camelyon_roi_product.cli import Application
from camelyon_roi_product.freeze import (
    METADATA_FILE_NAMES,
    _verify_freeze_inputs,
    freeze_snapshot,
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


def test_publish_rejects_record_and_artifact_scope_mismatch(tmp_path: Path) -> None:
    _copy_contract(tmp_path)
    records_path = tmp_path / "records/native-records.json"
    payload = json.loads(records_path.read_text(encoding="utf-8"))
    record = next(
        record
        for record in payload["records"]
        if record["challenge"] == "CAMELYON16" and record["source_role"] == "training"
    )
    record["source_role"] = "testing"
    records_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ProductError, match="slide artifact scope differs"):
        publish_product(tmp_path)


def test_publish_rejects_role_counts_outside_declared_scope(tmp_path: Path) -> None:
    _copy_contract(tmp_path)
    records_path = tmp_path / "records/native-records.json"
    records = json.loads(records_path.read_text(encoding="utf-8"))
    record = next(
        record
        for record in records["records"]
        if record["challenge"] == "CAMELYON16" and record["source_role"] == "training"
    )
    record["source_role"] = "testing"
    records_path.write_text(json.dumps(records), encoding="utf-8")
    artifacts_path = tmp_path / "contracts/artifacts.json"
    artifacts = json.loads(artifacts_path.read_text(encoding="utf-8"))
    artifact = next(
        artifact
        for artifact in artifacts["artifacts"]
        if artifact["artifact_id"] == record["slide_artifact"]["artifact_id"]
    )
    artifact["source_role"] = "testing"
    artifacts_path.write_text(json.dumps(artifacts), encoding="utf-8")

    with pytest.raises(ProductError, match="record role counts differ"):
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


def test_acquire_artifact_uses_distinct_temporary_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "contracts").mkdir()
    content = b"expected"
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
    temporary_paths: list[Path] = []

    def write_invalid(_url: str, path: Path, _max_bytes: int) -> None:
        temporary_paths.append(path)
        path.write_bytes(b"invalid")

    monkeypatch.setattr(acquisition, "_download", write_invalid)
    for _ in range(2):
        with pytest.raises(ProductError, match="downloaded artifact differs"):
            acquire_artifact("slide", len(content), tmp_path)

    assert temporary_paths[0] != temporary_paths[1]
    assert not any(path.exists() for path in temporary_paths)


def test_cli_validates_acquire_and_freeze_inputs(tmp_path: Path) -> None:
    application = Application(str(tmp_path))

    with pytest.raises(ValidationError, match="greater than 0"):
        application.acquire("slide", 0)
    with pytest.raises(ValidationError, match="Path does not point to a directory"):
        application.freeze(str(tmp_path / "missing"))


def test_freeze_inputs_must_match_pinned_digests(tmp_path: Path) -> None:
    metadata = tmp_path / "metadata"
    metadata.mkdir()
    payload = json.loads((PROJECT_DIR / "contracts/source.json").read_text(encoding="utf-8"))
    for source in payload["metadata_sources"]:
        content = source["source_id"].encode()
        source["sha256"] = hashlib.sha256(content).hexdigest()
        name = METADATA_FILE_NAMES.get(source["source_id"], source["source_id"])
        (metadata / name).write_bytes(content)
    for archive in payload["annotation_archives"]:
        content = archive["artifact_id"].encode()
        archive["bytes"] = len(content)
        archive["md5"] = hashlib.md5(content).hexdigest()  # noqa: S324 - publisher checksum.
        archive["sha256"] = hashlib.sha256(content).hexdigest()
        name = f"{archive['challenge']}_{archive['source_role']}_lesion_annotations.zip"
        (metadata / name).write_bytes(content)
    contract = SourceContract.model_validate(payload)

    _verify_freeze_inputs(metadata, contract)
    (metadata / "reference.csv").write_text("changed", encoding="utf-8")
    root = tmp_path / "product"
    (root / "contracts").mkdir(parents=True)
    (root / "contracts/source.json").write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ProductError, match=r"camelyon16_reference\.csv"):
        freeze_snapshot(str(metadata), str(root))
    assert not (root / "contracts/artifacts.json").exists()


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

    def write_archive(url: str, path: Path, max_bytes: int) -> None:
        assert max_bytes == len(url_content[url])
        path.write_bytes(url_content[url])

    monkeypatch.setattr(acquisition, "_download", write_archive)

    assert acquire_annotations(tmp_path) == 3
    rows = (tmp_path / "data/annotation-index.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 3
    assert json.loads(rows[-1])["coordinates"][0] == {"order": 0, "x": 1.0, "y": 2.0}
