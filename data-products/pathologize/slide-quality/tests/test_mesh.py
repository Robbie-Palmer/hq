import json
from pathlib import Path

import pytest

from slide_quality_dataset.mesh import MeshError, build_product
from slide_quality_dataset.models import Adapter, ProductSpec

PROJECT_DIR = Path(__file__).resolve().parents[1]
FIXTURES = PROJECT_DIR / "tests/fixtures"


def test_committed_contracts_preserve_source_languages() -> None:
    grandqc = Adapter.model_validate_json(
        (PROJECT_DIR / "adapters/grandqc-mpp20-v1.json").read_text(encoding="utf-8")
    )
    airaqc = Adapter.model_validate_json(
        (PROJECT_DIR / "adapters/airaqc-tcga-v1.json").read_text(encoding="utf-8")
    )
    product = ProductSpec.model_validate_json(
        (PROJECT_DIR / "products/artifact-spatial-development-v1.json").read_text(encoding="utf-8")
    )

    grandqc_mappings = {item.source_label: item for item in grandqc.mappings}
    assert grandqc_mappings["edge_and_air_bubble"].status == "source_merged"
    assert grandqc_mappings["dark_spot_and_foreign_object"].status == "source_merged"
    assert {item.source_label for item in airaqc.mappings} >= {"air_bubble", "penmark"}
    assert product.role_policy["grandqc-test-mpp20-v1"] == "development_repartition"
    assert product.role_policy["airaqc-tcga-public-pilot-v1"] == "external_test"


def test_build_product_retains_lineage_and_reports_enrichment(tmp_path: Path) -> None:
    for relative_path in ("adapters", "ontologies", "products"):
        source = PROJECT_DIR / relative_path
        destination = tmp_path / relative_path
        destination.symlink_to(source, target_is_directory=True)
    (tmp_path / "imports.json").write_text(
        (PROJECT_DIR / "imports.json").read_text(encoding="utf-8"), encoding="utf-8"
    )

    metrics = build_product(
        tmp_path,
        grandqc_index=FIXTURES / "grandqc.jsonl",
        airaqc_corpus=FIXTURES / "airaqc.json",
    )

    assert metrics["record_count"] == 3
    assert metrics["external_test_record_count"] == 1
    records = [
        json.loads(line)
        for line in (tmp_path / "outputs/harmonized/artifact-spatial-v1.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    grandqc = next(
        item for item in records if "air_bubble_or_slide_edge" in item["target_labels_present"]
    )
    airaqc = next(item for item in records if item["source_dataset_id"].startswith("airaqc"))
    assert grandqc["role_mapping_status"] == "overridden_for_development"
    assert "air_bubble_or_slide_edge" in grandqc["target_labels_present"]
    assert airaqc["product_role"] == "external_test"
    assert "air_bubble" in airaqc["target_labels_present"]
    assert "unlabelled" in airaqc["target_labels_present"]
    assert airaqc["mapping_statuses"]["unlabelled_pixels"] == "unmapped"
    reconciliation = json.loads(
        (tmp_path / "outputs/reconciliation.json").read_text(encoding="utf-8")
    )
    assert reconciliation["enrichment"]["records_added_by_airaqc"] == 1
    assert reconciliation["dropped_record_count"] == 0
    assert reconciliation["mapping_definition_counts"]["source_merged"] == 2
    assert any(
        "publisher test-dataset role" in item
        for item in reconciliation["lost_or_unavailable_nuance"]
    )


def test_build_rejects_unmapped_native_label(tmp_path: Path) -> None:
    bad = tmp_path / "bad.jsonl"
    payload = json.loads((FIXTURES / "grandqc.jsonl").read_text(encoding="utf-8").splitlines()[0])
    payload["native_label_pixel_counts"]["new_native_label"] = 1
    bad.write_text(json.dumps(payload) + "\n", encoding="utf-8")

    with pytest.raises(MeshError, match="missing labels"):
        build_product(
            PROJECT_DIR,
            grandqc_index=bad,
            airaqc_corpus=FIXTURES / "airaqc.json",
        )
