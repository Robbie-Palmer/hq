from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any, cast

from panda_source_data.models import (
    ArtifactReference,
    NativeRecord,
    PrivateMetrics,
    Provider,
    ProviderScale,
    PublicMetrics,
    SourceManifest,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class SourceDataError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SourceDataError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], value)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(root: Path = PROJECT_DIR) -> SourceManifest:
    return SourceManifest.model_validate_json((root / "manifest.json").read_text(encoding="utf-8"))


def _resolve_file(root: Path, relative: str) -> Path:
    path = (root / relative).resolve(strict=True)
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise SourceDataError(f"artifact escapes the source product: {relative}") from error
    if not path.is_file():
        raise SourceDataError(f"artifact is not a regular file: {relative}")
    return path


def _verify_evidence(root: Path, manifest: SourceManifest) -> None:
    for record in manifest.source_records:
        path = _resolve_file(root, record.snapshot_path)
        if _sha256(path) != record.snapshot_sha256:
            raise SourceDataError(f"official record snapshot changed: {record.record_id}")


def publish_contract(root: Path = PROJECT_DIR) -> dict[str, object]:
    manifest = load_manifest(root)
    _verify_evidence(root, manifest)
    provider_counts: dict[str, int] = {
        provider.provider_id: provider.development_slide_count for provider in manifest.providers
    }
    metrics = PublicMetrics(
        dataset_id=manifest.dataset_id,
        dataset_version=manifest.dataset_version,
        development_patient_count=manifest.distribution.development_patients,
        development_slide_count=manifest.distribution.development_slides,
        development_mask_count=manifest.distribution.development_masks,
        provider_slide_counts=provider_counts,
        source_record_count=len(manifest.source_records),
    )
    _write_json(root / "outputs/source-contract.json", manifest.model_dump(mode="json"))
    _write_json(
        root / "outputs/artifact-reference-contract.json",
        {
            "schema_version": manifest.schema_version,
            "dataset_id": manifest.dataset_id,
            "competition_ref": manifest.distribution.competition_ref,
            "record_reference_template": manifest.interfaces.record_reference_template,
            "artifact_reference_template": manifest.interfaces.artifact_reference_template,
            "slide_path_template": manifest.distribution.slide_path_template,
            "mask_path_template": manifest.distribution.mask_path_template,
            "private_native_index_path": manifest.interfaces.private_native_index_path,
            "private_artifact_index_path": manifest.interfaces.private_artifact_index_path,
        },
    )
    _write_json(root / "outputs/source-metrics.json", metrics.model_dump(mode="json"))
    return metrics.model_dump(mode="json")


def _artifact(
    root: Path,
    manifest: SourceManifest,
    image_id: str,
    kind: str,
    relative: str,
) -> ArtifactReference:
    path = _resolve_file(root, relative)
    publisher_path = relative.removeprefix("data/native/")
    return ArtifactReference.model_validate(
        {
            "dataset_id": manifest.dataset_id,
            "artifact_ref": f"panda:{image_id}:{kind}",
            "image_id": image_id,
            "kind": kind,
            "publisher_path": publisher_path,
            "original_reference": (
                f"kaggle://competitions/{manifest.distribution.competition_ref}/{publisher_path}"
            ),
            "local_path": relative,
            "bytes": path.stat().st_size,
            "sha256": _sha256(path),
            "format": manifest.distribution.format,
        }
    )


def _provider_map(manifest: SourceManifest) -> dict[str, Provider]:
    return {provider.provider_id: provider for provider in manifest.providers}


