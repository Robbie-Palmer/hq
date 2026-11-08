from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, cast

from slide_quality_dataset.models import (
    Adapter,
    HarmonizedRecord,
    ProductSpec,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPOSITORY_DIR = PROJECT_DIR.parents[2]


class MeshError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise MeshError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise MeshError(f"{path}:{number} must contain a JSON object")
        records.append(cast(dict[str, Any], payload))
    return records


def _load_adapter(path: Path) -> Adapter:
    return Adapter.model_validate_json(path.read_text(encoding="utf-8"))


def _mapping(adapter: Adapter) -> dict[str, tuple[list[str], str]]:
    return {item.source_label: (item.target_labels, item.status) for item in adapter.mappings}


def _split(group_id: str, spec: ProductSpec) -> str:
    digest = hashlib.sha256(f"{spec.grandqc_split.seed}:{group_id}".encode()).digest()
    value = int.from_bytes(digest[:8]) / 2**64
    if value < spec.grandqc_split.train_fraction:
        return "train"
    if value < spec.grandqc_split.train_fraction + spec.grandqc_split.validation_fraction:
        return "validation"
    return "internal_test"


def _record_id(product_id: str, source_dataset_id: str, source_record_id: str) -> str:
    digest = hashlib.sha256(
        f"{product_id}:{source_dataset_id}:{source_record_id}".encode()
    ).hexdigest()
    return f"harmonized:{digest}"


def adapt_grandqc(
    records: list[dict[str, Any]], adapter: Adapter, spec: ProductSpec
) -> list[HarmonizedRecord]:
    mapping = _mapping(adapter)
    output: list[HarmonizedRecord] = []
    for source in records:
        pixel_counts = cast(dict[str, int], source["native_label_pixel_counts"])
        source_labels = sorted(label for label, count in pixel_counts.items() if count > 0)
        missing = set(source_labels) - set(mapping)
        if missing:
            raise MeshError(f"GrandQC adapter is missing labels {sorted(missing)}")
        target_labels = sorted({target for label in source_labels for target in mapping[label][0]})
        source_record_id = str(source["sample_id"])
        output.append(
            HarmonizedRecord(
                product_id=spec.product_id,
                record_id=_record_id(spec.product_id, adapter.source_dataset_id, source_record_id),
                source_dataset_id=adapter.source_dataset_id,
                source_record_id=source_record_id,
                source_group_id=str(source["source_group_id"]),
                source_role=str(source["native_role"]),
                product_role=cast(Any, _split(str(source["source_group_id"]), spec)),
                role_mapping_status="overridden_for_development",
                image_scope="patch",
                image_path=str(source["image_path"]),
                annotation_path=str(source["mask_path"]),
                micrometres_per_pixel=float(source["micrometres_per_pixel"]),
                source_labels_present=source_labels,
                target_labels_present=target_labels,
                mapping_statuses={label: mapping[label][1] for label in source_labels},
                adapter_id=adapter.adapter_id,
                source_payload={
                    "organ": source["organ"],
                    "width": source["width"],
                    "height": source["height"],
                    "native_label_pixel_counts": pixel_counts,
                },
            )
        )
    return output


def adapt_airaqc(
    corpus: dict[str, Any], adapter: Adapter, spec: ProductSpec
) -> list[HarmonizedRecord]:
    mapping = _mapping(adapter)
    output: list[HarmonizedRecord] = []
    for source in corpus["slides"]:
        counts = cast(dict[str, int], source["annotation_counts"])
        source_labels = sorted(
            [
                *(label for label, count in counts.items() if count > 0),
                "unlabelled_pixels",
            ]
        )
        missing = set(source_labels) - set(mapping)
        if missing:
            raise MeshError(f"AIRAQc adapter is missing labels {sorted(missing)}")
        target_labels = sorted({target for label in source_labels for target in mapping[label][0]})
        source_record_id = str(source["slide_id"])
        output.append(
            HarmonizedRecord(
                product_id=spec.product_id,
                record_id=_record_id(spec.product_id, adapter.source_dataset_id, source_record_id),
                source_dataset_id=adapter.source_dataset_id,
                source_record_id=source_record_id,
                source_group_id=str(source["patient_id"]),
                source_role="fixed_public_pilot_test_partition",
                product_role="external_test",
                role_mapping_status="preserved",
                image_scope="whole_slide",
                image_path=str(source["source"]["relative_path"]),
                annotation_path=str(source["annotation"]["relative_path"]),
                micrometres_per_pixel=float(source["micrometres_per_pixel"]),
                source_labels_present=source_labels,
                target_labels_present=target_labels,
                mapping_statuses={label: mapping[label][1] for label in source_labels},
                adapter_id=adapter.adapter_id,
                source_payload={
                    "case_id": source["case_id"],
                    "project_id": source["project_id"],
                    "scanner_manufacturer": source["scanner_manufacturer"],
                    "scanner_model": source["scanner_model"],
                    "annotation_counts": counts,
                },
            )
        )
    return output


def _require_group_isolation(records: list[HarmonizedRecord]) -> None:
    roles: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in records:
        roles[(record.source_dataset_id, record.source_group_id)].add(record.product_role)
    contaminated = {key: values for key, values in roles.items() if len(values) > 1}
    if contaminated:
        raise MeshError(f"source groups cross product roles: {contaminated}")


def _metrics(records: list[HarmonizedRecord]) -> dict[str, object]:
    source_counts = Counter(record.source_dataset_id for record in records)
    role_counts = Counter(record.product_role for record in records)
    source_groups: dict[str, set[str]] = defaultdict(set)
    source_labels: dict[str, set[str]] = defaultdict(set)
    target_labels: dict[str, set[str]] = defaultdict(set)
    groups_by_role: dict[str, set[tuple[str, str]]] = defaultdict(set)
    grandqc_records_by_role_and_organ: Counter[str] = Counter()
    for record in records:
        source_groups[record.source_dataset_id].add(record.source_group_id)
        source_labels[record.source_dataset_id].update(record.source_labels_present)
        target_labels[record.source_dataset_id].update(record.target_labels_present)
        groups_by_role[record.product_role].add((record.source_dataset_id, record.source_group_id))
        organ = record.source_payload.get("organ")
        if isinstance(organ, str):
            grandqc_records_by_role_and_organ[f"{record.product_role}:{organ}"] += 1
    return {
        "record_count": len(records),
        "records_by_source": dict(sorted(source_counts.items())),
        "records_by_product_role": dict(sorted(role_counts.items())),
        "source_group_count": {
            source: len(groups) for source, groups in sorted(source_groups.items())
        },
        "source_groups_by_product_role": {
            role: len(groups) for role, groups in sorted(groups_by_role.items())
        },
        "grandqc_records_by_product_role_and_organ": dict(
            sorted(grandqc_records_by_role_and_organ.items())
        ),
        "source_label_coverage": {
            source: sorted(labels) for source, labels in sorted(source_labels.items())
        },
        "target_label_coverage": {
            source: sorted(labels) for source, labels in sorted(target_labels.items())
        },
        "training_record_count": role_counts["train"],
        "validation_record_count": role_counts["validation"],
        "internal_test_record_count": role_counts["internal_test"],
        "external_test_record_count": role_counts["external_test"],
    }


def _reconciliation(records: list[HarmonizedRecord], adapters: list[Adapter]) -> dict[str, object]:
    status_counts = Counter(
        status for record in records for status in record.mapping_statuses.values()
    )
    grandqc_records = [
        record for record in records if record.source_dataset_id == "grandqc-test-mpp20-v1"
    ]
    all_target_labels = {label for record in records for label in record.target_labels_present}
    grandqc_target_labels = {
        label for record in grandqc_records for label in record.target_labels_present
    }
    observed_source_labels: dict[str, set[str]] = defaultdict(set)
    for record in records:
        observed_source_labels[record.source_dataset_id].update(record.source_labels_present)
    mapping_definition_counts = Counter(
        mapping.status for adapter in adapters for mapping in adapter.mappings
    )
    return {
        "adapter_ids": [adapter.adapter_id for adapter in adapters],
        "mapping_definition_counts": dict(sorted(mapping_definition_counts.items())),
        "mapping_status_occurrences": dict(sorted(status_counts.items())),
        "mapped_but_unobserved_source_labels": {
            adapter.source_dataset_id: sorted(
                {mapping.source_label for mapping in adapter.mappings}
                - observed_source_labels[adapter.source_dataset_id]
            )
            for adapter in adapters
        },
        "dropped_record_count": 0,
        "reannotated_record_count": 0,
        "enrichment": {
            "grandqc_only_record_count": len(grandqc_records),
            "combined_record_count": len(records),
            "records_added_by_airaqc": len(records) - len(grandqc_records),
            "target_labels_added_by_airaqc": sorted(all_target_labels - grandqc_target_labels),
            "external_evaluation_sources_added_by_airaqc": 1,
        },
        "retained_nuance": [
            "Every record retains its source dataset, source record, source group, "
            "native labels, adapter, and source payload.",
            "AIRAQc air bubble remains a fine concept and has the GrandQC union "
            "concept as its ontology parent.",
            "GrandQC ignore pixels remain ignore pixels.",
        ],
        "lost_or_unavailable_nuance": [
            "GrandQC does not distinguish dark spots from foreign objects in class 3.",
            "GrandQC does not distinguish slide edges from air bubbles in class 5.",
            "AIRAQc unlabelled pixels cannot be interpreted as tissue or background.",
            "Using GrandQC for development overrides its publisher test-dataset role, "
            "so the internal test split is not comparable with the published GrandQC "
            "test result.",
        ],
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_product(
    root: Path = PROJECT_DIR,
    *,
    grandqc_index: Path | None = None,
    airaqc_corpus: Path | None = None,
) -> dict[str, object]:
    grandqc_adapter = _load_adapter(root / "adapters/grandqc-mpp20-v1.json")
    airaqc_adapter = _load_adapter(root / "adapters/airaqc-tcga-v1.json")
    spec = ProductSpec.model_validate_json(
        (root / "products/artifact-spatial-development-v1.json").read_text(encoding="utf-8")
    )
    grandqc_path = grandqc_index or (
        REPOSITORY_DIR / "data-products/grandqc/mpp20/outputs/native-index.jsonl"
    )
    airaqc_path = airaqc_corpus or (
        REPOSITORY_DIR / "data-products/airaqc/tcga-public-pilot/outputs/native-corpus.json"
    )
    records = adapt_grandqc(_read_jsonl(grandqc_path), grandqc_adapter, spec)
    records.extend(adapt_airaqc(_read_object(airaqc_path), airaqc_adapter, spec))
    records.sort(key=lambda record: record.record_id)
    _require_group_isolation(records)
    output_root = root / "outputs"
    harmonized_path = output_root / "harmonized/artifact-spatial-v1.jsonl"
    harmonized_path.parent.mkdir(parents=True, exist_ok=True)
    harmonized_path.write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    metrics = _metrics(records)
    partitions: dict[str, list[str]] = defaultdict(list)
    for record in records:
        partitions[record.product_role].append(record.record_id)
    _write_json(output_root / "metrics.json", metrics)
    _write_json(output_root / "partitions.json", dict(sorted(partitions.items())))
    _write_json(
        output_root / "lineage.json",
        {
            "product_id": spec.product_id,
            "imports": _read_object(root / "imports.json")["imports"],
            "ontology": "ontologies/artifact-spatial-v1.json",
            "adapters": [
                "adapters/grandqc-mpp20-v1.json",
                "adapters/airaqc-tcga-v1.json",
            ],
            "record_lineage_fields": [
                "source_dataset_id",
                "source_record_id",
                "source_group_id",
                "source_role",
                "product_role",
                "adapter_id",
                "source_labels_present",
                "mapping_statuses",
                "source_payload",
            ],
        },
    )
    _write_json(
        output_root / "reconciliation.json",
        _reconciliation(records, [grandqc_adapter, airaqc_adapter]),
    )
    return metrics
