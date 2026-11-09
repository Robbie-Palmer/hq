import json
from pathlib import Path

import pytest

from nucleus_analysis_dataset.models import ProductSpec
from nucleus_analysis_dataset.product import ProductError, build_product, load_ontology_labels

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _native_record(
    item: str, slide: str, patient: str, site: str, roles: dict[str, str]
) -> dict[str, object]:
    return {
        "schema_version": "1.0.0",
        "dataset_id": "nucls-corrected-single-rater-20220301",
        "item_id": item,
        "slide_id": slide,
        "patient_id": patient,
        "site_id": site,
        "image_path": f"data/native/rgb/{item}.png",
        "annotation_path": f"data/native/annotations/{item}.csv",
        "source_roles": roles,
        "source_labels_present": ["sTIL"],
        "annotation_count": 1,
    }


def _product_root(tmp_path: Path) -> Path:
    tmp_path.mkdir(parents=True)
    for directory in ("adapters", "ontologies", "products"):
        (tmp_path / directory).symlink_to(PROJECT_DIR / directory, target_is_directory=True)
    (tmp_path / "imports.json").write_text(
        (PROJECT_DIR / "imports.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return tmp_path


def test_build_product_preserves_lineage_and_frozen_roles(tmp_path: Path) -> None:
    records = [
        _native_record(
            "train", "TCGA-AA-0001-DX1", "TCGA-AA-0001", "AA", {"1": "train", "2": "train"}
        ),
        _native_record(
            "validation",
            "TCGA-BB-0002-DX1",
            "TCGA-BB-0002",
            "BB",
            {"1": "train", "2": "test"},
        ),
        _native_record(
            "test", "TCGA-CC-0003-DX1", "TCGA-CC-0003", "CC", {"1": "test", "2": "train"}
        ),
    ]
    native = tmp_path / "native.jsonl"
    native.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
    root = _product_root(tmp_path / "product")

    metrics = build_product(root, native_index=native)

    assert metrics["records_by_role"] == {"test": 1, "train": 1, "validation": 1}
    assert metrics["patient_leakage_count"] == 0
    cohort = json.loads((root / "outputs/cohort.json").read_text(encoding="utf-8"))
    assert {record["split"] for record in cohort["items"]} == {"train", "validation", "test"}
    assert cohort["items"][0]["source_roles"]
    reconciliation = json.loads((root / "outputs/reconciliation.json").read_text(encoding="utf-8"))
    assert reconciliation["dropped_record_count"] == 0
    assert load_ontology_labels() == [
        "nonTIL_stromal",
        "sTIL",
        "tumor_any",
        "AMBIGUOUS",
        "other_nucleus",
    ]


def test_product_rejects_group_leakage(tmp_path: Path) -> None:
    records = [
        _native_record(
            "train", "TCGA-AA-0001-DX1", "TCGA-AA-0001", "AA", {"1": "train", "2": "train"}
        ),
        _native_record(
            "test", "TCGA-AA-0002-DX1", "TCGA-AA-0001", "CC", {"1": "test", "2": "train"}
        ),
    ]
    native = tmp_path / "native.jsonl"
    native.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")

    with pytest.raises(ProductError, match="leaks patients"):
        build_product(_product_root(tmp_path / "product"), native_index=native)


def test_product_contract_rejects_same_fold() -> None:
    payload = json.loads((PROJECT_DIR / "products/nucls-public.json").read_text(encoding="utf-8"))
    payload["validation_fold"] = payload["test_fold"]

    with pytest.raises(ValueError, match="validation and test folds must differ"):
        ProductSpec.model_validate(payload)