def _load_rows(path: Path, required_fields: list[str]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None or not set(required_fields).issubset(reader.fieldnames):
            raise SourceDataError("train.csv lacks required PANDA fields")
        rows = [dict(row) for row in reader]
    if not rows:
        raise SourceDataError("train.csv contains no development records")
    return rows


def _record(
    root: Path,
    manifest: SourceManifest,
    providers: dict[str, Provider],
    row: dict[str, str],
) -> tuple[NativeRecord, list[ArtifactReference]]:
    image_id = row["image_id"].strip()
    provider_id = row["data_provider"].strip().lower()
    provider = providers.get(provider_id)
    if not image_id or provider is None:
        raise SourceDataError(f"invalid PANDA image or provider identity: {image_id or '<empty>'}")
    try:
        isup_grade = int(row["isup_grade"])
    except ValueError as error:
        raise SourceDataError(f"invalid ISUP grade for {image_id}") from error
    slide_relative = f"data/native/train_images/{image_id}.tiff"
    artifacts = [_artifact(root, manifest, image_id, "whole_slide", slide_relative)]
    mask_relative = f"data/native/train_label_masks/{image_id}_mask.tiff"
    mask_path = root / mask_relative
    mask_ref = None
    if mask_path.is_file():
        mask = _artifact(root, manifest, image_id, "label_mask", mask_relative)
        artifacts.append(mask)
        mask_ref = mask.artifact_ref
    record = NativeRecord.model_validate(
        {
            "dataset_id": manifest.dataset_id,
            "record_ref": f"panda:{image_id}",
            "image_id": image_id,
            "slide_id": image_id,
            "patient_id": None,
            "case_id": None,
            "identity_status": "patient_and_case_ids_not_published",
            "data_provider": provider.provider_id,
            "institution": provider.institution,
            "publisher_role": manifest.distribution.publisher_role,
            "stain": manifest.distribution.stain,
            "gleason_score": row["gleason_score"].strip(),
            "isup_grade": isup_grade,
            "provider_scale": ProviderScale(
                source_scan_magnification=provider.scan_magnification,
                source_scan_micrometres_per_pixel=provider.source_scan_micrometres_per_pixel,
                published_tiff_micrometres_per_pixel=(
                    provider.published_tiff_micrometres_per_pixel
                ),
                scanner_vendors=provider.scanner_vendors,
                basis="official_challenge_record_provider_level",
            ),
            "mask_annotation": {
                "available": mask_ref is not None,
                "annotation_unit": provider.mask_annotation_unit,
                "native_codes": provider.mask_codes,
                "artifact_ref": mask_ref,
            },
            "whole_slide_artifact_ref": artifacts[0].artifact_ref,
        }
    )
    return record, artifacts


def index_native_release(
    root: Path = PROJECT_DIR,
    *,
    metadata_path: Path | None = None,
    output_root: Path | None = None,
    require_complete: bool = True,
) -> dict[str, object]:
    manifest = load_manifest(root)
    _verify_evidence(root, manifest)
    train_csv = metadata_path or root / "data/native/train.csv"
    rows = _load_rows(train_csv, list(manifest.distribution.metadata_fields))
    image_ids = [row["image_id"].strip() for row in rows]
    if len(image_ids) != len(set(image_ids)):
        raise SourceDataError("PANDA image_id values must be unique")
    providers = _provider_map(manifest)
    records: list[NativeRecord] = []
    artifacts: list[ArtifactReference] = []
    for row in rows:
        record, record_artifacts = _record(root, manifest, providers, row)
        records.append(record)
        artifacts.extend(record_artifacts)
    provider_counts = Counter(record.data_provider for record in records)
    mask_count = sum(record.mask_annotation.available for record in records)
    expected_provider_counts = {
        provider.provider_id: provider.development_slide_count for provider in manifest.providers
    }
    if require_complete:
        if len(records) != manifest.distribution.development_slides:
            raise SourceDataError("source record count differs from the 10,616-slide release")
        if dict(provider_counts) != expected_provider_counts:
            raise SourceDataError("provider counts differ from the published development release")
        if mask_count != manifest.distribution.development_masks:
            raise SourceDataError("mask count differs from the 10,516-mask release")
    train_csv_sha256 = _sha256(train_csv)
    metrics = PrivateMetrics(
        dataset_id=manifest.dataset_id,
        artifact_count=len(artifacts),
        mask_count=mask_count,
        provider_slide_counts=dict(sorted(provider_counts.items())),
        record_count=len(records),
        train_csv_bytes=train_csv.stat().st_size,
        train_csv_sha256=train_csv_sha256,
    )
    destination = output_root or root / "outputs/private"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "native-index.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    (destination / "artifact-references.jsonl").write_text(
        "".join(
            json.dumps(artifact.model_dump(mode="json"), sort_keys=True) + "\n"
            for artifact in artifacts
        ),
        encoding="utf-8",
    )
    _write_json(destination / "source-metrics.json", metrics.model_dump(mode="json"))
    return metrics.model_dump(mode="json")
