from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from pathologize_evaluation.adapters import load_adapter
from pathologize_evaluation.artifacts import (
    load_model,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_file,
    write_json,
    write_jsonl,
)
from pathologize_evaluation.contracts import (
    AdapterSpec,
    ExperimentManifest,
    FixtureManifest,
    LeakageUnit,
    RegistrySource,
    Split,
)
from pathologize_evaluation.pipeline import import_registry, validate_leakage
from pathologize_evaluation.synthetic import generate_fixtures, read_pnm


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
        "items": [
            {
                "item_id": "opaque-item-1",
                "split": "test",
                "image_uri": "s3://external-registry/opaque-item-1",
                "image_sha256": "b" * 64,
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
    assert imported["items"][0]["image_uri"].startswith("s3://external-registry/")

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

    external["entrypoint"] = "pathologize_evaluation.adapters:DeterministicColorBaseline"
    external_spec = AdapterSpec.model_validate(external)
    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(external_spec)
