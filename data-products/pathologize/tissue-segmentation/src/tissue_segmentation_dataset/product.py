from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, cast

from pydantic import BaseModel

from tissue_segmentation_dataset.models import (
    Adapter,
    AnnotationProvenance,
    AssayProvenance,
    BcssRecord,
    CrcEpitheliumRecord,
    HarmonizedRecord,
    ProductSpec,
    SegPathRecord,
    SourceArtifactReference,
)

PROJECT_DIR = Path(__file__).resolve().parents[2]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _read_records(path: Path, model: type[BaseModel]) -> list[BaseModel]:
    records: list[BaseModel] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            records.append(model.model_validate_json(line))
        except ValueError as error:
            raise ProductError(f"invalid source record at {path}:{number}: {error}") from error
    if not records:
        raise ProductError(f"{path} contains no source records")
    return records


def _record_id(product_id: str, source_dataset_id: str, source_record_id: str) -> str:
    digest = hashlib.sha256(
        f"{product_id}:{source_dataset_id}:{source_record_id}".encode()
    ).hexdigest()
    return f"tissue:{digest}"


def _group_split(source_dataset_id: str, group_id: str, spec: ProductSpec) -> str:
    policy = spec.split_policy
    value = (
        int.from_bytes(
            hashlib.sha256(f"{policy.seed}:{source_dataset_id}:{group_id}".encode()).digest()[:8]
        )
        / 2**64
    )
    if value < policy.train_fraction:
        return "train"
    if value < policy.train_fraction + policy.validation_fraction:
        return "validation"
    return "test"


def _product_role(
    source_dataset_id: str,
    source_group_id: str,
    source_role: str,
    spec: ProductSpec,
) -> tuple[str, str]:
    try:
        policy = spec.source_role_policy[source_dataset_id]
    except KeyError as error:
        raise ProductError(f"missing role policy for {source_dataset_id}") from error
    if policy == "preserve":
        if source_role == "unassigned":
            raise ProductError(f"{source_dataset_id} requires a publisher role")
        return source_role, "preserved"
    if source_role != "unassigned":
        return source_role, "preserved"
    return _group_split(source_dataset_id, source_group_id, spec), "assigned_by_group_hash"


def _mapped_labels(source_labels: list[str], adapter: Adapter) -> tuple[list[str], dict[str, Any]]:
    mappings = {mapping.source_label: mapping for mapping in adapter.mappings}
    missing = set(source_labels) - set(mappings)
    if missing:
        raise ProductError(
            f"{adapter.source_dataset_id} adapter is missing source labels {sorted(missing)}"
        )
    targets = sorted(
        {
            target
            for source_label in source_labels
            for target in mappings[source_label].target_labels
        }
    )
    statuses = {source_label: mappings[source_label].status for source_label in source_labels}
    return targets, statuses


def _artifact(
    dataset_id: str, path: str, checksum: str, media_type: str
) -> SourceArtifactReference:
    return SourceArtifactReference(
        source_dataset_id=dataset_id,
        path=path,
        media_type=media_type,
        checksum=checksum,
    )


def _common_record(
    *,
    spec: ProductSpec,
    adapter: Adapter,
    source_record_id: str,
    source_group_id: str,
    source_role: str,
    organ: str,
    source_tissue_role: str | None,
    image_path: str,
    mask_path: str,
    image_media_type: str,
    mask_media_type: str,
    image_sha256: str,
    mask_sha256: str,
    width: int,
    height: int,
    micrometres_per_pixel: float,
    image_assay: AssayProvenance,
    annotation_provenance: AnnotationProvenance,
    source_labels: list[str],
    source_payload: dict[str, Any],
) -> HarmonizedRecord:
    if image_assay.technique not in adapter.expected_image_techniques:
        raise ProductError(
            f"{adapter.source_dataset_id} does not allow image technique {image_assay.technique}"
        )
    annotation_technique = (
        annotation_provenance.evidence_assay.technique
        if annotation_provenance.evidence_assay is not None
        else None
    )
    if annotation_technique is not None and (
        annotation_technique not in adapter.expected_annotation_techniques
    ):
        raise ProductError(
            f"{adapter.source_dataset_id} does not allow annotation technique "
            f"{annotation_technique}"
        )
    product_role, role_status = _product_role(
        adapter.source_dataset_id, source_group_id, source_role, spec
    )
    target_labels, mapping_statuses = _mapped_labels(source_labels, adapter)
    return HarmonizedRecord(
        product_id=spec.product_id,
        record_id=_record_id(spec.product_id, adapter.source_dataset_id, source_record_id),
        source_dataset_id=adapter.source_dataset_id,
        source_record_id=source_record_id,
        source_group_id=source_group_id,
        source_role=cast(Any, source_role),
        product_role=cast(Any, product_role),
        role_mapping_status=cast(Any, role_status),
        organ=organ,
        source_tissue_role=source_tissue_role,
        segmentation_scope="semantic_regions",
        coverage_semantics=adapter.coverage_semantics,
        image_artifact=_artifact(
            adapter.source_dataset_id, image_path, image_sha256, image_media_type
        ),
        mask_artifact=_artifact(adapter.source_dataset_id, mask_path, mask_sha256, mask_media_type),
        width=width,
        height=height,
        micrometres_per_pixel=micrometres_per_pixel,
        image_assay=image_assay,
        annotation_provenance=annotation_provenance,
        source_labels_present=sorted(source_labels),
        target_labels_present=target_labels,
        mapping_statuses=cast(Any, mapping_statuses),
        adapter_id=adapter.adapter_id,
        source_payload=source_payload,
        fixture_record=spec.fixture_data_only,
    )


