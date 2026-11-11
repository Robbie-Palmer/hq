from pathlib import Path

import pytest

from pathologize_data_products import (
    MigrationError,
    existing_product_migration_plans,
    migrate_existing_sources,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_existing_source_migrations_preserve_native_ownership() -> None:
    products = migrate_existing_sources(REPOSITORY_ROOT)

    assert {product.identity.product for product in products} == {
        "airaqc/tcga-public-pilot",
        "grandqc/mpp20",
        "nucls/corrected-single-rater",
    }
    assert sum(len(product.original_artifacts) for product in products) == 52
    grandqc = next(product for product in products if product.identity.product == "grandqc/mpp20")
    assert grandqc.native_ontology.concepts[5].label == "edge_and_air_bubble"
    airaqc = next(
        product for product in products if product.identity.product == "airaqc/tcga-public-pilot"
    )
    assert all(reference.coordinate_frame is not None for reference in airaqc.original_artifacts)
    assert all(reference.physical_scale is not None for reference in airaqc.original_artifacts)


def test_existing_product_migrations_are_bounded_and_reference_only() -> None:
    plans = existing_product_migration_plans(REPOSITORY_ROOT)

    assert len(plans) == 5
    assert all(plan.source_byte_policy == "reference_only" for plan in plans)
    assert {plan.product.product for plan in plans} == {
        "airaqc/tcga-public-pilot",
        "grandqc/mpp20",
        "nucls/corrected-single-rater",
        "pathologize/nucleus-analysis",
        "pathologize/slide-quality",
    }
    assert all(plan.preserved_paths for plan in plans)


def test_migration_plan_requires_the_expected_existing_products(tmp_path: Path) -> None:
    with pytest.raises(MigrationError, match="contracts are missing"):
        existing_product_migration_plans(tmp_path)
