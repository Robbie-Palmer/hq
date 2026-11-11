from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, cast

from roi_segmentation_dataset.models import (
    Adapter,
    ImportManifest,
    NativeROIRecord,
    ProductSpec,
    ROIRecord,
    SourceArtifactReference,
    SourceImport,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _read_native_records(path: Path) -> list[NativeROIRecord]:
    records: list[NativeROIRecord] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            records.append(NativeROIRecord.model_validate_json(line))
        except ValueError as error:
            raise ProductError(f"invalid native ROI record at {path}:{number}") from error
    return records


def _load_adapter(root: Path, source_dataset_id: str) -> Adapter:
    matches: list[Adapter] = []
    for path in sorted((root / "adapters").glob("*.json")):
        adapter = Adapter.model_validate_json(path.read_text(encoding="utf-8"))
        if adapter.source_dataset_id == source_dataset_id:
            matches.append(adapter)
    if len(matches) != 1:
        raise ProductError(f"expected one adapter for {source_dataset_id}, found {len(matches)}")
    return matches[0]


def _product_role(source: NativeROIRecord, spec: ProductSpec) -> tuple[str, str]:
    if source.source_role in spec.split_policy.official_test_roles:
        return "test", "preserved_official_test"
    group_key = f"{source.source_dataset_id}:{source.source_group_id}"
    digest = hashlib.sha256(f"{spec.split_policy.seed}:{group_key}".encode()).digest()
    value = int.from_bytes(digest[:8]) / 2**64
    if value < spec.split_policy.validation_fraction:
        return "validation", "repartitioned_development"
    return "train", "repartitioned_development"


def _record_id(spec: ProductSpec, source: NativeROIRecord) -> str:
    value = f"{spec.product_id}:{source.source_dataset_id}:{source.source_record_id}"
    return f"roi:{hashlib.sha256(value.encode()).hexdigest()}"


def adapt_records(
    native_records: list[NativeROIRecord], adapter: Adapter, spec: ProductSpec
) -> tuple[list[ROIRecord], Counter[str]]:
    if adapter.target_ontology_id != spec.ontology_id:
        raise ProductError(f"adapter {adapter.adapter_id} targets the wrong ontology")
    mappings = {mapping.source_label: mapping for mapping in adapter.mappings}
    output: list[ROIRecord] = []
    dropped: Counter[str] = Counter()
    seen: set[str] = set()
    for source in native_records:
        if source.source_dataset_id != adapter.source_dataset_id:
            raise ProductError(f"adapter {adapter.adapter_id} received another source dataset")
        identity = f"{source.source_dataset_id}:{source.source_record_id}"
        if identity in seen:
            raise ProductError(f"duplicate source ROI record: {identity}")
        seen.add(identity)
        mapping = mappings.get(source.source_region_label)
        if mapping is None:
            raise ProductError(
                f"adapter {adapter.adapter_id} is missing label {source.source_region_label}"
            )
        if mapping.target_role is None:
            dropped[mapping.status] += 1
            continue
        product_role, role_mapping_status = _product_role(source, spec)
        output.append(
            ROIRecord(
                product_id=spec.product_id,
                contract_id=spec.contract_id,
                record_id=_record_id(spec, source),
                source_dataset_id=source.source_dataset_id,
                source_record_id=source.source_record_id,
                slide_id=source.slide_id,
                source_group_id=source.source_group_id,
                source_role=source.source_role,
                product_role=cast(Any, product_role),
                role_mapping_status=cast(Any, role_mapping_status),
                organ=source.organ,
                image_artifact=SourceArtifactReference(
                    source_product_id=source.source_dataset_id,
                    artifact_id=source.image_artifact_id or source.image_reference,
                    uri=source.image_reference,
                    sha256=source.image_sha256,
                ),
                annotation_artifact=SourceArtifactReference(
                    source_product_id=source.source_dataset_id,
                    artifact_id=source.annotation_artifact_id or source.annotation_reference,
                    uri=source.annotation_reference,
                    sha256=source.annotation_sha256,
                ),
                stain=source.stain,
                coordinate_frame=source.coordinate_frame,
                region_id=source.region_id,
                source_region_label=source.source_region_label,
                target_roi_role=mapping.target_role,
                mapping_status=mapping.status,
                geometry=source.geometry,
                molecular_status_links=source.molecular_status_links,
                source_attributes=source.source_attributes,
                adapter_id=adapter.adapter_id,
            )
        )
    return output, dropped


def _partition_evidence(records: list[ROIRecord]) -> dict[str, object]:
    split_names = ("train", "validation", "test")
    group_splits: dict[str, set[str]] = defaultdict(set)
    slide_splits: dict[str, set[str]] = defaultdict(set)
    for record in records:
        group_splits[f"{record.source_dataset_id}:{record.source_group_id}"].add(
            record.product_role
        )
        slide_splits[f"{record.source_dataset_id}:{record.slide_id}"].add(record.product_role)
    leaking_groups = sorted(key for key, values in group_splits.items() if len(values) > 1)
    leaking_slides = sorted(key for key, values in slide_splits.items() if len(values) > 1)
    if leaking_groups or leaking_slides:
        raise ProductError("ROI product leaks source groups or slides across partitions")
    return {
        "policy": "official test roles stay test; other groups use seeded SHA-256",
        "roles": {
            split: sorted(record.record_id for record in records if record.product_role == split)
            for split in split_names
        },
        "group_counts": {
            split: len(
                {
                    f"{record.source_dataset_id}:{record.source_group_id}"
                    for record in records
                    if record.product_role == split
                }
            )
            for split in split_names
        },
        "group_leakage_count": len(leaking_groups),
        "slide_leakage_count": len(leaking_slides),
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _validate_contract(root: Path, spec: ProductSpec) -> None:
    contract = _read_object(root / "contracts/roi-segmentation-v1.json")
    ontology = _read_object(root / "ontologies/roi-selection-v1.json")
    if contract.get("contract_id") != spec.contract_id:
        raise ProductError("product and ROI contract IDs differ")
    if contract.get("semantic_scope") != "roi_selection":
        raise ProductError("ROI contract must be limited to ROI selection")
    if ontology.get("ontology_id") != spec.ontology_id:
        raise ProductError("product and ROI ontology IDs differ")
    if ontology.get("semantic_scope") != "roi_selection":
        raise ProductError("ROI ontology must be limited to ROI selection")


def _resolve_binding(root: Path, source_import: SourceImport) -> Path:
    path = Path(source_import.binding_path)
    return path if path.is_absolute() else root / path


def build_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    spec = ProductSpec.model_validate_json(
        (root / "products/roi-portfolio-v1.json").read_text(encoding="utf-8")
    )
    imports = ImportManifest.model_validate_json(
        (root / "imports.json").read_text(encoding="utf-8")
    )
    _validate_contract(root, spec)
    records: list[ROIRecord] = []
    dropped: Counter[str] = Counter()
    adapters: dict[str, Adapter] = {}
    for source_import in imports.imports:
        adapter = _load_adapter(root, source_import.dataset_id)
        adapters[source_import.dataset_id] = adapter
        source_records = _read_native_records(_resolve_binding(root, source_import))
        adapted, source_dropped = adapt_records(source_records, adapter, spec)
        records.extend(adapted)
        dropped.update(source_dropped)
    records.sort(key=lambda record: (record.source_dataset_id, record.source_record_id))
    if not records:
        raise ProductError("ROI product contains no retained records")
    record_ids = [record.record_id for record in records]
    if len(record_ids) != len(set(record_ids)):
        raise ProductError("derived ROI record IDs must be unique")
    partitions = _partition_evidence(records)

    output = root / "outputs"
    output.mkdir(parents=True, exist_ok=True)
    (output / "records.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    _write_json(output / "partitions.json", partitions)
    _write_json(
        output / "manifest.json",
        {
            "schema_version": "1.0.0",
            "product_id": spec.product_id,
            "product_kind": "derived_composition",
            "semantic_scope": "roi_selection",
            "records_table": "outputs/records.jsonl",
            "partitions": "outputs/partitions.json",
            "lineage": "outputs/lineage.json",
            "reconciliation": "outputs/reconciliation.json",
            "metrics": "outputs/metrics.json",
            "source_dataset_ids": sorted(item.dataset_id for item in imports.imports),
            "source_artifact_reference_fields": ["image_artifact", "annotation_artifact"],
            "binary_outputs": [],
        },
    )
    _write_json(
        output / "lineage.json",
        {
            "product_id": spec.product_id,
            "contract": "contracts/roi-segmentation-v1.json",
            "ontology": "ontologies/roi-selection-v1.json",
            "product": "products/roi-portfolio-v1.json",
            "imports": [item.model_dump(mode="json") for item in imports.imports],
            "adapters": {
                dataset_id: adapter.adapter_id for dataset_id, adapter in sorted(adapters.items())
            },
            "record_lineage_fields": [
                "source_dataset_id",
                "source_record_id",
                "slide_id",
                "source_group_id",
                "source_role",
                "source_region_label",
                "source_attributes",
                "image_artifact",
                "annotation_artifact",
                "adapter_id",
            ],
            "fixture_limitation": (
                "Contract fixtures contain synthetic metadata and geometry only. Source products "
                "must supply rights, retrieval, checksum, and redistribution evidence."
            ),
        },
    )
    mapping_definition_counts = Counter(
        mapping.status for adapter in adapters.values() for mapping in adapter.mappings
    )
    source_record_counts = Counter(record.source_dataset_id for record in records)
    _write_json(
        output / "reconciliation.json",
        {
            "mapping_definition_counts": dict(sorted(mapping_definition_counts.items())),
            "retained_records_by_source": dict(sorted(source_record_counts.items())),
            "dropped_records_by_mapping_status": dict(sorted(dropped.items())),
            "dropped_record_count": sum(dropped.values()),
            "reannotated_record_count": 0,
            "role_policy": partitions["policy"],
            "retained_nuance": [
                "Publisher labels remain in source_region_label beside the derived ROI role.",
                (
                    "Slide coordinates, pyramid level, physical scale, and polygon vertices "
                    "are copied without reprojection."
                ),
                (
                    "Organ, stain provenance, source roles, source attributes, and "
                    "molecular-status links remain attached."
                ),
            ],
            "lost_or_unavailable_nuance": [
                "Partial mappings generalize publisher lesion terms into ROI-selection roles.",
                (
                    "The contract fixtures do not establish source rights, retrieval, checksums, "
                    "or redistribution terms."
                ),
            ],
            "excluded_semantics": ["tissue_compartment", "artifact_quality"],
        },
    )
    role_counts = Counter(record.product_role for record in records)
    metrics: dict[str, object] = {
        "product_id": spec.product_id,
        "contract_id": spec.contract_id,
        "record_count": len(records),
        "records_by_source": dict(sorted(source_record_counts.items())),
        "records_by_role": {role: role_counts[role] for role in ("train", "validation", "test")},
        "organs": sorted({record.organ for record in records}),
        "stain_methods": sorted({record.stain.method for record in records}),
        "pyramid_levels": sorted({record.coordinate_frame.pyramid_level for record in records}),
        "records_with_physical_scale": sum(
            record.coordinate_frame.micrometres_per_pixel_x is not None for record in records
        ),
        "records_with_molecular_status": sum(
            bool(record.molecular_status_links) for record in records
        ),
        "source_label_coverage": sorted({record.source_region_label for record in records}),
        "target_role_coverage": sorted({record.target_roi_role for record in records}),
        "mapping_status_counts": dict(
            sorted(Counter(record.mapping_status for record in records).items())
        ),
        "group_leakage_count": partitions["group_leakage_count"],
        "slide_leakage_count": partitions["slide_leakage_count"],
        "fixture_binding_count": sum(
            item.binding_kind == "contract_fixture" for item in imports.imports
        ),
    }
    _write_json(output / "metrics.json", metrics)
    return metrics


def load_records(path: Path = PROJECT_DIR / "outputs/records.jsonl") -> list[ROIRecord]:
    return [
        ROIRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
    ]
