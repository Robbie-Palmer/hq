from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, cast

from nucls_source_data.models import NativeRecord

from nucleus_analysis_dataset.models import Adapter, CohortEvidence, DatasetRecord, ProductSpec

PROJECT_DIR = Path(__file__).resolve().parents[2]
REPOSITORY_DIR = PROJECT_DIR.parents[2]
SOURCE_PROJECT = REPOSITORY_DIR / "data-products/nucls/corrected-single-rater"
DATASET_ROOT = SOURCE_PROJECT


class ProductError(RuntimeError):
    pass


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _load_native_records(path: Path) -> list[NativeRecord]:
    return [
        NativeRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


def _intersection(values: dict[str, set[str]], left: str, right: str) -> list[str]:
    return sorted(values[left].intersection(values[right]))


def _role(record: NativeRecord, spec: ProductSpec) -> str:
    test_fold = str(spec.test_fold)
    validation_fold = str(spec.validation_fold)
    if record.source_roles.get(test_fold) == "test":
        return "test"
    if record.source_roles.get(validation_fold) == "test":
        if record.source_roles.get(test_fold) != "train":
            raise ProductError(f"validation record is outside the training pool: {record.item_id}")
        return "validation"
    if record.source_roles.get(test_fold) == "train":
        return "train"
    raise ProductError(f"record is missing frozen source roles: {record.item_id}")


def adapt_records(
    native_records: list[NativeRecord], adapter: Adapter, spec: ProductSpec
) -> list[DatasetRecord]:
    mapping = {item.source_label: item for item in adapter.mappings}
    records: list[DatasetRecord] = []
    for source in native_records:
        missing = set(source.source_labels_present) - set(mapping)
        if missing:
            raise ProductError(f"adapter is missing source labels {sorted(missing)}")
        records.append(
            DatasetRecord(
                product_id=spec.product_id,
                source_dataset_id=source.dataset_id,
                item_id=source.item_id,
                slide_id=source.slide_id,
                patient_id=source.patient_id,
                site_id=source.site_id,
                split=cast(Any, _role(source, spec)),
                image_path=source.image_path,
                annotation_path=source.annotation_path,
                source_roles=source.source_roles,
                source_labels_present=source.source_labels_present,
                source_ontology_labels_present=source.source_ontology_labels_present,
                target_labels_present=sorted(
                    {mapping[label].target_label for label in source.source_labels_present}
                ),
                annotation_count=source.annotation_count,
                adapter_id=adapter.adapter_id,
            )
        )
    return records


def _cohort(records: list[DatasetRecord], spec: ProductSpec) -> CohortEvidence:
    split_names = ("train", "validation", "test")
    patient_sets = {
        split: {item.patient_id for item in records if item.split == split} for split in split_names
    }
    slide_sets = {
        split: {item.slide_id for item in records if item.split == split} for split in split_names
    }
    site_sets = {
        split: {item.site_id for item in records if item.split == split} for split in split_names
    }
    patient_intersections = {
        "train_validation": _intersection(patient_sets, "train", "validation"),
        "train_test": _intersection(patient_sets, "train", "test"),
        "validation_test": _intersection(patient_sets, "validation", "test"),
    }
    slide_intersections = {
        "train_validation": _intersection(slide_sets, "train", "validation"),
        "train_test": _intersection(slide_sets, "train", "test"),
        "validation_test": _intersection(slide_sets, "validation", "test"),
    }
    site_intersections = {
        "train_validation": _intersection(site_sets, "train", "validation"),
        "train_test": _intersection(site_sets, "train", "test"),
        "validation_test": _intersection(site_sets, "validation", "test"),
    }
    if any(patient_intersections.values()) or any(slide_intersections.values()):
        raise ProductError("frozen NuCLS product leaks patients or slides across partitions")
    if site_intersections["train_test"]:
        raise ProductError("official NuCLS test partition is not site-held-out from training")
    item_counts = Counter(item.split for item in records)
    test_site_counts = Counter(item.site_id for item in records if item.split == "test")
    return CohortEvidence(
        schema_version="1.0.0",
        product_id=spec.product_id,
        leakage_unit="patient_id",
        secondary_leakage_unit="slide_id",
        source_statement=(
            "NuCLS reports one TCGA slide per patient; patient identifiers use the first "
            "three fields of the TCGA slide barcode."
        ),
        items=records,
        item_counts={split: item_counts[split] for split in split_names},
        patient_counts={split: len(patient_sets[split]) for split in split_names},
        slide_counts={split: len(slide_sets[split]) for split in split_names},
        site_counts=dict(sorted(test_site_counts.items())),
        patient_intersections=patient_intersections,
        slide_intersections=slide_intersections,
        site_intersections=site_intersections,
        held_out_test_sites=sorted(test_site_counts),
    )


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_product(
    root: Path = PROJECT_DIR, *, native_index: Path | None = None
) -> dict[str, object]:
    adapter = Adapter.model_validate_json(
        (root / "adapters/nucls-corrected-single-rater.json").read_text(encoding="utf-8")
    )
    spec = ProductSpec.model_validate_json(
        (root / "products/nucls-public.json").read_text(encoding="utf-8")
    )
    source_path = native_index or (SOURCE_PROJECT / "outputs/native-index.jsonl")
    records = adapt_records(_load_native_records(source_path), adapter, spec)
    records.sort(key=lambda record: record.item_id)
    cohort = _cohort(records, spec)
    output_root = root / "outputs"
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "records.jsonl").write_text(
        "".join(
            json.dumps(record.model_dump(mode="json"), sort_keys=True) + "\n" for record in records
        ),
        encoding="utf-8",
    )
    _write_json(output_root / "cohort.json", cohort.model_dump(mode="json"))
    partitions = {
        split: [record.item_id for record in records if record.split == split]
        for split in ("train", "validation", "test")
    }
    _write_json(output_root / "partitions.json", partitions)
    imports = _load_json_object(root / "imports.json")["imports"]
    _write_json(
        output_root / "lineage.json",
        {
            "product_id": spec.product_id,
            "imports": imports,
            "adapter": "adapters/nucls-corrected-single-rater.json",
            "ontology": "ontologies/source-preserving.json",
            "product": "products/nucls-public.json",
            "record_lineage_fields": [
                "source_dataset_id",
                "item_id",
                "slide_id",
                "patient_id",
                "site_id",
                "source_roles",
                "source_labels_present",
                "source_ontology_labels_present",
                "adapter_id",
            ],
        },
    )
    _write_json(
        output_root / "reconciliation.json",
        {
            "adapter_id": adapter.adapter_id,
            "mapping_definition_counts": {"exact": len(adapter.mappings)},
            "dropped_record_count": 0,
            "reannotated_record_count": 0,
            "collapsed_concept_count": 0,
            "role_policy": {
                "test": f"official fold {spec.test_fold} test",
                "validation": (
                    f"official fold {spec.validation_fold} test within fold {spec.test_fold} train"
                ),
                "train": f"remaining official fold {spec.test_fold} train",
            },
            "retained_nuance": [
                "All five public NuCLS labels are preserved exactly.",
                "Every official source fold role remains on each record.",
                "Point, rectangle, and polygon coordinate semantics remain source-native.",
                "Images without annotations remain in the product.",
                "Raw, main, and super-class ontology labels remain attached to each record.",
                (
                    "Source annotation CSVs remain unmodified; the release has no "
                    "separate ignore-region geometry."
                ),
            ],
            "lost_or_unavailable_nuance": [],
        },
    )
    metrics: dict[str, object] = {
        "product_id": spec.product_id,
        "record_count": len(records),
        "records_by_role": cohort.item_counts,
        "patients_by_role": cohort.patient_counts,
        "slides_by_role": cohort.slide_counts,
        "held_out_test_sites": cohort.held_out_test_sites,
        "test_records_by_site": cohort.site_counts,
        "empty_annotation_record_count": sum(record.annotation_count == 0 for record in records),
        "source_label_coverage": sorted(
            {label for record in records for label in record.source_labels_present}
        ),
        "target_label_coverage": sorted(
            {label for record in records for label in record.target_labels_present}
        ),
        "patient_leakage_count": sum(
            len(values) for values in cohort.patient_intersections.values()
        ),
        "slide_leakage_count": sum(len(values) for values in cohort.slide_intersections.values()),
    }
    _write_json(output_root / "metrics.json", metrics)
    return metrics


def load_records(path: Path = PROJECT_DIR / "outputs/records.jsonl") -> list[DatasetRecord]:
    return [
        DatasetRecord.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
    ]


def load_cohort(path: Path = PROJECT_DIR / "outputs/cohort.json") -> CohortEvidence:
    return CohortEvidence.model_validate_json(path.read_text(encoding="utf-8"))


def load_ontology_labels(
    path: Path = PROJECT_DIR / "ontologies/source-preserving.json",
) -> list[str]:
    labels = _load_json_object(path).get("labels")
    if (
        not isinstance(labels, list)
        or not labels
        or not all(isinstance(label, str) for label in labels)
    ):
        raise ProductError("nucleus-analysis ontology labels must be a nonempty string list")
    if len(labels) != len(set(labels)):
        raise ProductError("nucleus-analysis ontology labels must be unique")
    return labels
