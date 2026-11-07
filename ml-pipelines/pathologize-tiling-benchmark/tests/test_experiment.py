from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from pathologize_tiling_benchmark.contracts import ExperimentResult, ExperimentSpec
from pathologize_tiling_benchmark.experiment import (
    RESULT_PATH,
    VERIFICATION_PATH,
    prepare_inputs,
    run_experiment,
    verify_experiment,
)

PROJECT_ROOT = Path(__file__).parents[1]
REPOSITORY_ROOT = PROJECT_ROOT.parents[1]


@pytest.fixture(scope="module")
def experiment_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("mpp-experiment")
    experiments = root / "experiments"
    experiments.mkdir()
    spec_path = experiments / "mpp-perturbation.json"
    value = json.loads(
        (PROJECT_ROOT / "experiments/mpp-perturbation.json").read_text(encoding="utf-8")
    )
    value["registry_source"]["registry_root"] = str(
        REPOSITORY_ROOT / "ml-pipelines/pathologize-data-registry"
    )
    spec_path.write_text(json.dumps(value), encoding="utf-8")
    return root


def test_public_data_experiment_reads_real_tiles_and_rejects_echo(
    experiment_root: Path,
) -> None:
    prepared = prepare_inputs(experiment_root)
    result = run_experiment(experiment_root)

    assert prepared["source_slide_id"] == "cptac-coad-idc:09co003:0b1ee2c0"
    assert result.status == "passed"
    assert result.echo_control_rejected
    assert result.provenance.openslide_vendor == "dicom"
    assert result.provenance.total_asset_bytes == 18_701_962
    assert result.provenance.observed_mpp == (0.2501, 0.2501)
    primary, control = result.adapters
    assert primary.adapter_id == "pathologize-tiler-v1"
    assert primary.passed
    assert control.adapter_id == "requested-scale-echo-v1"
    assert not control.passed
    assert all(check.passed for check in primary.monotonicity)
    assert any(not check.passed for check in control.monotonicity)
    assert {case.category for case in primary.cases} == {
        "isotropic_pixels",
        "anisotropic_pixels",
        "absent_mpp",
        "implausible_mpp",
        "wrong_pyramid_level",
        "corrupted_metadata",
    }
    completed = [case for case in primary.cases if case.tile is not None]
    assert completed
    assert all(case.tile is not None and case.tile.decoded_bytes_read > 0 for case in completed)
    assert all(
        case.tile is not None and case.tile.output_dimensions == (64, 72) for case in completed
    )
    assert all(
        case.tile is not None and (experiment_root / case.tile.output_path).is_file()
        for case in completed
    )
    isotropic_errors = primary.monotonicity[0].physical_scale_errors
    assert isotropic_errors == sorted(isotropic_errors)
    anisotropic = next(case for case in primary.cases if case.case_id == "anisotropic-valid")
    corrupted = next(
        case for case in primary.cases if case.case_id == "anisotropic-y-copied-from-x"
    )
    assert anisotropic.trusted_effective_mpp == (0.2501, 0.5002)
    assert corrupted.physical_scale_error is not None
    assert corrupted.physical_scale_error > 0.9
    assert any(failure.expected for failure in result.failed_cases)
    assert not any(
        not failure.expected and failure.adapter_id == primary.adapter_id
        for failure in result.failed_cases
    )

    report = verify_experiment(experiment_root, write_report=True)
    assert report["status"] == "verified"
    assert report["case_count"] == 10
    assert report["primary_unexpected_failure_count"] == 0
    assert int(str(report["negative_control_failure_count"])) > 0
    assert (experiment_root / VERIFICATION_PATH).is_file()


def test_spec_rejects_incomplete_category_coverage() -> None:
    value = json.loads(
        (PROJECT_ROOT / "experiments/mpp-perturbation.json").read_text(encoding="utf-8")
    )
    corrupted = next(case for case in value["cases"] if case["category"] == "corrupted_metadata")
    corrupted["category"] = "anisotropic_pixels"

    with pytest.raises(ValidationError, match="every required perturbation category"):
        ExperimentSpec.model_validate_json(json.dumps(value))


def test_run_rejects_incorrect_machine_checkable_magnitude(
    experiment_root: Path, tmp_path: Path
) -> None:
    root = tmp_path / "invalid"
    shutil.copytree(experiment_root, root)
    path = root / "experiments/mpp-perturbation.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["cases"][1]["perturbation_magnitude"] = 0.2
    path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(ValueError, match="perturbation magnitude differs"):
        run_experiment(root)


def test_verify_rejects_changed_tile(experiment_root: Path) -> None:
    result = ExperimentResult.model_validate_json(
        (experiment_root / RESULT_PATH).read_text(encoding="utf-8")
    )
    tile = next(case.tile for case in result.adapters[0].cases if case.tile is not None)
    path = experiment_root / tile.output_path
    original = path.read_bytes()
    path.write_bytes(original + b"changed")
    try:
        with pytest.raises(ValueError, match="tile SHA-256 differs"):
            verify_experiment(experiment_root)
    finally:
        path.write_bytes(original)
