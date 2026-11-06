from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from ml_evaluation.contracts import AdapterSpec
from pydantic import ValidationError

from pathologize_benchmark_contracts.adapters import load_adapter
from pathologize_benchmark_contracts.artifacts import (
    load_model,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_file,
    write_json,
    write_jsonl,
)
from pathologize_benchmark_contracts.contracts import (
    ExperimentManifest,
    FixtureManifest,
    LeakageUnit,
    RegistryExport,
    RegistrySource,
    Split,
)
from pathologize_benchmark_contracts.pipeline import import_registry, validate_leakage
from pathologize_benchmark_contracts.synthetic import generate_fixtures, read_pnm


def _tree_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def test_synthetic_generation_is_byte_deterministic(configured_root: Path) -> None:
    first = generate_fixtures(configured_root)
    first_hash = _tree_hash(configured_root / "data/synthetic")
    second = generate_fixtures(configured_root)

    assert first == second
    assert first_hash == _tree_hash(configured_root / "data/synthetic")
    assert first.clinical_validity is False
    assert {item.split for item in first.items} == set(Split)


def test_fixture_masks_and_images_have_declared_dimensions(configured_root: Path) -> None:
    manifest = generate_fixtures(configured_root)
    for item in manifest.items:
        for relative in (
            item.image_path,
            item.tissue_mask_path,
            item.artifact_mask_path,
            item.nucleus_instance_mask_path,
        ):
            width, height, values = read_pnm(configured_root / relative)
            channels = 3 if relative.endswith(".ppm") else 1
            assert (width, height) == (item.width, item.height)
            assert len(values) == width * height * channels


def test_read_pnm_rejects_invalid_content(tmp_path: Path) -> None:
    invalid = tmp_path / "bad.pgm"
    invalid.write_text("P9\n1 1\n1\n0\n", encoding="ascii")
    with pytest.raises(ValueError, match="unsupported"):
        read_pnm(invalid)

    invalid.write_text("P2\n2 2\n0\n1\n", encoding="ascii")
    with pytest.raises(ValueError, match="invalid"):
        read_pnm(invalid)


def test_leakage_validation_rejects_cross_split_group(configured_root: Path) -> None:
    manifest = generate_fixtures(configured_root)
    original = manifest.items[0]
    leaked = manifest.items[-1].model_copy(
        update={"split": Split.TEST, "leakage": original.leakage}
    )
    with pytest.raises(ValueError, match="subject_id"):
        validate_leakage([original, leaked], [LeakageUnit.SUBJECT])


def test_experiment_contract_rejects_unsafe_or_unpinned_changes(
    configured_root: Path,
) -> None:
    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["super_resolution"]["enabled"] = True
    with pytest.raises(ValidationError, match="enabled"):
        ExperimentManifest.model_validate(value)

    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["split_policy"]["leakage_units"].remove("slide_id")
    with pytest.raises(ValidationError, match="subject, specimen, block, and slide"):
        ExperimentManifest.model_validate(value)

    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["candidate"] = value["baseline"]
    with pytest.raises(ValidationError, match="candidate adapter"):
        ExperimentManifest.model_validate(value)

    adapter = value["baseline"] | {
        "kind": "python_entrypoint",
        "artifact_sha256": None,
    }
    with pytest.raises(ValidationError, match="artifact SHA-256"):
        AdapterSpec.model_validate(adapter)


