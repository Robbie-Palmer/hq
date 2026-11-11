import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from roi_segmentation_dataset.models import (
    Adapter,
    CoordinateFrame,
    NativeROIRecord,
    ProductSpec,
    StainProvenance,
)
from roi_segmentation_dataset.product import (
    ProductError,
    adapt_records,
    build_product,
    load_records,
)

PROJECT_DIR = Path(__file__).resolve().parents[1]


def _product_root(tmp_path: Path) -> Path:
    for directory in ("adapters", "contracts", "fixtures", "ontologies", "products"):
        (tmp_path / directory).symlink_to(PROJECT_DIR / directory, target_is_directory=True)
    (tmp_path / "imports.json").write_text(
        (PROJECT_DIR / "imports.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    return tmp_path


def _source_record() -> dict[str, object]:
    line = (
        (PROJECT_DIR / "fixtures/camelyon16-native.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
    )
    return json.loads(line)


def _spec() -> ProductSpec:
    return ProductSpec.model_validate_json(
        (PROJECT_DIR / "products/roi-portfolio-v1.json").read_text(encoding="utf-8")
    )


def _adapter() -> Adapter:
    return Adapter.model_validate_json(
        (PROJECT_DIR / "adapters/camelyon16-lesions.json").read_text(encoding="utf-8")
    )


def test_build_publishes_multi_source_metadata_without_image_bytes(tmp_path: Path) -> None:
    root = _product_root(tmp_path)

    metrics = build_product(root)

    assert metrics["record_count"] == 6
    assert metrics["records_by_source"] == {
        "camelyon16-lesion-annotations": 3,
        "paip2019-liver-segmentation": 3,
    }
    assert metrics["organs"] == ["liver", "lymph_node"]
    assert metrics["group_leakage_count"] == 0
    assert metrics["slide_leakage_count"] == 0
    assert metrics["fixture_binding_count"] == 2
    assert metrics["records_by_role"] == {"train": 4, "validation": 1, "test": 1}
    records = load_records(root / "outputs/records.jsonl")
    assert {record.semantic_scope for record in records} == {"roi_selection"}
    assert all(record.image_artifact.uri.startswith("fixture://") for record in records)
    assert all(record.annotation_artifact.uri.startswith("fixture://") for record in records)
    same_group = [record for record in records if record.source_group_id == "synthetic-case-a"]
    assert len({record.product_role for record in same_group}) == 1
    assert not any(path.suffix in {".tif", ".svs", ".png"} for path in root.rglob("*"))
    lineage = json.loads((root / "outputs/lineage.json").read_text(encoding="utf-8"))
    assert "synthetic metadata and geometry only" in lineage["fixture_limitation"]
    manifest = json.loads((root / "outputs/manifest.json").read_text(encoding="utf-8"))
    assert manifest["product_kind"] == "derived_composition"
    assert manifest["binary_outputs"] == []


def test_build_preserves_native_geometry_scale_and_mapping_distinction(tmp_path: Path) -> None:
    root = _product_root(tmp_path)

    build_product(root)
    records = load_records(root / "outputs/records.jsonl")
    viable = next(record for record in records if record.source_region_label == "viable_tumour")

    assert viable.target_roi_role == "viable_lesion_inclusion"
    assert viable.mapping_status == "partial"
    assert viable.coordinate_frame.origin == "level_0_top_left"
    assert viable.coordinate_frame.micrometres_per_pixel_x == 0.5
    assert viable.geometry.rings[0][0].x == 2400
    reconciliation = json.loads((root / "outputs/reconciliation.json").read_text(encoding="utf-8"))
    assert reconciliation["excluded_semantics"] == ["tissue_compartment", "artifact_quality"]
    assert reconciliation["mapping_definition_counts"] == {"partial": 6}


def test_contract_preserves_ihc_pyramid_and_molecular_provenance() -> None:
    payload = _source_record()
    payload["source_record_id"] = "synthetic-ihc-roi"
    payload["stain"] = {"method": "IHC", "source_name": "HER2 IHC", "ihc_marker": "HER2"}
    payload["coordinate_frame"] = {
        "coordinate_system": "slide",
        "origin": "level_0_top_left",
        "axis_order": "xy",
        "unit": "pixel",
        "pyramid_level": 2,
        "level_downsample": 4,
        "micrometres_per_pixel_x": 1.0,
        "micrometres_per_pixel_y": 1.2,
    }
    payload["molecular_status_links"] = [
        {
            "subject_id": "synthetic-case-a",
            "biomarker": "ERBB2",
            "value": "amplified",
            "assay": "FISH",
            "evidence_reference": "fixture://molecular/synthetic-case-a",
        }
    ]
    payload["image_artifact_id"] = "slide:synthetic-ihc"
    payload["image_sha256"] = "a" * 64
    source = NativeROIRecord.model_validate(payload)

    records, dropped = adapt_records([source], _adapter(), _spec())

    assert not dropped
    assert records[0].stain.ihc_marker == "HER2"
    assert records[0].coordinate_frame.pyramid_level == 2
    assert records[0].molecular_status_links[0].biomarker == "ERBB2"
    assert records[0].image_artifact.artifact_id == "slide:synthetic-ihc"
    assert records[0].image_artifact.sha256 == "a" * 64


def test_contract_rejects_incomplete_scale_and_ihc_marker() -> None:
    with pytest.raises(ValueError, match="both micrometres-per-pixel axes"):
        CoordinateFrame(
            coordinate_system="slide",
            origin="level_0_top_left",
            axis_order="xy",
            unit="pixel",
            pyramid_level=0,
            level_downsample=1,
            micrometres_per_pixel_x=0.25,
        )
    with pytest.raises(ValueError, match="must name its marker"):
        StainProvenance(method="IHC", source_name="IHC")


def test_adapter_rejects_non_roi_target_semantics() -> None:
    payload = json.loads(
        (PROJECT_DIR / "adapters/camelyon16-lesions.json").read_text(encoding="utf-8")
    )
    payload["mappings"][0]["target_role"] = "tissue_compartment"

    with pytest.raises(ValidationError):
        Adapter.model_validate(payload)


def test_adapter_rejects_missing_source_label() -> None:
    payload = _source_record()
    payload["source_region_label"] = "new_publisher_label"

    with pytest.raises(ProductError, match="missing label"):
        adapt_records([NativeROIRecord.model_validate(payload)], _adapter(), _spec())


def test_build_rejects_contract_scope_drift(tmp_path: Path) -> None:
    root = _product_root(tmp_path)
    contract = json.loads(
        (PROJECT_DIR / "contracts/roi-segmentation-v1.json").read_text(encoding="utf-8")
    )
    contract["semantic_scope"] = "tissue_compartment"
    (root / "contracts").unlink()
    (root / "contracts").mkdir()
    (root / "contracts/roi-segmentation-v1.json").write_text(json.dumps(contract), encoding="utf-8")

    with pytest.raises(ProductError, match="limited to ROI selection"):
        build_product(root)
