from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, cast

from camelyon_roi_product.models import ArtifactManifest, NativeRecord, SourceContract

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], value)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _load_records(path: Path) -> list[NativeRecord]:
    payload = _read_json(path)
    raw_records = payload.get("records")
    if not isinstance(raw_records, list):
        raise ProductError("native record contract must contain a records list")
    return [NativeRecord.model_validate(value) for value in raw_records]


def _validate_links(
    records: list[NativeRecord], artifacts: ArtifactManifest, source: SourceContract
) -> None:
    by_id = {artifact.artifact_id: artifact for artifact in artifacts.artifacts}
    if len(by_id) != len(artifacts.artifacts):
        raise ProductError("artifact identifiers must be unique")
    record_ids = [record.record_id for record in records]
    if len(record_ids) != len(set(record_ids)):
        raise ProductError("record identifiers must be unique")
    annotation_ids = {archive.artifact_id for archive in source.annotation_archives}
    for record in records:
        artifact = by_id.get(record.slide_artifact.artifact_id)
        if artifact is None or record.slide_id not in artifact.contains_slide_ids:
            raise ProductError(f"{record.record_id}: invalid slide artifact reference")
        if (
            record.lesion_annotation is not None
            and record.lesion_annotation.artifact_id not in annotation_ids
        ):
            raise ProductError(f"{record.record_id}: invalid annotation artifact reference")


def _validate_native_semantics(records: list[NativeRecord]) -> None:
    for record in records:
        if record.challenge == "CAMELYON16":
            if any((record.patient_id, record.centre_id, record.node_id)):
                raise ProductError("CAMELYON16 records must not invent unpublished identities")
            expected_groups = ["_0", "_1", "_2"]
        else:
            if not all((record.patient_id, record.centre_id, record.node_id)):
                raise ProductError("CAMELYON17 records must preserve patient, centre, and node")
            expected_groups = ["metastases", "normal"]
        if record.lesion_annotation is not None:
            if record.lesion_annotation.native_groups != expected_groups:
                raise ProductError(f"{record.record_id}: native XML groups differ")
        elif (
            record.slide_label.lower() not in {"normal", "negative"}
            and record.annotation_completeness != "non_exhaustive"
        ):
            raise ProductError(f"{record.record_id}: positive slide lacks an XML reference")


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    source = SourceContract.model_validate(_read_json(root / "contracts/source.json"))
    artifacts = ArtifactManifest.model_validate(_read_json(root / "contracts/artifacts.json"))
    records = _load_records(root / "records/native-records.json")
    if source.dataset_id != artifacts.dataset_id:
        raise ProductError("source and artifact dataset identifiers differ")
    _validate_links(records, artifacts, source)
    _validate_native_semantics(records)

    challenge_counts = Counter(record.challenge for record in records)
    if challenge_counts != Counter({"CAMELYON16": 399, "CAMELYON17": 50}):
        raise ProductError("native record counts differ from the declared source scope")
    output = root / "outputs"
    output.mkdir(parents=True, exist_ok=True)
    (output / "native-records.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    _write_json(
        output / "artifact-references.json",
        {
            "schema_version": "1.0.0",
            "dataset_id": source.dataset_id,
            "slide_artifacts": artifacts.model_dump(mode="json")["artifacts"],
            "annotation_archives": [
                archive.model_dump(mode="json") for archive in source.annotation_archives
            ],
        },
    )
    metrics: dict[str, object] = {
        "artifact_count": len(artifacts.artifacts),
        "camelyon16_slide_count": challenge_counts["CAMELYON16"],
        "camelyon17_annotated_slide_count": challenge_counts["CAMELYON17"],
        "non_exhaustive_annotation_count": sum(
            record.annotation_completeness == "non_exhaustive" for record in records
        ),
        "patient_count": len({record.patient_id for record in records if record.patient_id}),
        "record_count": len(records),
        "xml_referenced_slide_count": sum(
            record.lesion_annotation is not None for record in records
        ),
    }
    _write_json(output / "metrics.json", metrics)
    return metrics
