import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from pathologize_stain_provenance.models import MigrationMap, ProvenanceContract
from pathologize_stain_provenance.validation import (
    PROJECT_DIR,
    load_contract,
    load_migration,
    verify_metadata,
    write_schemas,
)

CONTRACT_PATH = PROJECT_DIR / "examples/contract-coverage.json"


def _payload() -> dict[str, Any]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _replace(payload: dict[str, Any], path: tuple[str | int, ...], value: Any) -> None:
    current: Any = payload
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = value


def test_coverage_contract_exercises_required_semantics() -> None:
    contract = load_contract(CONTRACT_PATH)

    assert {image.assay.kind for image in contract.images} == {"he", "ihc", "if", "cish", "virtual"}
    assert {relation.kind for relation in contract.relations} == {
        "same_section_restained",
        "serial_sections",
        "registered_pair",
        "independent_specimens",
    }
    assert {annotation.provenance.kind for annotation in contract.annotations} == {
        "manual",
        "assay_derived",
        "model_derived",
    }
    assert {artifact.kind for artifact in contract.derived_artifacts} == {
        "annotation",
        "mask",
        "tile",
        "embedding",
        "registration",
        "transformed_image",
    }
    assert all(artifact.custody == "reference_only" for artifact in contract.source_artifacts)


def test_migration_maps_keep_source_paths_as_references() -> None:
    migrations = sorted((PROJECT_DIR / "migrations").glob("*.json"))
    loaded = [load_migration(path) for path in migrations]

    assert {migration.existing_product for migration in loaded} == {
        "data-products/pathologize/nucleus-analysis",
        "data-products/pathologize/slide-quality",
    }
    for migration in loaded:
        image_mapping = next(
            mapping for mapping in migration.mappings if mapping.source_path.endswith("image_path")
        )
        assert image_mapping.target_path == "source_artifacts[kind=source_image].uri"
        assert "copy" in image_mapping.note.lower()


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("product", "imported_source_product_ids"), [], "must import"),
        (
            ("source_datasets", 0, "source_product_id"),
            "other.source/v1",
            "imports must match",
        ),
        (
            ("source_artifacts", 0, "owner_product_id"),
            "other.source/v1",
            "artifact owner",
        ),
        (("source_artifacts", 0, "custody"), "owned", "reference_only"),
        (("derived_artifacts", 0, "owner_product_id"), "other.product/v1", "current derived"),
        (("derived_artifacts", 0, "parent_artifact_ids"), ["missing:artifact"], "unknown artifact"),
        (
            ("derived_artifacts", 0, "sha256"),
            "1111111111111111111111111111111111111111111111111111111111111111",
            "duplicate parent bytes",
        ),
        (("images", 0, "artifact_id"), "example:artifact:embedding", "images require"),
        (
            ("images", 4, "artifact_id"),
            "fixture:artifact:if",
            "virtual stains require",
        ),
        (
            ("relations", 0, "later_image_id"),
            "fixture:image:if",
            "same-section restaining",
        ),
        (
            ("relations", 1, "second_image_id"),
            "fixture:image:ihc",
            "serial sections",
        ),
        (
            ("relations", 2, "tissue_relation_id"),
            "fixture:relation:independent",
            "must match",
        ),
        (
            ("derived_artifacts", 0, "parent_artifact_ids"),
            ["fixture:artifact:he"],
            "both paired images",
        ),
        (
            ("relations", 3, "second_image_id"),
            "fixture:image:ihc",
            "different known specimen",
        ),
        (
            ("annotations", 1, "provenance", "generating_image_id"),
            "fixture:image:he",
            "must be a source image",
        ),
    ],
)
def test_contract_rejects_invalid_ownership_and_relationships(
    path: tuple[str | int, ...], value: Any, message: str
) -> None:
    payload = _payload()
    _replace(payload, path, value)

    with pytest.raises(ValidationError, match=message):
        ProvenanceContract.model_validate(payload)


def test_contract_rejects_derived_lineage_cycle() -> None:
    payload = _payload()
    payload["derived_artifacts"][0]["parent_artifact_ids"] = ["example:artifact:embedding"]
    payload["derived_artifacts"][6]["parent_artifact_ids"] = ["example:artifact:registration"]

    with pytest.raises(ValidationError, match="acyclic"):
        ProvenanceContract.model_validate(payload)


