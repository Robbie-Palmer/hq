from pathlib import Path

from pydantic import BaseModel

from pathologize_data_registry.croissant import (
    CROISSANT_CONFORMS_TO,
    EXPORT_CONTRACT,
    CroissantExport,
    build_croissant_export,
    croissant_json,
    validate_croissant,
)
from pathologize_data_registry.repository import load_registry

PROJECT_DIR = Path(__file__).resolve().parents[1]


def test_croissant_export_maps_source_registry_without_downstream_policy() -> None:
    registry = load_registry(PROJECT_DIR)
    revision = "a" * 40

    assert isinstance(registry, BaseModel)
    payload = build_croissant_export(registry, revision)

    assert isinstance(payload, CroissantExport)
    assert payload.conforms_to == CROISSANT_CONFORMS_TO
    assert payload.contract == EXPORT_CONTRACT
    assert payload.registry_revision == revision
    assert "split" not in croissant_json(payload)
    assert "leakage" not in croissant_json(payload)
    expected_assets = sum(len(manifest.assets) for manifest in registry.asset_manifests.values())
    assert len(payload.distribution) == expected_assets
    assert {item.encoding_format for item in payload.distribution} == {
        "application/dicom",
        "image/png",
        "image/tiff",
    }
    assert all(isinstance(item, BaseModel) for item in payload.distribution)
    record_sets = {item.identifier: item for item in payload.record_sets}
    assert set(record_sets) == {
        "assets",
        "collection_documents",
        "collection_label_domains",
        "collections",
        "slides",
        "source_native_labels",
    }
    assert all(
        isinstance(field, BaseModel)
        for record_set in payload.record_sets
        for field in record_set.fields
    )
    slide = next(
        item for item in record_sets["slides"].data if item["slides/patient_id"] == "09CO003"
    )
    assert slide["slides/patient_id"] == "09CO003"
    assert slide["slides/scanner_manufacturer"] == "Leica Biosystems"
    assert slide["slides/micrometres_per_pixel_x"] == 0.2501
    label = next(
        item
        for item in record_sets["source_native_labels"].data
        if item["source_native_labels/name"] == "primary_anatomic_structure"
    )
    assert label["source_native_labels/code"] == "71854001"
    assert label["source_native_labels/coding_scheme"] == "SCT"
    assert label["source_native_labels/coding_scheme_version"] is None


def test_generated_croissant_export_passes_independent_validator() -> None:
    payload = build_croissant_export(load_registry(PROJECT_DIR), "b" * 40)

    validate_croissant(payload)


def test_croissant_export_is_deterministic() -> None:
    registry = load_registry(PROJECT_DIR)

    first = croissant_json(build_croissant_export(registry, "c" * 40))
    second = croissant_json(build_croissant_export(registry, "c" * 40))

    assert first == second
