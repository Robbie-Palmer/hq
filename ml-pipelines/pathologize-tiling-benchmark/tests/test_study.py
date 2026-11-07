from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from pathologize_benchmark_contracts.synthetic import generate_fixtures
from pydantic import ValidationError

from pathologize_tiling_benchmark.contracts import StudyResult, StudySpec
from pathologize_tiling_benchmark.study import (
    RESULT_PATH,
    VERIFICATION_PATH,
    RequestedScaleEchoAdapter,
    StudyStoppedError,
    run_study,
    verify_study,
)

PROJECT_ROOT = Path(__file__).parents[1]


@pytest.fixture
def study_root(tmp_path: Path) -> Path:
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    shutil.copy2(PROJECT_ROOT / "fixtures/spec.json", fixtures / "spec.json")
    shutil.copy2(
        PROJECT_ROOT / "fixtures/mpp-perturbations.json",
        fixtures / "mpp-perturbations.json",
    )
    generate_fixtures(tmp_path)
    return tmp_path


def test_study_records_case_evidence_and_rejects_echo_control(study_root: Path) -> None:
    result = run_study(study_root)

    assert result.status == "passed"
    assert result.echo_control_rejected
    assert result.dvc.lockfile == "dvc.lock"
    primary, control = result.adapters
    assert primary.adapter_id == "metadata-aware-v1"
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
    source_size = (study_root / result.provenance.source_image).stat().st_size
    assert all(
        case.bytes_read == source_size and case.runtime_seconds >= 0 for case in primary.cases
    )
    assert primary.bytes_read == sum(case.bytes_read for case in primary.cases)
    assert result.provenance.source_kind == "checked_in_fixture_derivation"
    assert result.provenance.bounded_item_count == 1
    assert result.provenance.clinical_validity is False
    assert len(result.provenance.source_image_sha256) == 64

    absent = next(case for case in primary.cases if case.case_id == "mpp-absent")
    implausible = next(case for case in primary.cases if case.case_id == "mpp-implausibly-small-x")
    anisotropic = next(case for case in primary.cases if case.case_id == "anisotropic-valid")
    corrupted = next(
        case for case in primary.cases if case.case_id == "anisotropic-y-copied-from-x"
    )
    assert absent.status == "rejected"
    assert absent.response_matched
    assert absent.presented_source_mpp_x is None
    assert implausible.status == "rejected"
    assert implausible.response_matched
    assert anisotropic.produced_tile is not None
    assert (
        anisotropic.produced_tile.source_width_pixels,
        anisotropic.produced_tile.source_height_pixels,
    ) == (16, 12)
    assert corrupted.physical_scale_error == 0.5
    assert corrupted.trusted_source_mpp_y == 0.75
    assert corrupted.presented_source_mpp_y == 0.5
    assert corrupted.produced_tile is not None
    assert corrupted.produced_tile.physical_coverage_microns_y == 13.5
    wrong_level = next(
        case for case in primary.cases if case.case_id == "pyramid-level-two-reported-as-zero"
    )
    assert wrong_level.produced_tile is not None
    assert wrong_level.trusted_source_mpp_x == 2.0
    assert wrong_level.presented_source_mpp_x == 0.5
    assert wrong_level.produced_tile.source_coverage_fraction == 1.125

    report = verify_study(study_root, write_report=True)
    assert report["status"] == "verified"
    assert report["case_count"] == 10
    assert (study_root / VERIFICATION_PATH).is_file()


def test_nonresponsive_primary_stops_after_writing_evidence(study_root: Path) -> None:
    adapter = RequestedScaleEchoAdapter()
    with pytest.raises(StudyStoppedError, match="not responsive"):
        run_study(study_root, primary_adapter=adapter)

    result = StudyResult.model_validate_json((study_root / RESULT_PATH).read_text(encoding="utf-8"))
    assert result.status == "stopped"
    assert not result.adapters[0].passed
    assert any(
        failure.code == "non_monotonic_physical_scale_error"
        for failure in result.adapters[0].failed_cases
    )
    with pytest.raises(ValueError, match="did not pass"):
        verify_study(study_root)


def test_spec_rejects_incomplete_category_coverage() -> None:
    value = json.loads(
        (PROJECT_ROOT / "fixtures/mpp-perturbations.json").read_text(encoding="utf-8")
    )
    value["cases"] = [case for case in value["cases"] if case["category"] != "corrupted_metadata"]
    serialized = json.dumps(value)
    with pytest.raises(ValidationError, match="every required perturbation category"):
        StudySpec.model_validate_json(serialized)


def test_run_rejects_incorrect_machine_checkable_magnitude(study_root: Path) -> None:
    path = study_root / "fixtures/mpp-perturbations.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    value["cases"][1]["perturbation_magnitude"] = 0.2
    path.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(ValueError, match="perturbation magnitude differs"):
        run_study(study_root)


def test_verify_rejects_changed_source_bytes(study_root: Path) -> None:
    run_study(study_root)
    source = study_root / "data/synthetic/synthetic-test-clean/image.ppm"
    source.write_text(source.read_text(encoding="ascii") + "\n", encoding="ascii")

    with pytest.raises(ValueError, match="provenance SHA-256 differs"):
        verify_study(study_root)