def _adapt_bcss(
    records: list[BaseModel], adapter: Adapter, spec: ProductSpec
) -> list[HarmonizedRecord]:
    output: list[HarmonizedRecord] = []
    for model in records:
        source = cast(BcssRecord, model)
        output.append(
            _common_record(
                spec=spec,
                adapter=adapter,
                source_record_id=source.roi_id,
                source_group_id=source.patient_id,
                source_role=source.source_role,
                organ=source.organ,
                source_tissue_role=None,
                image_path=source.image_path,
                mask_path=source.mask_path,
                image_media_type=source.image_media_type,
                mask_media_type=source.mask_media_type,
                image_sha256=source.image_sha256,
                mask_sha256=source.mask_sha256,
                width=source.width,
                height=source.height,
                micrometres_per_pixel=source.micrometres_per_pixel,
                image_assay=AssayProvenance(
                    technique="H&E",
                    targets=[],
                    source_description="BCSS H&E ROI image",
                ),
                annotation_provenance=AnnotationProvenance(
                    method="structured_crowdsourcing_consensus",
                    evidence_assay=None,
                    registered_to_image=False,
                    registration_method=None,
                ),
                source_labels=source.native_labels_present,
                source_payload={"slide_id": source.slide_id},
            )
        )
    return output


def _adapt_segpath(
    records: list[BaseModel], adapter: Adapter, spec: ProductSpec
) -> list[HarmonizedRecord]:
    output: list[HarmonizedRecord] = []
    for model in records:
        source = cast(SegPathRecord, model)
        output.append(
            _common_record(
                spec=spec,
                adapter=adapter,
                source_record_id=source.patch_id,
                source_group_id=source.slide_id,
                source_role=source.source_role,
                organ=source.organ,
                source_tissue_role=None,
                image_path=source.image_path,
                mask_path=source.mask_path,
                image_media_type=source.image_media_type,
                mask_media_type=source.mask_media_type,
                image_sha256=source.image_sha256,
                mask_sha256=source.mask_sha256,
                width=source.width,
                height=source.height,
                micrometres_per_pixel=source.micrometres_per_pixel,
                image_assay=AssayProvenance(
                    technique="H&E",
                    targets=[],
                    source_description="SegPath H&E patch before destaining",
                ),
                annotation_provenance=AnnotationProvenance(
                    method="immunofluorescence_restain",
                    evidence_assay=AssayProvenance(
                        technique="IF",
                        targets=[source.antigen],
                        source_description="SegPath registered IF restain",
                    ),
                    registered_to_image=True,
                    registration_method=source.registration_method,
                ),
                source_labels=[source.source_label],
                source_payload={"slide_id": source.slide_id, "antigen": source.antigen},
            )
        )
    return output


def _adapt_crc(
    records: list[BaseModel], adapter: Adapter, spec: ProductSpec
) -> list[HarmonizedRecord]:
    output: list[HarmonizedRecord] = []
    for model in records:
        source = cast(CrcEpitheliumRecord, model)
        targets = [] if source.marker_or_target is None else [source.marker_or_target]
        output.append(
            _common_record(
                spec=spec,
                adapter=adapter,
                source_record_id=source.image_id,
                source_group_id=source.patient_id,
                source_role=source.source_role,
                organ=source.organ,
                source_tissue_role=source.tissue_role,
                image_path=source.image_path,
                mask_path=source.mask_path,
                image_media_type=source.image_media_type,
                mask_media_type=source.mask_media_type,
                image_sha256=source.image_sha256,
                mask_sha256=source.mask_sha256,
                width=source.width,
                height=source.height,
                micrometres_per_pixel=source.micrometres_per_pixel,
                image_assay=AssayProvenance(
                    technique=source.image_assay,
                    targets=targets,
                    source_description="Colorectal TMA source image assay",
                ),
                annotation_provenance=AnnotationProvenance(
                    method="pathologist_manual",
                    evidence_assay=None,
                    registered_to_image=False,
                    registration_method=None,
                ),
                source_labels=[source.source_label],
                source_payload={
                    "core_id": source.core_id,
                    "tissue_role": source.tissue_role,
                    "marker_or_target": source.marker_or_target,
                },
            )
        )
    return output


