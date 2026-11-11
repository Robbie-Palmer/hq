from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, cast

from bcss_source_data.models import NativeCorpus, Ontology, SourceContract

PROJECT_DIR = Path(__file__).resolve().parents[2]
NATIVE_LABELS = [
    "outside_roi",
    "tumor",
    "stroma",
    "lymphocytic_infiltrate",
    "necrosis_or_debris",
    "glandular_secretions",
    "blood",
    "exclude",
    "metaplasia_NOS",
    "fat",
    "plasma_cells",
    "other_immune_infiltrate",
    "mucoid_material",
    "normal_acinus_or_duct",
    "lymphatics",
    "undetermined",
    "nerve",
    "skin_adnexa",
    "blood_vessel",
    "angioinvasion",
    "dcis",
    "other",
]


class ProductError(RuntimeError):
    pass


def _read_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProductError(f"{path} must contain a JSON object")
    return cast(dict[str, Any], payload)


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _validate_ontology(ontology: Ontology) -> None:
    codes = [item.code for item in ontology.codes]
    labels = [item.label for item in ontology.codes]
    if codes != list(range(22)) or labels != NATIVE_LABELS:
        raise ProductError("native ontology differs from the publisher code table")
    if {item.code for item in ontology.codes if item.source_use == "ignore"} != {0, 7}:
        raise ProductError("native ignore codes must remain outside_roi and exclude")


def _validate_corpus(contract: SourceContract, corpus: NativeCorpus) -> dict[str, object]:
    if corpus.dataset_id != contract.dataset_id or len(corpus.records) != contract.record_count:
        raise ProductError("native corpus identity or record count differs from its contract")
    records = corpus.records
    unique_fields = {
        "record": [record.record_id for record in records],
        "ROI": [record.roi_id for record in records],
        "patient": [record.patient_id for record in records],
        "slide": [record.slide_barcode for record in records],
        "mask": [record.mask.file_id for record in records],
    }
    for name, values in unique_fields.items():
        if len(values) != len(set(values)):
            raise ProductError(f"native {name} identities must be unique")
    if any(record.publisher_roles for record in records):
        raise ProductError("publisher role assignments were not released with the source metadata")

    unresolved = [
        record.wsi.publisher_file_name
        for record in records
        if record.wsi.gdc_resolution == "not_found_at_snapshot"
    ]
    if sorted(unresolved) != sorted(corpus.provenance.unresolved_gdc_wsi_names):
        raise ProductError("unresolved GDC identities differ from provenance")
    mask_bytes = sum(record.mask.bytes for record in records)
    magnifications = Counter(str(record.wsi.scan_magnification) for record in records)
    return {
        "dataset_id": contract.dataset_id,
        "record_count": len(records),
        "patient_count": len({record.patient_id for record in records}),
        "slide_count": len({record.slide_barcode for record in records}),
        "mask_count": len({record.mask.file_id for record in records}),
        "mask_bytes": mask_bytes,
        "native_code_count": 22,
        "native_ignore_codes": [0, 7],
        "gdc_resolved_wsi_count": len(records) - len(unresolved),
        "gdc_unresolved_wsi_count": len(unresolved),
        "scan_magnification_counts": dict(sorted(magnifications.items())),
        "published_microns_per_pixel": contract.physical_scale.published_microns_per_pixel,
        "record_level_publisher_role_count": 0,
    }


def publish_product(root: Path = PROJECT_DIR) -> dict[str, object]:
    contract_payload = _read_object(root / "contracts/source.json")
    ontology_payload = _read_object(root / "contracts/ontology.json")
    corpus_payload = _read_object(root / "records/native-corpus.json")
    contract = SourceContract.model_validate(contract_payload)
    ontology = Ontology.model_validate(ontology_payload)
    corpus = NativeCorpus.model_validate(corpus_payload)
    if ontology.dataset_id != contract.dataset_id:
        raise ProductError("ontology and source contract identities differ")
    _validate_ontology(ontology)
    metrics = _validate_corpus(contract, corpus)
    _write_json(root / "outputs/native-corpus.json", corpus_payload)
    _write_json(root / "outputs/native-ontology.json", ontology_payload)
    _write_json(root / "outputs/source-metrics.json", metrics)
    return metrics
