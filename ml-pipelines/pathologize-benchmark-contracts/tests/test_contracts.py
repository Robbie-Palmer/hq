from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from data_artifacts.files import (
    load_model,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_file,
    write_json,
    write_jsonl,
)
from ml_evaluation.contracts import AdapterSpec
from pydantic import ValidationError

from pathologize_benchmark_contracts.adapters import load_adapter
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


def test_minimum_fixture_geometry_stays_inside_tissue_and_outside_artifacts(
    tmp_path: Path,
) -> None:
    write_json(
        tmp_path / "fixtures/spec.json",
        {
            "schema_version": "1.0.0",
            "seed": 1,
            "width": 32,
            "height": 32,
            "cases": [
                {"case_id": "synthetic-train-fold", "split": "train", "variant": "fold_like"},
                {
                    "case_id": "synthetic-validation-mark",
                    "split": "validation",
                    "variant": "mark_like",
                },
                {"case_id": "synthetic-test-clean", "split": "test", "variant": "clean"},
                {
                    "case_id": "synthetic-test-fold",
                    "split": "test",
                    "variant": "fold_like",
                },
                {
                    "case_id": "synthetic-test-mark",
                    "split": "test",
                    "variant": "mark_like",
                },
            ],
        },
    )
    manifest = generate_fixtures(tmp_path)

    for item in manifest.items:
        _, _, tissue = read_pnm(tmp_path / item.tissue_mask_path)
        _, _, artifact = read_pnm(tmp_path / item.artifact_mask_path)
        _, _, instances = read_pnm(tmp_path / item.nucleus_instance_mask_path)
        nucleus_pixels = [index for index, instance in enumerate(instances) if instance]
        assert {instances[index] for index in nucleus_pixels} == {1, 2, 3}
        assert all(instances.count(instance_id) == 29 for instance_id in (1, 2, 3))
        assert all(tissue[index] == 1 for index in nucleus_pixels)
        assert all(artifact[index] == 0 for index in nucleus_pixels)


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
    with pytest.raises(ValidationError, match="subject, specimen, block, slide"):
        ExperimentManifest.model_validate(value)

    value = read_json(configured_root / "experiments/whole-slide-quality.json")
    value["candidate"] = value["baseline"]
    with pytest.raises(ValidationError, match="candidate adapter"):
        ExperimentManifest.model_validate(value)

    adapter = value["baseline"] | {
        "kind": "python_entrypoint",
        "artifact_path": None,
        "artifact_sha256": None,
    }
    with pytest.raises(ValidationError, match="artifact path and SHA-256"):
        AdapterSpec.model_validate(adapter)


@pytest.mark.parametrize(
    ("parameter", "value", "message"),
    [
        ("tile_size", True, "tile_size"),
        ("minimum_tissue_fraction", False, "minimum_tissue_fraction"),
        ("target_microns_per_pixel", True, "target_microns_per_pixel"),
        ("target_microns_per_pixel", float("inf"), "target_microns_per_pixel"),
    ],
)
def test_tiling_parameters_reject_booleans_and_non_finite_values(
    parameter: str, value: int | float | bool, message: str
) -> None:
    experiment_path = (
        Path(__file__).parents[2]
        / "pathologize-tiling-benchmark/experiments/tiling-magnification.json"
    )
    experiment = read_json(experiment_path)
    experiment["parameters"][parameter] = value

    with pytest.raises(ValidationError, match=message):
        ExperimentManifest.model_validate(experiment)


def test_registry_import_pins_revision_and_digest(configured_root: Path) -> None:
    generate_fixtures(configured_root)
    export_path = configured_root / "registry-export.json"
    export = {
        "@context": {
            "@vocab": "https://schema.org/",
            "sc": "https://schema.org/",
            "dct": "http://purl.org/dc/terms/",
            "pathologize": "https://robbiepalmer.me/ns/pathologize#",
        },
        "@type": "sc:Dataset",
        "name": "External source registry",
        "description": "Source-only metadata.",
        "conformsTo": "http://mlcommons.org/croissant/1.1",
        "pathologize:contract": "pathologize.data-registry-export/v1",
        "pathologize:registryRevision": "a" * 40,
        "distribution": [],
        "recordSet": [],
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
    assert imported["croissant_conforms_to"] == "http://mlcommons.org/croissant/1.1"
    assert imported["dataset_name"] == "External source registry"

    export["pathologize:registryRevision"] = "c" * 40
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


def test_registry_export_rejects_downstream_policy_fields() -> None:
    base = {
        "@context": {
            "sc": "https://schema.org/",
            "dct": "http://purl.org/dc/terms/",
            "pathologize": "https://robbiepalmer.me/ns/pathologize#",
        },
        "@type": "sc:Dataset",
        "name": "Source registry",
        "conformsTo": "http://mlcommons.org/croissant/1.1",
        "pathologize:contract": "pathologize.data-registry-export/v1",
        "pathologize:registryRevision": "a" * 40,
        "recordSet": [],
    }
    assert RegistryExport.model_validate(base).registry_revision == "a" * 40

    unsafe = base | {"items": [{"split": "test", "leakage": {}}]}
    with pytest.raises(ValidationError, match="source metadata only"):
        RegistryExport.model_validate(unsafe)


def test_registry_json_schema_encodes_croissant_header() -> None:
    schema = RegistryExport.model_json_schema()
    assert schema["properties"]["conformsTo"]["const"] == ("http://mlcommons.org/croissant/1.1")
    assert schema["properties"]["pathologize:contract"]["const"] == (
        "pathologize.data-registry-export/v1"
    )


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


def test_adapter_loader_rejects_bad_entrypoints_and_ids(
    configured_root: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = read_json(configured_root / "experiments/whole-slide-quality.json")["baseline"]
    adapter = load_adapter(AdapterSpec.model_validate(baseline), configured_root)
    assert adapter.adapter_id == "deterministic-color-v1"

    module_path = tmp_path / "external_pathologize_adapter.py"
    module_path.write_text(
        "class WrongAdapter:\n"
        "    adapter_id = 'external-adapter-v1'\n\n"
        "class WrongIdentity:\n"
        "    adapter_id = 'other-v1'\n"
        "    adapter_version = '1.0.0'\n"
        "    def predict(self, manifest, item, root):\n"
        "        return None\n",
        encoding="utf-8",
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    external = baseline | {
        "adapter_id": "external-adapter-v1",
        "kind": "python_entrypoint",
        "entrypoint": "invalid",
        "artifact_path": module_path.name,
        "artifact_sha256": sha256_file(module_path),
    }
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(ValueError, match="module:attribute"):
        load_adapter(external_spec, tmp_path)

    external["entrypoint"] = "external_pathologize_adapter:WrongIdentity"
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(external_spec, tmp_path)