def _require_group_isolation(records: list[HarmonizedRecord]) -> None:
    roles: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record in records:
        roles[(record.source_dataset_id, record.source_group_id)].add(record.product_role)
    conflicts = {key: sorted(values) for key, values in roles.items() if len(values) > 1}
    if conflicts:
        raise ProductError(f"source groups cross product roles: {conflicts}")


def _load_adapters(root: Path) -> list[Adapter]:
    adapters = [
        Adapter.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted((root / "adapters").glob("*.json"))
    ]
    if not adapters:
        raise ProductError("no source adapters found")
    return adapters


def _validate_contracts(
    root: Path, spec: ProductSpec, adapters: list[Adapter], imports: dict[str, Any]
) -> None:
    ontology = _read_object(root / "ontologies/tissue-compartment-v1.json")
    concepts = {item["id"] for item in ontology["concepts"]}
    adapter_sources = {adapter.source_dataset_id for adapter in adapters}
    imported_sources = {item["source_dataset_id"] for item in imports["imports"]}
    if adapter_sources != imported_sources or adapter_sources != set(spec.source_role_policy):
        raise ProductError("imports, adapters, and source role policies must name the same sources")
    for adapter in adapters:
        if adapter.target_ontology_id != spec.ontology_id:
            raise ProductError(f"{adapter.adapter_id} targets the wrong ontology")
        targets = {target for mapping in adapter.mappings for target in mapping.target_labels}
        if missing := targets - concepts:
            raise ProductError(f"{adapter.adapter_id} targets unknown concepts {sorted(missing)}")


def _metrics(records: list[HarmonizedRecord]) -> dict[str, object]:
    source_groups: dict[str, set[str]] = defaultdict(set)
    source_labels: dict[str, set[str]] = defaultdict(set)
    target_labels: dict[str, set[str]] = defaultdict(set)
    for record in records:
        source_groups[record.source_dataset_id].add(record.source_group_id)
        source_labels[record.source_dataset_id].update(record.source_labels_present)
        target_labels[record.source_dataset_id].update(record.target_labels_present)
    return {
        "record_count": len(records),
        "source_count": len(source_groups),
        "fixture_record_count": sum(record.fixture_record for record in records),
        "records_by_source": dict(sorted(Counter(r.source_dataset_id for r in records).items())),
        "groups_by_source": {
            source: len(groups) for source, groups in sorted(source_groups.items())
        },
        "records_by_product_role": dict(
            sorted(Counter(record.product_role for record in records).items())
        ),
        "organs": sorted({record.organ for record in records}),
        "image_assay_techniques": sorted({record.image_assay.technique for record in records}),
        "annotation_evidence_techniques": sorted(
            {
                record.annotation_provenance.evidence_assay.technique
                for record in records
                if record.annotation_provenance.evidence_assay is not None
            }
        ),
        "source_label_coverage": {
            source: sorted(labels) for source, labels in sorted(source_labels.items())
        },
        "target_label_coverage": {
            source: sorted(labels) for source, labels in sorted(target_labels.items())
        },
        "mapping_status_occurrences": dict(
            sorted(
                Counter(
                    status for record in records for status in record.mapping_statuses.values()
                ).items()
            )
        ),
        "group_leakage_count": 0,
        "owned_binary_output_count": 0,
    }


def _reconciliation(
    records: list[HarmonizedRecord], adapters: list[Adapter], imports: dict[str, Any]
) -> dict[str, object]:
    source_counts = Counter(record.source_dataset_id for record in records)
    source_groups: dict[str, set[str]] = defaultdict(set)
    for record in records:
        source_groups[record.source_dataset_id].add(record.source_group_id)
    status_counts = Counter(mapping.status for adapter in adapters for mapping in adapter.mappings)
    pending = [
        item["source_dataset_id"]
        for item in imports["imports"]
        if item["status"] != "pinned_source_product"
    ]
    return {
        "adapter_ids": [adapter.adapter_id for adapter in adapters],
        "mapping_definition_counts": dict(sorted(status_counts.items())),
        "records_added_by_source": dict(sorted(source_counts.items())),
        "groups_added_by_source": {
            source: len(groups) for source, groups in sorted(source_groups.items())
        },
        "collapsed_concept_count": status_counts["source_merged"],
        "unmapped_concept_count": status_counts["unmapped"],
        "dropped_concept_count": status_counts["dropped"],
        "dropped_record_count": 0,
        "reannotated_record_count": 0,
        "source_role_override_count": 0,
        "derived_role_assignment_count": sum(
            record.role_mapping_status == "assigned_by_group_hash" for record in records
        ),
        "source_limitations": {
            adapter.source_dataset_id: adapter.limitations for adapter in adapters
        },
        "production_ready": not pending,
        "production_blockers": [
            f"pin source product and replace contract fixture: {source}" for source in pending
        ],
    }