def test_registry_import_pins_revision_and_digest(configured_root: Path) -> None:
    generate_fixtures(configured_root)
    export_path = configured_root / "registry-export.json"
    export = {
        "contract": "pathologize.data-registry-export/v1",
        "registry_revision": "a" * 40,
        "dataset": {
            "conforms_to": "http://mlcommons.org/croissant/1.1",
            "metadata_uri": "s3://external-registry/croissant.json",
            "metadata_sha256": "b" * 64,
        },
        "provenance": {
            "ro_crate_conforms_to": "https://w3id.org/ro/crate/1.3",
            "ro_crate_metadata_uri": "s3://external-registry/ro-crate-metadata.json",
            "ro_crate_metadata_sha256": "c" * 64,
            "prov_o_conforms_to": "https://www.w3.org/TR/prov-o/",
            "prov_o_graph_uri": "s3://external-registry/provenance.jsonld",
            "prov_o_graph_sha256": "d" * 64,
        },
        "items": [
            {
                "item_id": "opaque-item-1",
                "split": "test",
                "croissant_record_set_id": "slides",
                "croissant_record_id": "opaque-item-1",
                "width": 100,
                "height": 80,
                "microns_per_pixel_x": 0.5,
                "microns_per_pixel_y": 0.5,
                "leakage": {
                    "subject_id": "opaque-subject",
                    "specimen_id": "opaque-specimen",
                    "block_id": "opaque-block",
                    "slide_id": "opaque-slide",
                    "acquisition_id": "opaque-acquisition",
                    "site_id": "opaque-site",
                },
                "representations": [
                    {
                        "representation_id": "source-dicom",
                        "role": "source",
                        "format": "dicom_wsi",
                        "croissant_distribution_id": "dicom-wsi-files",
                        "conforms_to": "https://dicom.nema.org/medical/dicom/2026c/output/chtml/part03/sect_A.32.8.html",
                        "dicom_sop_class_uid": "1.2.840.10008.5.1.4.1.1.77.1.6",
                        "derived_from": [],
                    },
                    {
                        "representation_id": "compute-ome-zarr",
                        "role": "compute_derivative",
                        "format": "ome_zarr",
                        "croissant_distribution_id": "ome-zarr-files",
                        "conforms_to": "https://ngff.openmicroscopy.org/specifications/0.6/",
                        "derived_from": ["source-dicom"],
                    },
                ],
                "annotations": [],
            }
        ],
    }
    write_json(export_path, export)
    experiment_path = configured_root / "experiments/whole-slide-quality.json"
    experiment = read_json(experiment_path)
    experiment["data_source"] = {
        "kind": "pathologize_registry",
        "contract": "pathologize.data-registry-export/v1",
        "registry_uri": "https://example.invalid/pathologize-registry",
        "revision": "a" * 40,
        "export_manifest": "registry-export.json",
        "export_sha256": sha256_file(export_path),
        "copy_raw_data": False,
    }
    write_json(experiment_path, experiment)

    import_registry("whole-slide-quality-contract-v1", configured_root)
    imported = read_json(
        configured_root / "data/imported/whole-slide-quality-contract-v1/registry-index.json"
    )
    assert imported["raw_data_copied"] is False
    assert imported["registry_revision"] == "a" * 40
    assert imported["dataset"]["conforms_to"] == "http://mlcommons.org/croissant/1.1"
    assert imported["items"][0]["representations"][0]["format"] == "dicom_wsi"
    assert imported["items"][0]["representations"][1]["format"] == "ome_zarr"

    export["registry_revision"] = "c" * 40
    write_json(export_path, export)
    with pytest.raises(ValueError, match="SHA-256"):
        import_registry("whole-slide-quality-contract-v1", configured_root)


def test_registry_source_and_artifact_paths_are_strict(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="copy_raw_data"):
        RegistrySource.model_validate(
            {
                "kind": "pathologize_registry",
                "contract": "pathologize.data-registry-export/v1",
                "registry_uri": "https://example.invalid/registry",
                "revision": "a" * 40,
                "export_manifest": "export.json",
                "export_sha256": "b" * 64,
                "copy_raw_data": True,
            }
        )
    root = tmp_path / "root"
    root.mkdir()
    assert resolve_under(root, "inside.json") == root / "inside.json"
    with pytest.raises(ValueError, match="escapes"):
        resolve_under(root, "../outside.json")
    with pytest.raises(ValueError, match="relative"):
        resolve_under(root, tmp_path / "absolute.json")


