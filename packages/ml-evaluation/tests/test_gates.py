from ml_evaluation.contracts import (
    AdapterSpec,
    MetricObjective,
    MetricResult,
    ResourceBudget,
    ResourceUsage,
    RunSummary,
)
from ml_evaluation.gates import evaluate_gates, metric_gates, recommendation


def _run(value: float, *, input_bytes: int = 5) -> RunSummary:
    return RunSummary(
        adapter=AdapterSpec(
            adapter_id=f"adapter-{value}",
            kind="builtin",
            entrypoint="example:Adapter",
            version="1",
        ),
        metrics=[
            MetricResult(
                metric="f1_score",
                value=value,
                unit="ratio",
                role="primary",
                direction="maximize",
            )
        ],
        resources=ResourceUsage(
            samples=1,
            input_bytes=input_bytes,
            prediction_bytes=2,
            pixels_read=4,
            accelerator_seconds=0,
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
    gates = evaluate_gates([_objective()], _budget(), _run(0.8), _run(0.9))
    assert len(gates) == 11
    assert all(gate.passed for gate in gates)
    assert recommendation(_run(0.9), gates) == "promote_candidate"


def test_rejects_failed_candidate_and_handles_baseline_only() -> None:
    gates = evaluate_gates([_objective()], _budget(), _run(0.8), _run(0.7, input_bytes=11))
    assert not all(gate.passed for gate in gates)
    assert recommendation(_run(0.7), gates) == "reject_candidate"
    baseline_gates = evaluate_gates([_objective()], _budget(), _run(0.8), None)
    assert recommendation(None, baseline_gates) == "baseline_only"


def test_diagnostic_objectives_have_no_metric_gates() -> None:
    objective = MetricObjective(
        metric="sample_count",
        role="diagnostic",
        direction="maximize",
        unit="ratio",
    )
    assert metric_gates(objective, 1, None) == []
