from __future__ import annotations

import hashlib
import os
import re
import tempfile
from collections import Counter
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any

import requests
from data_artifacts.acquisition import HttpsMetadataClient
from data_artifacts.files import load_model, md5_file, write_json, write_jsonl
from remotezip import RemoteZip

from colorectal_multistain_source.models import (
    NativeRecord,
    NativeRecordRole,
    NativeTissue,
    SourceArtifact,
    SourceArtifactRole,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
_PAIR_RE = re.compile(r"^(?P<acquisition>.+)_(?P<patient>A\d{3})-(?P<core>[1-6])$")
_METADATA_CLIENT = HttpsMetadataClient(
    allowed_hosts=frozenset({"dataverse.no", "zenodo.org"}),
    user_agent="colorectal-multistain-source/0.1 (+metadata-only)",
)


class SourceDataError(RuntimeError):
    pass


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return load_model(root / "manifest.json", SourceManifest)


def _dataverse_file_projection(file: Mapping[str, Any]) -> dict[str, object]:
    data_file = file["dataFile"]
    checksum = data_file["checksum"]
    return {
        "label": file["label"],
        "datafile_id": data_file["id"],
        "persistent_id": data_file["persistentId"],
        "bytes": data_file["filesize"],
        "content_type": data_file["contentType"],
        "checksum_type": checksum["type"],
        "checksum_value": checksum["value"],
    }


def _manifest_file_projection(artifact: SourceArtifact) -> dict[str, object]:
    return {
        "label": artifact.label,
        "datafile_id": artifact.datafile_id,
        "persistent_id": artifact.persistent_id,
        "bytes": artifact.bytes,
        "content_type": artifact.content_type,
        "checksum_type": "MD5",
        "checksum_value": artifact.md5,
    }


def _verify_dataverse(payload: Mapping[str, Any], manifest: SourceManifest) -> dict[str, object]:
    if payload.get("status") != "OK":
        raise SourceDataError("Dataverse metadata response was not OK")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise SourceDataError("Dataverse metadata response has no dataset version")
    expected_version = manifest.source_version
    actual_version = {
        "dataset_version_id": data.get("id"),
        "major": data.get("versionNumber"),
        "minor": data.get("versionMinorNumber"),
        "state": data.get("versionState"),
        "released_at": data.get("releaseTime"),
    }
    pinned_version = {
        "dataset_version_id": expected_version.dataset_version_id,
        "major": expected_version.major,
        "minor": expected_version.minor,
        "state": expected_version.state,
        "released_at": expected_version.released_at.isoformat().replace("+00:00", "Z"),
    }
    if actual_version != pinned_version:
        raise SourceDataError("Dataverse V1 metadata differs from the pinned source version")
    license_metadata = data.get("license")
    if not isinstance(license_metadata, dict):
        raise SourceDataError("Dataverse V1 has no license metadata")
    if license_metadata.get("rightsIdentifier") != manifest.rights.canonical.spdx_id:
        raise SourceDataError("Dataverse V1 rights differ from the pinned CC0 rights")
    actual_files = sorted(
        (_dataverse_file_projection(file) for file in data.get("files", [])),
        key=lambda item: str(item["label"]),
    )
    expected_files = sorted(
        (_manifest_file_projection(artifact) for artifact in manifest.artifacts),
        key=lambda item: str(item["label"]),
    )
    if actual_files != expected_files:
        raise SourceDataError("Dataverse V1 files differ from the pinned artifact manifest")
    return {
        "record": "DataverseNO",
        "version": expected_version.label,
        "dataset_version_id": expected_version.dataset_version_id,
        "license_spdx_id": manifest.rights.canonical.spdx_id,
        "file_count": len(actual_files),
        "total_bytes": sum(artifact.bytes for artifact in manifest.artifacts),
        "checksums": "all publisher-provided MD5 values matched",
    }


def _verify_zenodo(payload: Mapping[str, Any], manifest: SourceManifest) -> dict[str, object]:
    record = manifest.authoritative_records.zenodo
    if payload.get("id") != record.record_id or payload.get("doi") != manifest.doi:
        raise SourceDataError("Zenodo record identity differs from the pinned mirror")
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise SourceDataError("Zenodo record has no metadata")
    license_metadata = metadata.get("license")
    if not isinstance(license_metadata, dict):
        raise SourceDataError("Zenodo record has no platform license field")
    platform_license = license_metadata.get("id")
    if platform_license != manifest.rights.zenodo_metadata_discrepancy.platform_license_id:
        raise SourceDataError("Zenodo platform license differs from the recorded discrepancy")
    description = metadata.get("description")
    pinned_description_license = (
        manifest.rights.zenodo_metadata_discrepancy.description_license_spdx_id
    )
    description_license_mentions = (
        re.findall(r"\b(?P<negated>not\s+)?CC0(?:[- ]1\.0)?\b", description, flags=re.IGNORECASE)
        if isinstance(description, str)
        else []
    )
    actual_description_license = (
        "CC0-1.0"
        if description_license_mentions and not any(description_license_mentions)
        else None
    )
    if (
        not isinstance(description, str)
        or actual_description_license != pinned_description_license
        or "13,179" not in description
    ):
        raise SourceDataError(
            "Zenodo description no longer states the pinned corpus size and CC0 terms"
        )
    actual_files = sorted(
        (
            {
                "name": file["key"],
                "bytes": file["size"],
                "md5": str(file["checksum"]).removeprefix("md5:"),
            }
            for file in payload.get("files", [])
        ),
        key=lambda item: str(item["name"]),
    )
    expected_files = sorted(
        (file.model_dump(mode="json") for file in record.files),
        key=lambda item: str(item["name"]),
    )
    if actual_files != expected_files:
        raise SourceDataError("Zenodo mirror files differ from the pinned metadata")
    return {
        "record": "Zenodo 14800740",
        "platform_license_id": platform_license,
        "description_license_spdx_id": (
            manifest.rights.zenodo_metadata_discrepancy.description_license_spdx_id
        ),
        "file_count": len(actual_files),
        "checksums": "all publisher-provided MD5 values matched",
        "rights_discrepancy_preserved": True,
    }


def verify_metadata(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    dataverse_payload = _METADATA_CLIENT.get_json_object(
        str(manifest.authoritative_records.dataverse.version_api_url)
    )
    zenodo_payload = _METADATA_CLIENT.get_json_object(
        str(manifest.authoritative_records.zenodo.api_url)
    )
    report: dict[str, object] = {
        "schema_version": manifest.schema_version,
        "dataset_id": manifest.dataset_id,
        "doi": manifest.doi,
        "verification_mode": "publisher metadata only; no archive payloads fetched",
        "dataverse": _verify_dataverse(dataverse_payload, manifest),
        "zenodo": _verify_zenodo(zenodo_payload, manifest),
    }
    output = root / "outputs/metadata-verification.json"
    write_json(output, report)
    return report


def _artifact_url(artifact: SourceArtifact) -> str:
    return f"https://dataverse.no/api/access/datafile/{artifact.datafile_id}?format=original"


def _remote_zip_names(artifact: SourceArtifact) -> list[str]:
    with RemoteZip(_artifact_url(artifact), timeout=(10, 60)) as archive:
        return archive.namelist()


def _record_id(dataset_id: str, artifact: SourceArtifact, pair_stem: str) -> str:
    identity = f"{dataset_id}:{artifact.persistent_id}:{pair_stem}"
    return f"colorectal-multistain:v1:{hashlib.sha256(identity.encode()).hexdigest()}"


def _native_record(
    manifest: SourceManifest,
    artifact: SourceArtifact,
    pair_stem: str,
    image_member: str,
    mask_member: str,
) -> NativeRecord:
    parts = PurePosixPath(pair_stem).parts
    if len(parts) != 3 or parts[0] != artifact.label.removesuffix(".zip"):
        raise SourceDataError(f"{artifact.label}: unexpected source member path {pair_stem}")
    tissue = parts[1]
    if tissue not in manifest.native_corpus.tissue_values:
        raise SourceDataError(f"{artifact.label}: unknown publisher tissue value {tissue}")
    match = _PAIR_RE.fullmatch(parts[2])
    if match is None:
        raise SourceDataError(f"{artifact.label}: cannot parse source pair identity {pair_stem}")
    patient = match.group("patient")
    core = int(match.group("core"))
    allowed_cores = (
        manifest.native_corpus.cancer_core_numbers
        if tissue == NativeTissue.CANCER
        else manifest.native_corpus.normal_core_numbers
    )
    if core not in allowed_cores:
        raise SourceDataError(
            f"{artifact.label}: core {core} conflicts with source tissue {tissue}"
        )
    if (
        artifact.native_assay is None
        or artifact.native_marker is None
        or artifact.marker_role is None
    ):
        raise SourceDataError(f"{artifact.label}: image-mask artifact lacks assay metadata")
    return NativeRecord(
        dataset_id=manifest.dataset_id,
        record_id=_record_id(manifest.dataset_id, artifact, pair_stem),
        patient_group_id=patient,
        specimen_group_id=f"{patient}:{tissue}:{core}",
        native_tissue=tissue,
        native_core_number=core,
        native_assay=artifact.native_assay,
        native_marker=artifact.native_marker,
        marker_role=artifact.marker_role,
        source_acquisition_label=match.group("acquisition").rstrip("_"),
        source_role=NativeRecordRole.SEMANTIC_SEGMENTATION_PAIR,
        source_artifact_id=artifact.artifact_id,
        source_artifact_persistent_id=artifact.persistent_id,
        source_pair_stem=pair_stem,
        image_member=image_member,
        image_role="TMA core image",
        mask_member=mask_member,
        mask_role="epithelium segmentation mask",
        publisher_partition=None,
    )


def _artifact_records(
    manifest: SourceManifest,
    artifact: SourceArtifact,
    names: list[str],
) -> list[NativeRecord]:
    unsupported = [
        name
        for name in names
        if not name.endswith("/") and not name.lower().endswith((".jpg", ".png"))
    ]
    if unsupported:
        raise SourceDataError(f"{artifact.label}: unsupported archive members {unsupported[:3]}")
    file_names = [name for name in names if not name.endswith("/")]
    duplicates = [name for name, count in Counter(file_names).items() if count > 1]
    if duplicates:
        raise SourceDataError(f"{artifact.label}: duplicate archive members {duplicates[:3]}")
    images = {name[:-4]: name for name in file_names if name.lower().endswith(".jpg")}
    masks = {name[:-4]: name for name in file_names if name.lower().endswith(".png")}
    if len(images) + len(masks) != len(file_names):
        raise SourceDataError(f"{artifact.label}: duplicate image or mask pair stems")
    image_stems = set(images)
    mask_stems = set(masks)
    if image_stems != mask_stems:
        raise SourceDataError(
            f"{artifact.label}: found {len(image_stems - mask_stems)} images without masks and "
            f"{len(mask_stems - image_stems)} masks without images"
        )
    if len(images) != artifact.expected_pair_count:
        raise SourceDataError(
            f"{artifact.label}: expected {artifact.expected_pair_count} pairs, found {len(images)}"
        )
    return [
        _native_record(manifest, artifact, stem, images[stem], masks[stem])
        for stem in sorted(images)
    ]


def index_native_references(
    root: Path = PROJECT_DIR,
    names_by_artifact: Mapping[str, list[str]] | None = None,
) -> dict[str, object]:
    manifest = load_manifest(root)
    image_artifacts = [
        artifact
        for artifact in manifest.artifacts
        if artifact.source_role is SourceArtifactRole.IMAGE_MASK_PAIRS
    ]
    records: list[NativeRecord] = []
    counts_by_artifact: dict[str, int] = {}
    for artifact in image_artifacts:
        names = (
            names_by_artifact[artifact.artifact_id]
            if names_by_artifact is not None
            else _remote_zip_names(artifact)
        )
        artifact_records = _artifact_records(manifest, artifact, names)
        records.extend(artifact_records)
        counts_by_artifact[artifact.artifact_id] = len(artifact_records)
    if len(records) != manifest.native_corpus.image_mask_pair_count:
        raise SourceDataError(
            f"expected {manifest.native_corpus.image_mask_pair_count} records, found {len(records)}"
        )
    patient_groups = {record.patient_group_id for record in records}
    expected_patient_groups = {f"A{number:03d}" for number in range(1, 101)}
    if patient_groups != expected_patient_groups:
        raise SourceDataError("remote archive directories do not preserve patient groups A001-A100")
    specimen_groups = {record.specimen_group_id for record in records}
    if len(specimen_groups) != manifest.native_corpus.represented_specimen_group_count:
        raise SourceDataError(
            "remote archive directories differ from the 567 represented specimen groups"
        )
    output_root = root / "outputs"
    write_jsonl(output_root / "native-index.jsonl", records)
    assay_counts = Counter(record.native_assay for record in records)
    tissue_counts = Counter(record.native_tissue for record in records)
    metrics: dict[str, object] = {
        "schema_version": manifest.schema_version,
        "dataset_id": manifest.dataset_id,
        "indexing_mode": "remote ZIP directory metadata only; no image or mask payloads fetched",
        "record_count": len(records),
        "patient_group_count": len(patient_groups),
        "specimen_group_count": len(specimen_groups),
        "paired_image_count": len(records),
        "paired_mask_count": len(records),
        "records_by_artifact": counts_by_artifact,
        "records_by_native_assay": dict(sorted(assay_counts.items())),
        "records_by_native_tissue": dict(sorted(tissue_counts.items())),
    }
    write_json(output_root / "source-metrics.json", metrics)
    return metrics


def verify_local_artifact(path: Path, artifact: SourceArtifact) -> None:
    if not path.is_file() or path.is_symlink():
        raise SourceDataError(f"missing regular source artifact: {path}")
    if path.stat().st_size != artifact.bytes:
        raise SourceDataError(f"source artifact byte count differs: {path}")
    if md5_file(path) != artifact.md5:
        raise SourceDataError(f"source artifact MD5 differs: {path}")


def _checked_download_size(total: int, artifact: SourceArtifact) -> int:
    if total > artifact.bytes:
        raise SourceDataError(
            f"source artifact exceeds declared byte count: {artifact.artifact_id}"
        )
    return total


def acquire_artifact(artifact_id: str, root: Path = PROJECT_DIR) -> Path:
    manifest = load_manifest(root)
    artifacts = {artifact.artifact_id: artifact for artifact in manifest.artifacts}
    artifact = artifacts.get(artifact_id)
    if artifact is None:
        raise SourceDataError(f"unknown artifact ID: {artifact_id}")
    destination = root / "data/raw" / artifact.label
    if destination.is_file():
        verify_local_artifact(destination, artifact)
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".part", dir=destination.parent
    )
    os.close(file_descriptor)
    temporary = Path(temporary_name)
    try:
        with requests.get(_artifact_url(artifact), stream=True, timeout=(10, 120)) as response:
            response.raise_for_status()
            written = 0
            with temporary.open("wb") as output:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        written = _checked_download_size(written + len(chunk), artifact)
                        output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        verify_local_artifact(temporary, artifact)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return destination
