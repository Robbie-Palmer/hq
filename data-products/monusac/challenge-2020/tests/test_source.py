import hashlib
import io
import json
import zipfile
from email.message import Message
from http.client import HTTPMessage
from pathlib import Path
from urllib.request import Request

import pytest

from monusac_source_data.models import SourceManifest
from monusac_source_data.source import (
    SourceDataError,
    _HttpsOnlyRedirectHandler,
    _parse_annotation_document,
    _safe_members,
    acquire_dataset,
    index_dataset,
    load_annotations,
    load_manifest,
    probe_remote_artifacts,
    verify_artifact,
    verify_metadata,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _xml(*classes: str) -> bytes:
    groups = []
    for group_id, class_name in enumerate(classes, start=1):
        groups.append(
            f"""
            <Annotation Id="{group_id}" Name="Layer {group_id}" LineColor="255">
              <Attributes><Attribute Name="{class_name}" Id="0" Value=""/></Attributes>
              <Regions>
                <Region Id="1" Type="0" NegativeROA="0" Length="4.5" Area="2.5"
                        LengthMicrons="1.1" AreaMicrons="0.4">
                  <Vertices><Vertex X="1" Y="2" Z="0"/><Vertex X="3" Y="4" Z="0"/></Vertices>
                </Region>
              </Regions>
            </Annotation>
            """
        )
    return f'<Annotations MicronsPerPixel="0.252000">{"".join(groups)}</Annotations>'.encode()


def _write_zip(
    path: Path, slide_id: str, image_id: str, classes: tuple[str, ...], tif: bool
) -> None:
    root = "MoNuSAC fixture"
    with zipfile.ZipFile(path, "w") as archive:
        prefix = f"{root}/{slide_id}/{image_id}"
        archive.writestr(f"{prefix}.svs", b"native-svs")
        if tif:
            archive.writestr(f"{prefix}.tif", b"native-tif")
        archive.writestr(f"{prefix}.xml", _xml(*classes))


def _artifact_digest(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    return {
        "bytes": len(payload),
        "md5": hashlib.md5(payload).hexdigest(),  # noqa: S324
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def _fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "source"
    raw = root / "data/raw"
    raw.mkdir(parents=True)
    train = raw / "MoNuSAC_images_and_annotations.zip"
    test = raw / "MoNuSAC Testing Data and Annotations.zip"
    supplement = raw / "MoNuSAC_Supplementary_material.pdf"
    _write_zip(train, "TCGA-55-1594-01Z-00-DX1", "TCGA-55-1594-01Z-00-DX1_1", ("Epithelial",), True)
    _write_zip(
        test,
        "TCGA-49-6743-01Z-00-DX2",
        "TCGA-49-6743-01Z-00-DX2_1",
        ("Lymphocyte", "Ambiguous"),
        False,
    )
    supplement.write_bytes(b"publisher organ evidence")

    manifest = json.loads((PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"))
    artifacts = {artifact["name"]: artifact for artifact in manifest["artifacts"]}
    artifacts["training"].update(_artifact_digest(train))
    artifacts["testing"].update(_artifact_digest(test))
    artifacts["organ_roles"].update(_artifact_digest(supplement))
    manifest["expected"]["training"] = {
        "patient_role_count": 1,
        "image_count": 1,
        "svs_count": 1,
        "tif_count": 1,
        "xml_count": 1,
        "scored_instance_count": 1,
        "ambiguous_instance_count": 0,
        "cell_class_counts": {"Epithelial": 1},
    }
    manifest["expected"]["testing"] = {
        "patient_role_count": 1,
        "image_count": 1,
        "svs_count": 1,
        "tif_count": 0,
        "xml_count": 1,
        "scored_instance_count": 1,
        "ambiguous_instance_count": 1,
        "cell_class_counts": {"Ambiguous": 1, "Lymphocyte": 1},
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    contract = {
        "schema_version": "1.0.0",
        "evidence_artifact": "MoNuSAC_Supplementary_material.pdf",
        "evidence_location": "Table S1",
        "patient_roles": [
            {
                "publisher_split": "training",
                "patient_id": "TCGA-55-1594",
                "organ": "Lung",
                "tissue_source_site_code": "55",
                "hospital": "International Genomics Consortium",
            },
            {
                "publisher_split": "testing",
                "patient_id": "TCGA-49-6743",
                "organ": "Lung",
                "tissue_source_site_code": "49",
                "hospital": "Johns Hopkins",
            },
        ],
    }
    contract_root = root / "contracts"
    contract_root.mkdir()
    (contract_root / "organ-roles.json").write_text(json.dumps(contract), encoding="utf-8")
    return root


def test_committed_manifest_pins_source_native_contract() -> None:
    manifest = load_manifest(PROJECT_DIR)

    assert isinstance(manifest, SourceManifest)
    assert manifest.license.spdx_id == "CC-BY-NC-SA-4.0"
    assert manifest.annotation_protocol.per_instance_annotator_identity_available is False
    assert {item.name for item in manifest.cell_classes} == {
        "Epithelial",
        "Lymphocyte",
        "Macrophage",
        "Neutrophil",
        "Ambiguous",
    }
    assert {artifact.artifact_ref for artifact in manifest.artifacts} == {
        "monusac2020-challenge-distribution-20210608:artifact:training",
        "monusac2020-challenge-distribution-20210608:artifact:testing",
        "monusac2020-challenge-distribution-20210608:artifact:organ_roles",
    }


def test_metadata_verification_needs_no_dataset_bytes(tmp_path: Path) -> None:
    output = tmp_path / "metadata.json"

    evidence = verify_metadata(PROJECT_DIR, output)

    assert evidence["dataset_bytes_required"] is False
    assert evidence["patient_roles"] == {"testing": 25, "training": 46}
    assert evidence["patient_ids_in_both_publisher_splits"] == [
        "TCGA-A2-A0ES",
        "TCGA-MP-A4T7",
    ]
    assert json.loads(output.read_text(encoding="utf-8")) == evidence


def test_load_annotations_preserves_instance_geometry_and_roles() -> None:
    document = load_annotations(_xml("Epithelial", "Ambiguous"))

    assert document.microns_per_pixel == 0.252
    assert [annotation.cell_class for annotation in document.annotations] == [
        "Epithelial",
        "Ambiguous",
    ]
    assert document.annotations[1].publisher_role == "challenge_excluded_region"
    assert document.annotations[0].vertices[1].model_dump() == {"x": 3.0, "y": 4.0, "z": 0.0}


def test_empty_nonclass_group_is_preserved_without_inventing_a_class() -> None:
    payload = b"""
    <Annotations MicronsPerPixel="0.25">
      <Annotation Id="5" Name="Neutrophils" LineColor="255">
        <Attributes><Attribute Name="Description" Id="0" Value=""/></Attributes>
        <Regions/>
      </Annotation>
    </Annotations>
    """

    document = _parse_annotation_document(payload, include_instances=False)

    assert document.groups[0].cell_class is None
    assert document.groups[0].publisher_role == "empty_annotation_group"


def test_unknown_class_with_regions_is_rejected() -> None:
    payload = _xml("Stromal")

    with pytest.raises(SourceDataError, match="unknown class"):
        load_annotations(payload)


def test_safe_members_rejects_traversal(tmp_path: Path) -> None:
    path = tmp_path / "bad.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("../outside.xml", b"bad")

    with zipfile.ZipFile(path) as archive, pytest.raises(SourceDataError, match="unsafe"):
        _safe_members(archive)


def test_index_dataset_publishes_stable_record_and_artifact_refs(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)

    metrics = index_dataset(root)

    assert metrics["record_count"] == 2
    assert metrics["instances_by_cell_class"] == {
        "Ambiguous": 1,
        "Epithelial": 1,
        "Lymphocyte": 1,
    }
    records = [
        json.loads(line)
        for line in (root / "outputs/native-index.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    training = next(record for record in records if record["publisher_split"] == "training")
    assert training["record_ref"].endswith(":record:training:TCGA-55-1594-01Z-00-DX1_1")
    assert training["annotation_artifact_ref"].endswith(":artifact:training")
    assert {item["format"] for item in training["image_members"]} == {"svs", "tif"}
    assert training["organ"] == "Lung"


def test_index_dataset_rejects_changed_source_counts(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    manifest["expected"]["training"]["image_count"] = 2
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(SourceDataError, match="training source counts differ"):
        index_dataset(root)


def test_verify_artifact_rejects_changed_bytes(tmp_path: Path) -> None:
    root = _fixture_root(tmp_path)
    manifest = load_manifest(root)
    training = next(item for item in manifest.artifacts if item.name == "training")
    path = root / "data/raw" / training.filename
    path.write_bytes(b"changed")

    with pytest.raises(SourceDataError, match="byte count differs"):
        verify_artifact(path, training)


class _Response(io.BytesIO):
    def __init__(self, payload: bytes, *, filename: str, last_modified: str, url: str) -> None:
        super().__init__(payload)
        headers = Message()
        headers["Content-Length"] = str(len(payload))
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        headers["Last-Modified"] = last_modified
        self.headers = headers
        self._url = url

    def geturl(self) -> str:
        return self._url


def test_acquire_dataset_streams_and_verifies_every_artifact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = _fixture_root(tmp_path)
    manifest = load_manifest(root)
    payloads = {
        str(artifact.download_url): (root / "data/raw" / artifact.filename).read_bytes()
        for artifact in manifest.artifacts
    }
    for artifact in manifest.artifacts:
        (root / "data/raw" / artifact.filename).unlink()

    def fake_open(request: Request, *, timeout: int) -> _Response:
        assert timeout == 60
        artifact = next(
            item for item in manifest.artifacts if str(item.download_url) == request.full_url
        )
        return _Response(
            payloads[request.full_url],
            filename=artifact.filename,
            last_modified=artifact.last_modified,
            url=request.full_url,
        )

    monkeypatch.setattr("monusac_source_data.source._open_url", fake_open)

    evidence = acquire_dataset(root)

    assert len(evidence.artifacts) == 3
    assert (root / "data/raw/acquisition-evidence.json").is_file()
    assert not list((root / "data/raw").glob(".*.part"))


def test_remote_probe_checks_headers_without_reading_bodies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest = load_manifest(PROJECT_DIR)

    def fake_open(request: Request, *, timeout: int) -> _Response:
        assert timeout == 60
        assert request.method == "HEAD"
        artifact = next(
            item for item in manifest.artifacts if str(item.download_url) == request.full_url
        )
        response = _Response(
            b"",
            filename=artifact.filename,
            last_modified=artifact.last_modified,
            url=request.full_url,
        )
        response.headers.replace_header("Content-Length", str(artifact.bytes))
        return response

    monkeypatch.setattr("monusac_source_data.source._open_url", fake_open)

    evidence = probe_remote_artifacts(PROJECT_DIR)

    assert [item.filename for item in evidence] == [
        "MoNuSAC_images_and_annotations.zip",
        "MoNuSAC Testing Data and Annotations.zip",
        "MoNuSAC_Supplementary_material.pdf",
    ]


def test_redirect_handler_rejects_non_https_target() -> None:
    handler = _HttpsOnlyRedirectHandler()
    request = Request("https://example.test/source")

    with pytest.raises(SourceDataError, match="must use HTTPS"):
        handler.redirect_request(request, io.BytesIO(), 302, "Found", HTTPMessage(), "http://bad")
