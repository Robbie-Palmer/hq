import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from tissue_segmentation_dataset.models import Adapter, AnnotationProvenance, AssayProvenance
from tissue_segmentation_dataset.product import ProductError, build_product

PROJECT_DIR = Path(__file__).resolve().parents[1]
FIXTURES = PROJECT_DIR / "tests/fixtures"


def _root(tmp_path: Path) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    for directory in ("adapters", "ontologies", "products"):
        (tmp_path / directory).symlink_to(PROJECT_DIR / directory, target_is_directory=True)
    (tmp_path / "imports.json").write_text(
        (PROJECT_DIR / "imports.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return tmp_path


def _source_paths(segpath: Path | None = None, bcss: Path | None = None) -> dict[str, Path]:
    return {
        "bcss-amgad-2019": bcss or FIXTURES / "bcss.jsonl",
        "segpath-2022-registered-if-masks": segpath or FIXTURES / "segpath.jsonl",
        "crc-ihc-cish-he-epithelium-v1": FIXTURES / "crc-epithelium.jsonl",
    }


def test_committed_contracts_keep_source_semantics_separate() -> None:
    adapters = {
        path.stem: Adapter.model_validate_json(path.read_text(encoding="utf-8"))
        for path in (PROJECT_DIR / "adapters").glob("*.json")
    }
    bcss = adapters["bcss-amgad-2019"]
    segpath = adapters["segpath-public-v1"]
    crc = adapters["crc-ihc-cish-he-epithelium-v1"]

    bcss_mappings = {item.source_label: item for item in bcss.mappings}
    assert bcss_mappings["outside_roi"].target_labels == ["ignore"]
    assert bcss_mappings["necrosis_or_debris"].status == "source_merged"
    assert segpath.coverage_semantics == "positive_binary_only"
    assert segpath.expected_annotation_techniques == ["IF"]
    assert crc.expected_image_techniques == ["H&E", "IHC", "CISH"]
    assert "Normal mucosa and cancer" in " ".join(crc.limitations)

    imports = json.loads((PROJECT_DIR / "imports.json").read_text(encoding="utf-8"))
    assert {item["status"] for item in imports["imports"]} == {"pending_source_product"}
    assert all(item["expected_dvc_lock"].endswith("dvc.lock") for item in imports["imports"])
    assert all("checksums" in item["evidence"] for item in imports["imports"])
    assert all("source_ticket" not in item for item in imports["imports"])


def test_build_product_publishes_references_partitions_and_reports(tmp_path: Path) -> None:
    root = _root(tmp_path)

    metrics = build_product(root, source_paths=_source_paths())

    assert metrics["record_count"] == 7
    assert metrics["fixture_record_count"] == 7
    assert metrics["owned_binary_output_count"] == 0
    assert metrics["group_leakage_count"] == 0
    assert metrics["organs"] == [
        "breast",
        "colorectal cancer",
        "colorectum",
        "gastric cancer",
        "lung cancer",
    ]
    assert metrics["image_assay_techniques"] == ["H&E", "IHC"]
    assert metrics["annotation_evidence_techniques"] == ["IF"]

    records = [
        json.loads(line)
        for line in (root / "outputs/records.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    assert all(record["fixture_record"] for record in records)
    assert all(record["segmentation_scope"] == "semantic_regions" for record in records)
    assert all(record["image_artifact"]["artifact_ref"] for record in records)
    assert all("source_image" not in record for record in records)

    segpath = next(
        record for record in records if record["source_dataset_id"].startswith("segpath")
    )
    assert segpath["image_assay"]["technique"] == "H&E"
    assert segpath["annotation_provenance"]["evidence_assay"]["technique"] == "IF"
    assert segpath["coverage_semantics"] == "positive_binary_only"
    assert segpath["image_artifact"]["artifact_ref"].startswith("segpath://")
    assert segpath["image_artifact"]["checksum"] is None
    validation_record = next(
        record
        for record in records
        if record["source_dataset_id"].startswith("segpath") and record["source_role"] == "val"
    )
    assert validation_record["product_role"] == "validation"

    crc = [record for record in records if record["source_dataset_id"].startswith("crc-")]
    assert {record["image_assay"]["technique"] for record in crc} == {"H&E", "IHC"}
    assert {record["image_artifact"]["media_type"] for record in crc} == {"image/jpeg"}
    assert len({record["product_role"] for record in crc}) == 1
    assert {record["source_tissue_role"] for record in crc} == {"colorectal_cancer"}

    reconciliation = json.loads((root / "outputs/reconciliation.json").read_text(encoding="utf-8"))
    assert reconciliation["production_ready"] is False
    assert "product contains synthetic contract records" in reconciliation["production_blockers"]
    assert reconciliation["dropped_record_count"] == 0
    assert reconciliation["reannotated_record_count"] == 0
    assert reconciliation["source_role_override_count"] == 0
    assert reconciliation["derived_role_assignment_count"] == 4
    assert reconciliation["collapsed_concept_count"] > 0

    lineage = json.loads((root / "outputs/lineage.json").read_text(encoding="utf-8"))
    assert lineage["owned_binary_outputs"] == []
    assert lineage["binary_transformations"] == []
    assert lineage["source_artifact_reference_fields"] == ["image_artifact", "mask_artifact"]


def test_build_is_deterministic(tmp_path: Path) -> None:
    first = _root(tmp_path / "first")
    second = _root(tmp_path / "second")

    build_product(first, source_paths=_source_paths())
    build_product(second, source_paths=_source_paths())

    for name in (
        "records.jsonl",
        "partitions.json",
        "metrics.json",
        "reconciliation.json",
        "assay-provenance.json",
        "lineage.json",
    ):
        assert (first / "outputs" / name).read_bytes() == (second / "outputs" / name).read_bytes()


def test_product_rejects_publisher_role_group_leakage(tmp_path: Path) -> None:
    lines = (FIXTURES / "segpath.jsonl").read_text(encoding="utf-8").splitlines()
    duplicate = json.loads(lines[0])
    duplicate["record_id"] = "same-slide-test-patch"
    duplicate["source_role"] = "test"
    conflicting = tmp_path / "segpath.jsonl"
    conflicting.write_text("\n".join([*lines, json.dumps(duplicate)]) + "\n", encoding="utf-8")

    with pytest.raises(ProductError, match="source groups cross product roles"):
        build_product(_root(tmp_path / "root"), source_paths=_source_paths(segpath=conflicting))


def test_product_rejects_unmapped_source_label(tmp_path: Path) -> None:
    lines = (FIXTURES / "bcss.jsonl").read_text(encoding="utf-8").splitlines()
    record = json.loads(lines[0])
    record["native_labels_present"] = ["invented_label"]
    invalid = tmp_path / "bcss.jsonl"
    invalid.write_text(json.dumps(record) + "\n", encoding="utf-8")

    with pytest.raises(ProductError, match="missing source labels"):
        build_product(_root(tmp_path / "root"), source_paths=_source_paths(bcss=invalid))


def test_product_rejects_duplicate_source_record_id(tmp_path: Path) -> None:
    lines = (FIXTURES / "segpath.jsonl").read_text(encoding="utf-8").splitlines()
    duplicate = tmp_path / "segpath.jsonl"
    duplicate.write_text("\n".join([lines[0], lines[0]]) + "\n", encoding="utf-8")

    with pytest.raises(ProductError, match="duplicate derived record IDs"):
        build_product(_root(tmp_path / "root"), source_paths=_source_paths(segpath=duplicate))


def test_explicit_empty_source_paths_do_not_fall_back_to_fixtures(tmp_path: Path) -> None:
    with pytest.raises(ProductError, match="cover every configured source exactly once"):
        build_product(_root(tmp_path), source_paths={})


def test_pinned_import_status_does_not_make_fixtures_production_ready(tmp_path: Path) -> None:
    root = _root(tmp_path)
    imports = json.loads((root / "imports.json").read_text(encoding="utf-8"))
    for item in imports["imports"]:
        item["status"] = "pinned_source_product"
    (root / "imports.json").write_text(json.dumps(imports), encoding="utf-8")

    build_product(root, source_paths=_source_paths())

    reconciliation = json.loads((root / "outputs/reconciliation.json").read_text())
    assert reconciliation["production_ready"] is False
    assert "product contains synthetic contract records" in reconciliation["production_blockers"]


def test_assay_provenance_rejects_missing_targets_and_registration() -> None:
    with pytest.raises(ValidationError, match="requires a target"):
        AssayProvenance(technique="IHC", targets=[], source_description="invalid")

    with pytest.raises(ValidationError, match="require registration provenance"):
        AnnotationProvenance(
            method="immunofluorescence_restain",
            evidence_assay=AssayProvenance(
                technique="IF", targets=["panCK"], source_description="IF restain"
            ),
            registered_to_image=False,
            registration_method=None,
        )
