import pytest
from pydantic import ValidationError

from ml_evaluation.contracts import (
    AdapterSpec,
    MetricObjective,
    ResourceBudget,
    ResourceUsage,
    Split,
    require_relative_path,
)


def test_external_adapters_require_a_digest() -> None:
    with pytest.raises(ValidationError, match="artifact path and SHA-256"):
        AdapterSpec(
            adapter_id="candidate-v1",
            kind="python_entrypoint",
            entrypoint="candidate:Adapter",
            version="1",
            artifact_path=None,
            artifact_sha256=None,
        )


def test_metric_objective_roles_define_valid_gates() -> None:
    primary = MetricObjective(
        metric="f1_score",
        role="primary",
        direction="maximize",
        unit="ratio",
        baseline_floor=0.7,
        candidate_min_delta=0.01,
        candidate_max_regression=0,
    )
    assert primary.metric == "f1_score"
    with pytest.raises(ValidationError, match="minimum delta"):
        MetricObjective(
            metric="f1_score",
            role="primary",
            direction="maximize",
            unit="ratio",
            baseline_floor=0.7,
        )
    with pytest.raises(ValidationError, match="greater than 0"):
        MetricObjective(
            metric="f1_score",
            role="primary",
            direction="maximize",
            unit="ratio",
            baseline_floor=0.7,
            candidate_min_delta=0,
        )
    with pytest.raises(ValidationError, match="maximum regression"):
        MetricObjective(
            metric="calibration_error",
            role="calibration",
            direction="minimize",
            unit="ratio",
            baseline_floor=0.1,
        )
    with pytest.raises(ValidationError, match="cannot define decision gates"):
        MetricObjective(
            metric="sample_count",
            role="diagnostic",
            direction="maximize",
            unit="ratio",
            baseline_floor=1,
        )


def test_resource_and_split_contracts_are_domain_neutral() -> None:
    budget = ResourceBudget(
        max_input_bytes=10,
        max_prediction_bytes=10,
        max_pixels_read=10,
        max_accelerator_seconds=0,
    )
    usage = ResourceUsage(
        samples=1,
        input_bytes=1,
        prediction_bytes=1,
        pixels_read=1,
        accelerator_seconds=0,
        observed_wall_seconds=0.1,
        observed_cpu_seconds=0.1,
        observed_peak_rss_bytes=50,
    )
    assert usage.input_bytes <= budget.max_input_bytes
    assert set(Split) == {Split.TRAIN, Split.VALIDATION, Split.TEST}


def test_relative_paths_reject_traversal() -> None:
    assert require_relative_path("experiments/test.json") == "experiments/test.json"
    with pytest.raises(ValueError, match="project-relative"):
        require_relative_path("../outside.json")
