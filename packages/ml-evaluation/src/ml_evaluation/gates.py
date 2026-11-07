from __future__ import annotations

from typing import Literal

from .contracts import (
    GateResult,
    MetricObjective,
    ResourceBudget,
    RunSummary,
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


def resource_gates(budget: ResourceBudget, run_role: str, run: RunSummary) -> list[GateResult]:
    limits = {
        "input_bytes": budget.max_input_bytes,
        "prediction_bytes": budget.max_prediction_bytes,
        "input_pixels": budget.max_input_pixels,
        "wall_seconds": budget.max_wall_seconds,
        "cpu_seconds": budget.max_cpu_seconds,
        "peak_rss_bytes": budget.max_peak_rss_bytes,
        "accelerator_wall_seconds": budget.max_accelerator_wall_seconds,
        "peak_accelerator_memory_bytes": budget.max_accelerator_memory_bytes,
    }
    resource_values = {
        "input_bytes": run.resources.input_bytes,
        "prediction_bytes": run.resources.prediction_bytes,
        "input_pixels": run.resources.input_pixels,
        "wall_seconds": run.resources.wall_seconds,
        "cpu_seconds": run.resources.cpu_seconds,
        "peak_rss_bytes": run.resources.peak_rss_bytes,
        "accelerator_wall_seconds": run.resources.accelerator_wall_seconds,
        "peak_accelerator_memory_bytes": run.resources.peak_accelerator_memory_bytes,
    }
    return [
        GateResult(
            gate=f"{run_role}-resource:{name}",
            passed=observed <= limits[name],
            observed=float(observed),
            threshold=float(limits[name]),
        )
        for name, observed in resource_values.items()
    ]


def evaluate_gates(
    objectives: list[MetricObjective],
    budget: ResourceBudget,
    baseline: RunSummary,
    candidate: RunSummary | None,
) -> list[GateResult]:
    baseline_values = {metric.metric: metric.value for metric in baseline.metrics}
    candidate_values = (
        {metric.metric: metric.value for metric in candidate.metrics} if candidate else {}
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
    gates.extend(resource_gates(budget, "baseline", baseline))
    if candidate is not None:
        gates.extend(resource_gates(budget, "candidate", candidate))
    return gates


def recommendation(
    candidate: RunSummary | None, gates: list[GateResult]
) -> Literal["baseline_only", "promote_candidate", "reject_candidate"]:
    if candidate is None:
        return "baseline_only"
    if all(gate.passed for gate in gates):
        return "promote_candidate"
    return "reject_candidate"