def _assay_report(records: list[HarmonizedRecord]) -> dict[str, object]:
    matrix: Counter[str] = Counter()
    for record in records:
        annotation_technique = (
            record.annotation_provenance.evidence_assay.technique
            if record.annotation_provenance.evidence_assay is not None
            else "manual_or_consensus"
        )
        matrix[
            f"{record.source_dataset_id}:{record.image_assay.technique}:{annotation_technique}"
        ] += 1
    return {
        "records_by_source_image_and_annotation_assay": dict(sorted(matrix.items())),
        "rule": (
            "Image assay describes the pixels referenced by image_artifact. Annotation evidence "
            "assay describes how the mask was produced. They are never inferred to be identical."
        ),
    }


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_product(
    root: Path = PROJECT_DIR, *, source_paths: dict[str, Path] | None = None
) -> dict[str, object]:
    spec = ProductSpec.model_validate_json(
        (root / "products/general-tissue-segmentation-v1.json").read_text(encoding="utf-8")
    )
    imports = _read_object(root / "imports.json")
    adapters = _load_adapters(root)
    _validate_contracts(root, spec, adapters, imports)
    input_paths = source_paths or {
        item["source_dataset_id"]: root / item["contract_fixture"] for item in imports["imports"]
    }
    model_by_kind: dict[str, type[BaseModel]] = {
        "bcss": BcssRecord,
        "segpath": SegPathRecord,
        "crc_epithelium": CrcEpitheliumRecord,
    }
    adapter_by_kind = {adapter.source_kind: adapter for adapter in adapters}
    expected_sources = {adapter.source_dataset_id for adapter in adapters}
    if set(input_paths) != expected_sources:
        raise ProductError("source paths must cover every configured source exactly once")
    records: list[HarmonizedRecord] = []
    bcss_adapter = adapter_by_kind["bcss"]
    records.extend(
        _adapt_bcss(
            _read_records(input_paths[bcss_adapter.source_dataset_id], model_by_kind["bcss"]),
            bcss_adapter,
            spec,
        )
    )
    segpath_adapter = adapter_by_kind["segpath"]
    records.extend(
        _adapt_segpath(
            _read_records(input_paths[segpath_adapter.source_dataset_id], model_by_kind["segpath"]),
            segpath_adapter,
            spec,
        )
    )
    crc_adapter = adapter_by_kind["crc_epithelium"]
    records.extend(
        _adapt_crc(
            _read_records(
                input_paths[crc_adapter.source_dataset_id], model_by_kind["crc_epithelium"]
            ),
            crc_adapter,
            spec,
        )
    )
    records.sort(key=lambda record: record.record_id)
    _require_group_isolation(records)
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "records.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    partitions: dict[str, list[str]] = defaultdict(list)
    for record in records:
        partitions[record.product_role].append(record.record_id)
    metrics = _metrics(records)
    _write_json(output_root / "partitions.json", dict(sorted(partitions.items())))
    _write_json(output_root / "metrics.json", metrics)
    _write_json(output_root / "reconciliation.json", _reconciliation(records, adapters, imports))
    _write_json(output_root / "assay-provenance.json", _assay_report(records))
    _write_json(
        output_root / "lineage.json",
        {
            "product_id": spec.product_id,
            "imports": imports["imports"],
            "adapters": [f"adapters/{adapter.source_dataset_id}.json" for adapter in adapters],
            "ontology": "ontologies/tissue-compartment-v1.json",
            "source_artifact_reference_fields": ["image_artifact", "mask_artifact"],
            "owned_binary_outputs": [],
            "binary_transformations": [],
            "record_lineage_fields": [
                "source_dataset_id",
                "source_record_id",
                "source_group_id",
                "source_role",
                "source_labels_present",
                "image_artifact",
                "mask_artifact",
                "image_assay",
                "annotation_provenance",
                "adapter_id",
                "source_payload",
            ],
        },
    )
    return metrics
