import hashlib
import json
from pathlib import Path

import pytest

from colorectal_multistain_source.models import (
    MarkerRole,
    NativeAssay,
    NativeTissue,
    SourceArtifact,
    SourceArtifactRole,
    SourceManifest,
)
from colorectal_multistain_source.source import (
    SourceDataError,
    _artifact_records,
    _remote_zip_names,
    _verify_dataverse,
    _verify_zenodo,
    acquire_artifact,
    index_native_references,
    load_manifest,
    verify_local_artifact,
    verify_metadata,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _manifest() -> SourceManifest:
    return load_manifest(PROJECT_DIR)


def _dataverse_payload(manifest: SourceManifest) -> dict[str, object]:
    files = [
        {
            "label": artifact.label,
            "dataFile": {
                "id": artifact.datafile_id,
                "persistentId": artifact.persistent_id,
                "filesize": artifact.bytes,
                "contentType": artifact.content_type,
                "checksum": {"type": "MD5", "value": artifact.md5},
            },
        }
        for artifact in manifest.artifacts
    ]
    return {
        "status": "OK",
        "data": {
            "id": 4496,
            "versionNumber": 1,
            "versionMinorNumber": 0,
            "versionState": "RELEASED",
            "releaseTime": "2025-01-21T15:40:45Z",
            "license": {"rightsIdentifier": "CC0-1.0"},
            "files": files,
        },
    }


def _zenodo_payload(manifest: SourceManifest) -> dict[str, object]:
    record = manifest.authoritative_records.zenodo
    return {
        "id": record.record_id,
        "doi": manifest.doi,
        "metadata": {
            "license": {"id": "cc-by-4.0"},
            "description": "Total: 13,179 image/mask pairs. Dataset use must adhere to CC0.",
        },
        "files": [
            {
                "key": file.name,
                "size": file.bytes,
                "checksum": f"md5:{file.md5}",
            }
            for file in record.files
        ],
    }


def _artifact(manifest: SourceManifest, artifact_id: str) -> SourceArtifact:
    return next(artifact for artifact in manifest.artifacts if artifact.artifact_id == artifact_id)


def test_manifest_preserves_every_native_assay_marker_and_control() -> None:
    manifest = _manifest()
    image_artifacts = [
        artifact
        for artifact in manifest.artifacts
        if artifact.source_role is SourceArtifactRole.IMAGE_MASK_PAIRS
    ]

    assert len(manifest.artifacts) == 20
    assert len(image_artifacts) == 18
    assert sum(artifact.expected_pair_count or 0 for artifact in image_artifacts) == 13179
    assert {artifact.native_assay for artifact in image_artifacts} == set(NativeAssay)
    assert {
        artifact.native_marker
        for artifact in image_artifacts
        if artifact.marker_role
        in {MarkerRole.MIRNA_PROBE, MarkerRole.NEGATIVE_CONTROL, MarkerRole.POSITIVE_CONTROL}
    } == {"Scrambled probe", "U6 snRNA", "miR-143", "miR-145"}
    assert {
        artifact.native_marker
        for artifact in image_artifacts
        if artifact.marker_role is MarkerRole.PROTEIN
    } == {
        "CD44",
        "CTNND1",
        "E-Cadherin",
        "FSCN1",
        "KLF5",
        "KRAS",
        "Ki-67",
        "LASP1",
        "MACC1",
        "NAIP",
        "SMAD3",
        "Smooth Muscle Actin (SMA)",
        "Vimentin",
    }
    assert manifest.native_corpus.publisher_partition is None
    assert manifest.native_corpus.represented_specimen_group_count == 567
    assert (
        manifest.native_corpus.annotation_validation == "all annotations validated by pathologists"
    )
    assert manifest.rights.canonical.spdx_id == "CC0-1.0"
    assert manifest.rights.zenodo_metadata_discrepancy.platform_license_id == "cc-by-4.0"


def test_dataverse_metadata_matches_pinned_version_files_and_rights() -> None:
    manifest = _manifest()

    result = _verify_dataverse(_dataverse_payload(manifest), manifest)

    assert result["file_count"] == 20
    assert result["total_bytes"] == 470971048454
    assert result["license_spdx_id"] == "CC0-1.0"


def test_dataverse_metadata_rejects_changed_checksum() -> None:
    manifest = _manifest()
    payload = _dataverse_payload(manifest)
    data = payload["data"]
    assert isinstance(data, dict)
    files = data["files"]
    assert isinstance(files, list)
    files[0]["dataFile"]["checksum"]["value"] = "0" * 32

    with pytest.raises(SourceDataError, match="files differ"):
        _verify_dataverse(payload, manifest)


def test_zenodo_metadata_preserves_rights_discrepancy_and_files() -> None:
    manifest = _manifest()

    result = _verify_zenodo(_zenodo_payload(manifest), manifest)

    assert result["rights_discrepancy_preserved"] is True
    assert result["platform_license_id"] == "cc-by-4.0"
    assert result["description_license_spdx_id"] == "CC0-1.0"


def test_verify_metadata_writes_stable_payload_without_archive_downloads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = _manifest()
    (tmp_path / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    class FakeMetadataClient:
        def get_json_object(self, url: str) -> dict[str, object]:
            if "zenodo" in url:
                return _zenodo_payload(manifest)
            return _dataverse_payload(manifest)

    monkeypatch.setattr(
        "colorectal_multistain_source.source._METADATA_CLIENT", FakeMetadataClient()
    )

    report = verify_metadata(tmp_path)

    assert report["verification_mode"] == "publisher metadata only; no archive payloads fetched"
    written = json.loads(
        (tmp_path / "outputs/metadata-verification.json").read_text(encoding="utf-8")
    )
    assert written == report


def test_artifact_records_preserve_pair_and_specimen_group() -> None:
    manifest = _manifest()
    artifact = _artifact(manifest, "he").model_copy(update={"expected_pair_count": 2})
    names = [
        "HE/",
        "HE/Cancer/",
        "HE/Cancer/HE__A001-4.jpg",
        "HE/Cancer/HE__A001-4.png",
        "HE/Normal mucosa/",
        "HE/Normal mucosa/HE__A001-1.jpg",
        "HE/Normal mucosa/HE__A001-1.png",
    ]

    records = _artifact_records(manifest, artifact, names)

    assert len(records) == 2
    assert {record.patient_group_id for record in records} == {"A001"}
    assert {record.specimen_group_id for record in records} == {
        "A001:Cancer:4",
        "A001:Normal mucosa:1",
    }
    assert all(
        record.image_member.removesuffix(".jpg") == record.source_pair_stem for record in records
    )
    assert all(
        record.mask_member.removesuffix(".png") == record.source_pair_stem for record in records
    )
    assert all(record.publisher_partition is None for record in records)


def test_artifact_records_reject_orphan_masks_and_wrong_core_groups() -> None:
    manifest = _manifest()
    artifact = _artifact(manifest, "cd44").model_copy(update={"expected_pair_count": 1})

    with pytest.raises(SourceDataError, match="images without masks"):
        _artifact_records(manifest, artifact, ["CD44/Cancer/CD44_A001-4.jpg"])
    with pytest.raises(SourceDataError, match="conflicts with source tissue"):
        _artifact_records(
            manifest,
            artifact,
            [
                "CD44/Normal mucosa/CD44_A001-4.jpg",
                "CD44/Normal mucosa/CD44_A001-4.png",
            ],
        )


def _fake_archive_names(artifact: SourceArtifact) -> list[str]:
    assert artifact.expected_pair_count is not None
    root = artifact.label.removesuffix(".zip")
    names = [f"{root}/", f"{root}/Cancer/", f"{root}/Normal mucosa/"]
    specimen_groups = [
        (patient_number, tissue, core)
        for patient_number in range(1, 101)
        for tissue, cores in (
            (NativeTissue.NORMAL_MUCOSA, (1, 2, 3)),
            (NativeTissue.CANCER, (4, 5, 6)),
        )
        for core in cores
        if not (patient_number <= 33 and tissue is NativeTissue.CANCER and core == 6)
    ]
    assert len(specimen_groups) == 567
    for index in range(artifact.expected_pair_count):
        patient_number, tissue, core = specimen_groups[index % len(specimen_groups)]
        stem = f"{root}/{tissue}/{root}_batch{index:04d}_A{patient_number:03d}-{core}"
        names.extend((f"{stem}.jpg", f"{stem}.png"))
    return names


def test_index_writes_all_stable_native_references_from_zip_metadata(tmp_path: Path) -> None:
    manifest = _manifest()
    (tmp_path / "manifest.json").write_text(
        (PROJECT_DIR / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    image_artifacts = [
        artifact
        for artifact in manifest.artifacts
        if artifact.source_role is SourceArtifactRole.IMAGE_MASK_PAIRS
    ]
    names_by_artifact = {
        artifact.artifact_id: _fake_archive_names(artifact) for artifact in image_artifacts
    }

    metrics = index_native_references(tmp_path, names_by_artifact)

    assert metrics["record_count"] == 13179
    assert metrics["patient_group_count"] == 100
    assert metrics["paired_image_count"] == metrics["paired_mask_count"] == 13179
    assert metrics["records_by_native_assay"] == {
        "H&E": 552,
        "ISH": 5495,
        "Immunohistochemistry": 7132,
    }
    lines = (tmp_path / "outputs/native-index.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 13179
    first = json.loads(lines[0])
    assert first["source_artifact_persistent_id"].startswith("doi:10.18710/DIGQGQ/")


def test_remote_zip_reads_only_member_names(monkeypatch: pytest.MonkeyPatch) -> None:
    manifest = _manifest()
    artifact = _artifact(manifest, "he")

    class FakeRemoteZip:
        def __init__(self, url: str, *, timeout: tuple[int, int]) -> None:
            assert str(artifact.datafile_id) in url
            assert timeout == (10, 60)

        def __enter__(self) -> "FakeRemoteZip":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def namelist(self) -> list[str]:
            return ["HE/Cancer/HE__A001-4.jpg", "HE/Cancer/HE__A001-4.png"]

    monkeypatch.setattr("colorectal_multistain_source.source.RemoteZip", FakeRemoteZip)

    assert _remote_zip_names(artifact) == [
        "HE/Cancer/HE__A001-4.jpg",
        "HE/Cancer/HE__A001-4.png",
    ]


def test_acquire_streams_one_explicit_artifact_and_verifies_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = _manifest()
    payload = b"publisher artifact"
    digest = hashlib.md5(payload, usedforsecurity=False).hexdigest()
    source_artifact = _artifact(manifest, "readme")
    artifact = source_artifact.model_copy(update={"bytes": len(payload), "md5": digest})
    patched_manifest = manifest.model_copy(
        update={
            "artifacts": [
                artifact if item.artifact_id == artifact.artifact_id else item
                for item in manifest.artifacts
            ]
        }
    )
    monkeypatch.setattr(
        "colorectal_multistain_source.source.load_manifest", lambda _root: patched_manifest
    )

    class FakeResponse:
        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def raise_for_status(self) -> None:
            return None

        def iter_content(self, *, chunk_size: int) -> list[bytes]:
            assert chunk_size == 1024 * 1024
            return [payload]

    def fake_get(url: str, *, stream: bool, timeout: tuple[int, int]) -> FakeResponse:
        assert str(artifact.datafile_id) in url
        assert stream is True
        assert timeout == (10, 120)
        return FakeResponse()

    monkeypatch.setattr("colorectal_multistain_source.source.requests.get", fake_get)

    acquired = acquire_artifact("readme", tmp_path)

    assert acquired.read_bytes() == payload
    assert not acquired.with_name(f".{acquired.name}.part").exists()
    verify_local_artifact(acquired, artifact)


def test_local_verification_rejects_changed_artifact(tmp_path: Path) -> None:
    manifest = _manifest()
    artifact = _artifact(manifest, "readme")
    path = tmp_path / artifact.label
    path.write_bytes(b"changed")

    with pytest.raises(SourceDataError, match="byte count differs"):
        verify_local_artifact(path, artifact)
