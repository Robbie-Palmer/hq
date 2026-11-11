from __future__ import annotations

import math
import random
from collections.abc import Callable, Mapping, Sequence

from .contracts import (
    BootstrapConfig,
    ConfidenceInterval,
    CurveComparison,
    CurveDirectionAgreement,
    CurveWindow,
)

type ClusterTotals = Mapping[str, Sequence[float]]
type ReplicatedCurve = Mapping[str, Sequence[ClusterTotals]]
type Statistic = Callable[[Sequence[float]], float]


def _quantile(values: Sequence[float], probability: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def _validate_cluster_totals(step: ClusterTotals, dimensions: set[int]) -> None:
    for totals in step.values():
        dimensions.add(len(totals))
        if not totals or any(not math.isfinite(float(value)) for value in totals):
            raise ValueError("cluster totals must be non-empty finite vectors")


def _validate_replicate_steps(
    steps: Sequence[ClusterTotals], dimensions: set[int]
) -> None:
    expected_clusters = set(steps[0])
    if not expected_clusters:
        raise ValueError("every curve step requires at least one cluster")
    for step in steps:
        clusters = set(step)
        if not clusters:
            raise ValueError("every curve step requires at least one cluster")
        if clusters != expected_clusters:
            raise ValueError("cluster identities must remain fixed across curve steps")
        _validate_cluster_totals(step, dimensions)


def _validate_curves(curves: ReplicatedCurve) -> tuple[tuple[str, ...], int, int]:
    if not curves:
        raise ValueError("clustered curve analysis requires at least one replicate")
    replicate_ids = tuple(sorted(curves))
    step_counts = {len(curves[replicate]) for replicate in replicate_ids}
    if len(step_counts) != 1 or not step_counts or next(iter(step_counts)) == 0:
        raise ValueError("replicated curves must have the same non-zero step count")
    dimensions: set[int] = set()
    for replicate in replicate_ids:
        _validate_replicate_steps(curves[replicate], dimensions)
    if len(dimensions) != 1:
        raise ValueError("cluster total vectors must have one shared dimension")
    return replicate_ids, next(iter(step_counts)), next(iter(dimensions))


def _sum_clusters(
    clusters: ClusterTotals, selected: Sequence[str], dimension: int
) -> tuple[float, ...]:
    totals = [0.0] * dimension
    for cluster_id in selected:
        for index, value in enumerate(clusters[cluster_id]):
            totals[index] += float(value)
    return tuple(totals)


def _checked_statistic(statistic: Statistic, totals: Sequence[float]) -> float:
    value = float(statistic(totals))
    if not math.isfinite(value):
        raise ValueError("curve statistic must return a finite value")
    return value


def _interval(samples: Sequence[float], config: BootstrapConfig) -> ConfidenceInterval:
    alpha = (1 - config.confidence_level) / 2
    return ConfidenceInterval(
        lower=_quantile(samples, alpha),
        upper=_quantile(samples, 1 - alpha),
    )


def clustered_bootstrap_interval(
    curves: ReplicatedCurve,
    step_index: int,
    statistic: Statistic,
    config: BootstrapConfig,
) -> ConfidenceInterval:
    replicate_ids, step_count, dimension = _validate_curves(curves)
    if not 0 <= step_index < step_count:
        raise IndexError("curve step index is out of range")
    rng = random.Random(config.seed + step_index)  # noqa: S311 - reproducible bootstrap
    samples: list[float] = []
    for _ in range(config.replicates):
        selected_replicates = rng.choices(replicate_ids, k=len(replicate_ids))
        replicate_values: list[float] = []
        for replicate in selected_replicates:
            clusters = curves[replicate][step_index]
            cluster_ids = sorted(clusters)
            selected_clusters = rng.choices(cluster_ids, k=len(cluster_ids))
            totals = _sum_clusters(clusters, selected_clusters, dimension)
            replicate_values.append(_checked_statistic(statistic, totals))
        samples.append(sum(replicate_values) / len(replicate_values))
    return _interval(samples, config)


def _window_value(
    steps: Sequence[ClusterTotals],
    window: range,
    selected_clusters: Sequence[str],
    dimension: int,
    statistic: Statistic,
) -> float:
    values = [
        _checked_statistic(
            statistic,
            _sum_clusters(steps[step_index], selected_clusters, dimension),
        )
        for step_index in window
    ]
    return sum(values) / len(values)


def paired_clustered_window_difference(
    curves: ReplicatedCurve,
    first: range,
    second: range,
    statistic: Statistic,
    config: BootstrapConfig,
) -> ConfidenceInterval:
    replicate_ids, step_count, dimension = _validate_curves(curves)
    indices = (*first, *second)
    if not first or not second or min(indices) < 0 or max(indices) >= step_count:
        raise IndexError("curve window is empty or out of range")
    rng = random.Random(  # noqa: S311 - reproducible bootstrap
        config.seed + first.start * 1009 + second.start
    )
    samples: list[float] = []
    for _ in range(config.replicates):
        selected_replicates = rng.choices(replicate_ids, k=len(replicate_ids))
        differences: list[float] = []
        for replicate in selected_replicates:
            steps = curves[replicate]
            cluster_ids = sorted(steps[0])
            selected_clusters = rng.choices(cluster_ids, k=len(cluster_ids))
            first_value = _window_value(steps, first, selected_clusters, dimension, statistic)
            second_value = _window_value(steps, second, selected_clusters, dimension, statistic)
            differences.append(second_value - first_value)
        samples.append(sum(differences) / len(differences))
    return _interval(samples, config)


def mean_curve(curves: ReplicatedCurve, statistic: Statistic) -> tuple[float, ...]:
    replicate_ids, step_count, dimension = _validate_curves(curves)
    values: list[float] = []
    for step_index in range(step_count):
        replicate_values = []
        for replicate in replicate_ids:
            clusters = curves[replicate][step_index]
            totals = _sum_clusters(clusters, sorted(clusters), dimension)
            replicate_values.append(_checked_statistic(statistic, totals))
        values.append(sum(replicate_values) / len(replicate_values))
    return tuple(values)


def _rolling(values: Sequence[float], width: int) -> tuple[float, ...]:
    return tuple(
        sum(values[start : start + width]) / width for start in range(len(values) - width + 1)
    )


def _window(start: int, width: int, value: float) -> CurveWindow:
    return CurveWindow(start_step=start + 1, end_step=start + width, mean=value)


def compare_error_curve(
    curves: ReplicatedCurve,
    statistic: Statistic,
    *,
    baseline_horizon_steps: int,
    smoothing_window_steps: int,
    minimum_change: float,
    bootstrap: BootstrapConfig,
) -> CurveComparison:
    values = mean_curve(curves, statistic)
    if smoothing_window_steps < 1:
        raise ValueError("smoothing window must be positive")
    if not smoothing_window_steps <= baseline_horizon_steps < len(values):
        raise ValueError("baseline horizon must contain a window and precede the endpoint")
    if minimum_change <= 0:
        raise ValueError("minimum curve change must be positive")
    smoothed = _rolling(values, smoothing_window_steps)
    baseline_windows = baseline_horizon_steps - smoothing_window_steps + 1
    first_start = min(range(baseline_windows), key=smoothed.__getitem__)
    peak_candidates = range(first_start + 1, len(smoothed) - 1)
    if not peak_candidates:
        raise ValueError("curve needs windows after the baseline minimum and later peak")
    peak_start = max(peak_candidates, key=smoothed.__getitem__)
    later_start = min(range(peak_start + 1, len(smoothed)), key=smoothed.__getitem__)
    first_range = range(first_start, first_start + smoothing_window_steps)
    peak_range = range(peak_start, peak_start + smoothing_window_steps)
    later_range = range(later_start, later_start + smoothing_window_steps)
    peak_increase = smoothed[peak_start] - smoothed[first_start]
    second_descent = smoothed[peak_start] - smoothed[later_start]
    later_minus_first = smoothed[later_start] - smoothed[first_start]
    peak_interval = paired_clustered_window_difference(
        curves, first_range, peak_range, statistic, bootstrap
    )
    descent_interval = paired_clustered_window_difference(
        curves, peak_range, later_range, statistic, bootstrap
    )
    replicate_agreement: dict[str, CurveDirectionAgreement] = {}
    dimension = _validate_curves(curves)[2]
    for replicate, steps in sorted(curves.items()):
        selected_clusters = sorted(steps[0])
        first_value = _window_value(steps, first_range, selected_clusters, dimension, statistic)
        peak_value = _window_value(steps, peak_range, selected_clusters, dimension, statistic)
        later_value = _window_value(steps, later_range, selected_clusters, dimension, statistic)
        replicate_agreement[replicate] = CurveDirectionAgreement(
            peak_worse_than_first=peak_value > first_value,
            later_better_than_peak=later_value < peak_value,
        )
    peak_supported = peak_increase >= minimum_change and peak_interval.lower > 0
    descent_supported = second_descent >= minimum_change and descent_interval.upper < 0
    directions_agree = all(
        agreement.peak_worse_than_first and agreement.later_better_than_peak
        for agreement in replicate_agreement.values()
    )
    return CurveComparison(
        first_minimum=_window(first_start, smoothing_window_steps, smoothed[first_start]),
        later_peak=_window(peak_start, smoothing_window_steps, smoothed[peak_start]),
        later_minimum=_window(later_start, smoothing_window_steps, smoothed[later_start]),
        peak_increase=peak_increase,
        peak_difference_interval=peak_interval,
        second_descent=second_descent,
        descent_difference_interval=descent_interval,
        later_minus_first=later_minus_first,
        later_beats_first=later_minus_first < 0,
        peak_supported=peak_supported,
        second_descent_supported=descent_supported,
        replicate_agreement=replicate_agreement,
        pattern_observed=peak_supported and descent_supported and directions_agree,
    )
