from ml_evaluation.contracts import (
    MetricObjective,
    MetricResult,
    ResourceBudget,
    ResourceUsage,
)
from ml_evaluation.gates import evaluate_gates, metric_gates, recommendation


def _run(value: float, *, input_bytes: int = 5) -> tuple[list[MetricResult], ResourceUsage]:
    return (
        [
            MetricResult(
                metric="f1_score",
                value=value,
                unit="ratio",
                role="primary",
                direction="maximize",
            )
        ],
        ResourceUsage(
            samples=1,
            input_bytes=input_bytes,
            prediction_bytes=2,
            pixels_read=4,
            accelerator_seconds=0,
            observed_wall_seconds=0.1,
            observed_cpu_seconds=0.1,
            observed_peak_rss_bytes=50,
        ),
    )


def _objective() -> MetricObjective:
    return MetricObjective(
        metric="f1_score",
        role="primary",
        direction="maximize",
        unit="ratio",
        baseline_floor=0.7,
        candidate_min_delta=0.05,
        candidate_max_regression=0,
    )


def _budget() -> ResourceBudget:
    return ResourceBudget(
        max_input_bytes=10,
        max_prediction_bytes=10,
        max_pixels_read=10,
        max_accelerator_seconds=0,
    )


def test_evaluates_metric_and_resource_gates() -> None:
    baseline_metrics, baseline_resources = _run(0.8)
    candidate_metrics, candidate_resources = _run(0.9)
    gates = evaluate_gates(
        [_objective()],
        _budget(),
        baseline_metrics,
        baseline_resources,
        candidate_metrics,
        candidate_resources,
    )
    assert len(gates) == 11
    assert all(gate.passed for gate in gates)
    assert recommendation(True, gates) == "promote_candidate"


def test_rejects_failed_candidate_and_handles_baseline_only() -> None:
    baseline_metrics, baseline_resources = _run(0.8)
    candidate_metrics, candidate_resources = _run(0.7, input_bytes=11)
    gates = evaluate_gates(
        [_objective()],
        _budget(),
        baseline_metrics,
        baseline_resources,
        candidate_metrics,
        candidate_resources,
    )
    assert not all(gate.passed for gate in gates)
    assert recommendation(True, gates) == "reject_candidate"
    baseline_gates = evaluate_gates(
        [_objective()], _budget(), baseline_metrics, baseline_resources, None, None
    )
    assert recommendation(False, baseline_gates) == "baseline_only"


def test_diagnostic_objectives_have_no_metric_gates() -> None:
    objective = MetricObjective(
        metric="sample_count",
        role="diagnostic",
        direction="maximize",
        unit="ratio",
    )
    assert metric_gates(objective, 1, None) == []


def test_missing_accelerator_measurement_fails_resource_gate() -> None:
    metrics, resources = _run(0.8)
    resources = resources.model_copy(update={"accelerator_seconds": None})
    gates = evaluate_gates([_objective()], _budget(), metrics, resources, None, None)
    accelerator_gate = next(
        gate for gate in gates if gate.gate == "baseline-resource:accelerator_seconds"
    )
    assert accelerator_gate.passed is False
    assert accelerator_gate.observed is None