def test_contract_rejects_incomplete_scanner_and_scale_evidence() -> None:
    scanner = _payload()
    scanner["images"][0]["scanner"]["not_reported_fields"] = []
    with pytest.raises(ValidationError, match="exactly the missing"):
        ProvenanceContract.model_validate(scanner)

    scale = _payload()
    scale["images"][0]["physical_scale"]["micrometres_per_pixel_y"] = None
    with pytest.raises(ValidationError, match="both pixel axes"):
        ProvenanceContract.model_validate(scale)


def test_contract_rejects_duplicate_if_channels_and_image_references() -> None:
    channels = _payload()
    channels["images"][2]["assay"]["channels"][1]["channel_id"] = "fixture:channel:dapi"
    with pytest.raises(ValidationError, match="channel IDs"):
        ProvenanceContract.model_validate(channels)

    sources = _payload()
    sources["images"][4]["assay"]["source_image_ids"] = [
        "fixture:image:if",
        "fixture:image:if",
    ]
    with pytest.raises(ValidationError, match="source image references"):
        ProvenanceContract.model_validate(sources)


def test_contract_ties_virtual_and_annotation_outputs_to_source_artifacts() -> None:
    virtual = _payload()
    virtual["derived_artifacts"][3]["parent_artifact_ids"] = ["fixture:artifact:he"]
    with pytest.raises(ValidationError, match="every source image"):
        ProvenanceContract.model_validate(virtual)

    annotation = _payload()
    annotation["derived_artifacts"][1]["parent_artifact_ids"] = ["fixture:artifact:if"]
    with pytest.raises(ValidationError, match="source images"):
        ProvenanceContract.model_validate(annotation)


def test_source_product_cannot_claim_derived_artifacts() -> None:
    payload = _payload()
    payload["product"] = {
        "product_id": "fixture.multi-assay-source/v1",
        "kind": "source_dataset",
        "third_party_dataset_id": "fixture-multi-assay-v1",
        "imported_source_product_ids": [],
    }

    with pytest.raises(ValidationError, match="cannot declare downstream"):
        ProvenanceContract.model_validate(payload)


def test_access_and_artifact_models_reject_ambiguous_metadata() -> None:
    access = _payload()
    access["source_datasets"][0]["access"]["mode"] = "gated"
    with pytest.raises(ValidationError, match="must require authentication"):
        ProvenanceContract.model_validate(access)

    artifact = _payload()
    artifact["source_artifacts"][0]["sha256"] = None
    artifact["source_artifacts"][0]["publisher_identifier"] = None
    with pytest.raises(ValidationError, match="digest or publisher"):
        ProvenanceContract.model_validate(artifact)


def test_migration_requires_primary_fact_and_rights_evidence() -> None:
    migration = json.loads(
        (PROJECT_DIR / "migrations/nucleus-analysis-v1.json").read_text(encoding="utf-8")
    )
    migration["authoritative_sources"] = [
        {
            "url": "https://example.invalid/facts",
            "supports": ["dataset_fact"],
            "note": "Facts only",
        }
    ]

    with pytest.raises(ValidationError, match="facts and rights"):
        MigrationMap.model_validate(migration)


def test_metadata_verification_is_deterministic_and_offline(tmp_path: Path) -> None:
    summary = verify_metadata()

    assert summary.contract_count == 1
    assert summary.migration_count == 2
    assert set(summary.metadata_sha256) >= {
        "examples/contract-coverage.json",
        "migrations/nucleus-analysis-v1.json",
        "migrations/slide-quality-v1.json",
        "schemas/migration-map.schema.json",
        "schemas/provenance-contract.schema.json",
    }

    copied = tmp_path / "contract"
    copied.mkdir()
    (copied / "schemas").mkdir()
    for path in (PROJECT_DIR / "schemas").glob("*.json"):
        destination = copied / "schemas" / path.name
        destination.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    write_schemas(copied, check=True)


def test_schema_check_detects_drift(tmp_path: Path) -> None:
    (tmp_path / "schemas").mkdir()
    for path in (PROJECT_DIR / "schemas").glob("*.json"):
        (tmp_path / "schemas" / path.name).write_text("{}\n", encoding="utf-8")

    with pytest.raises(ValueError, match="schema drift"):
        write_schemas(tmp_path, check=True)


def test_loading_helpers_reject_non_contract_json(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.json"
    invalid.write_text("{}\n", encoding="utf-8")

    with pytest.raises(ValidationError):
        load_contract(invalid)
    with pytest.raises(ValidationError):
        load_migration(invalid)