def test_registry_representations_enforce_standard_lifecycle_positions() -> None:
    base = {
        "contract": "pathologize.data-registry-export/v1",
        "registry_revision": "a" * 40,
        "dataset": {
            "conforms_to": "http://mlcommons.org/croissant/1.1",
            "metadata_uri": "s3://registry/croissant.json",
            "metadata_sha256": "b" * 64,
        },
        "provenance": {
            "ro_crate_conforms_to": "https://w3id.org/ro/crate/1.3",
            "ro_crate_metadata_uri": "s3://registry/ro-crate-metadata.json",
            "ro_crate_metadata_sha256": "c" * 64,
            "prov_o_conforms_to": "https://www.w3.org/TR/prov-o/",
            "prov_o_graph_uri": "s3://registry/provenance.jsonld",
            "prov_o_graph_sha256": "d" * 64,
        },
        "items": [
            {
                "item_id": "item-1",
                "split": "test",
                "croissant_record_set_id": "slides",
                "croissant_record_id": "item-1",
                "width": 100,
                "height": 80,
                "microns_per_pixel_x": 0.5,
                "microns_per_pixel_y": 0.5,
                "leakage": {
                    "subject_id": "subject-1",
                    "specimen_id": "specimen-1",
                    "block_id": "block-1",
                    "slide_id": "slide-1",
                    "acquisition_id": "acquisition-1",
                    "site_id": "site-1",
                },
                "representations": [
                    {
                        "representation_id": "source-1",
                        "role": "source",
                        "format": "vendor_native_wsi",
                        "croissant_distribution_id": "source-files",
                        "conforms_to": None,
                        "dicom_sop_class_uid": None,
                        "derived_from": [],
                    },
                    {
                        "representation_id": "compute-1",
                        "role": "compute_derivative",
                        "format": "ome_zarr",
                        "croissant_distribution_id": "compute-files",
                        "conforms_to": "https://ngff.openmicroscopy.org/specifications/0.6/",
                        "derived_from": ["source-1"],
                    },
                ],
                "annotations": [],
            }
        ],
    }
    assert RegistryExport.model_validate(base).items[0].representations[1].derived_from == [
        "source-1"
    ]

    unsafe = base.copy()
    unsafe["items"] = [base["items"][0].copy()]
    unsafe["items"][0]["representations"] = [
        item.copy() for item in base["items"][0]["representations"]
    ]
    unsafe["items"][0]["representations"][1]["derived_from"] = []
    with pytest.raises(ValidationError):
        RegistryExport.model_validate(unsafe)


def test_registry_json_schema_encodes_representation_profiles() -> None:
    schema = RegistryExport.model_json_schema()
    definitions = schema["$defs"]
    representation_schema = definitions["RegistryItem"]["properties"]["representations"]["items"]
    assert {entry["$ref"] for entry in representation_schema["anyOf"]} == {
        "#/$defs/VendorNativeWsiRepresentation",
        "#/$defs/DicomWsiSourceRepresentation",
        "#/$defs/DicomWsiInterchangeRepresentation",
        "#/$defs/OmeZarrRepresentation",
    }
    assert (
        definitions["DicomWsiSourceRepresentation"]["properties"]["dicom_sop_class_uid"]["const"]
        == "1.2.840.10008.5.1.4.1.1.77.1.6"
    )
    assert definitions["OmeZarrRepresentation"]["properties"]["derived_from"]["minItems"] == 1


def test_paid_inference_policy_is_not_part_of_benchmark_contracts(
    configured_root: Path,
) -> None:
    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["baseline"]["paid_api_calls_allowed"] = False
    with pytest.raises(ValidationError, match="paid_api_calls_allowed"):
        ExperimentManifest.model_validate(value)

    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["resource_budget"]["max_paid_api_calls"] = 0
    with pytest.raises(ValidationError, match="max_paid_api_calls"):
        ExperimentManifest.model_validate(value)


def test_jsonl_and_model_helpers_round_trip(tmp_path: Path, configured_root: Path) -> None:
    path = tmp_path / "records.jsonl"
    size = write_jsonl(path, [{"b": 2, "a": 1}, {"a": 3}])
    assert size == path.stat().st_size
    assert read_jsonl(path) == [{"a": 1, "b": 2}, {"a": 3}]

    generate_fixtures(configured_root)
    manifest = load_model(configured_root / "data/synthetic/manifest.json", FixtureManifest)
    assert manifest.dataset_id == "pathologize-synthetic-contract-fixtures-v1"


def test_adapter_loader_rejects_bad_entrypoints_and_ids(configured_root: Path) -> None:
    baseline = read_json(configured_root / "experiments/whole-slide-quality.json")["baseline"]
    adapter = load_adapter(AdapterSpec.model_validate(baseline))
    assert adapter.adapter_id == "deterministic-color-v1"

    external = baseline | {
        "adapter_id": "external-adapter-v1",
        "kind": "python_entrypoint",
        "entrypoint": "builtins:dict",
        "artifact_sha256": "a" * 64,
    }
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(TypeError, match="does not implement"):
        load_adapter(external_spec)

    external["entrypoint"] = "builtins.dict"
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(ValueError, match="module:attribute"):
        load_adapter(external_spec)

    external["entrypoint"] = "pathologize_benchmark_contracts.adapters:DeterministicColorBaseline"
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(external_spec)
