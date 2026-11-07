from __future__ import annotations

from typing import Literal

from .contracts import (
    GateResult,
    MetricObjective,
    MetricResult,
    ResourceBudget,
    ResourceUsage,
)


def directional_delta(direction: str, new: float, reference: float) -> float:
    return new - reference if direction == "maximize" else reference - new


def metric_gates(
    objective: MetricObjective,
    baseline_value: float,
    candidate_value: float | None,
) -> list[GateResult]:
    if objective.role == "diagnostic":
        return []
    if objective.baseline_floor is None:
        raise ValueError(f"missing baseline threshold for {objective.metric}")
    threshold = objective.baseline_floor
    baseline_passed = directional_delta(objective.direction, baseline_value, threshold) >= 0
    gates = [
        GateResult(
            gate=f"baseline:{objective.metric}",
            passed=baseline_passed,
            observed=baseline_value,
            threshold=threshold,
        )
    ]
    if candidate_value is None:
        return gates
    if objective.role == "primary":
        if objective.candidate_min_delta is None:
            raise ValueError(f"missing candidate delta for {objective.metric}")
        improvement = directional_delta(objective.direction, candidate_value, baseline_value)
        gates.append(
            GateResult(
                gate=f"candidate-improvement:{objective.metric}",
                passed=improvement >= objective.candidate_min_delta,
                observed=improvement,
                threshold=objective.candidate_min_delta,
            )
        )
    if objective.candidate_max_regression is not None:
        regression = directional_delta(objective.direction, baseline_value, candidate_value)
        gates.append(
            GateResult(
                gate=f"candidate-regression:{objective.metric}",
                passed=regression <= objective.candidate_max_regression,
                observed=regression,
                threshold=objective.candidate_max_regression,
            )
        )
    return gates


def resource_gates(
    budget: ResourceBudget, run_role: str, resources: ResourceUsage
) -> list[GateResult]:
    limits = {
        "input_bytes": budget.max_input_bytes,
        "prediction_bytes": budget.max_prediction_bytes,
        "pixels_read": budget.max_pixels_read,
        "accelerator_seconds": budget.max_accelerator_seconds,
    }
    resource_values = {
        "input_bytes": resources.input_bytes,
        "prediction_bytes": resources.prediction_bytes,
        "pixels_read": resources.pixels_read,
        "accelerator_seconds": resources.accelerator_seconds,
    }
    gates: list[GateResult] = []
    for name, observed in resource_values.items():
        gates.append(
            GateResult(
                gate=f"{run_role}-resource:{name}",
                passed=observed is not None and observed <= limits[name],
                observed=float(observed) if observed is not None else None,
                threshold=float(limits[name]),
            )
        )
    return gates


def evaluate_gates(
    objectives: list[MetricObjective],
    budget: ResourceBudget,
    baseline_metrics: list[MetricResult],
    baseline_resources: ResourceUsage,
    candidate_metrics: list[MetricResult] | None,
    candidate_resources: ResourceUsage | None,
) -> list[GateResult]:
    baseline_values = {metric.metric: metric.value for metric in baseline_metrics}
    candidate_values = (
        {metric.metric: metric.value for metric in candidate_metrics}
        if candidate_metrics is not None
        else {}
    )
    gates: list[GateResult] = []
    for objective in objectives:
        gates.extend(
            metric_gates(
                objective,
                baseline_values[objective.metric],
                candidate_values.get(objective.metric),
            )
        )
    gates.extend(resource_gates(budget, "baseline", baseline_resources))
    if candidate_resources is not None:
        gates.extend(resource_gates(budget, "candidate", candidate_resources))
    return gates


def recommendation(
    candidate_present: bool, gates: list[GateResult]
) -> Literal["baseline_only", "promote_candidate", "reject_candidate"]:
    if not candidate_present:
        return "baseline_only"
    if all(gate.passed for gate in gates):
        return "promote_candidate"
    return "reject_candidate"
