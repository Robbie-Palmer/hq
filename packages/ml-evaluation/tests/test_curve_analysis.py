from collections.abc import Sequence
from typing import cast

import pytest
from pydantic import ValidationError

from ml_evaluation.contracts import BootstrapConfig, ConfidenceInterval, CurveWindow
from ml_evaluation.curve_analysis import (
    ReplicatedCurve,
    _quantile,
    clustered_bootstrap_interval,
    compare_error_curve,
    mean_curve,
    paired_clustered_window_difference,
)


def _mean(totals: Sequence[float]) -> float:
    return totals[0] / totals[1]


def _curves(values: list[float]) -> dict[str, list[dict[str, tuple[float, float]]]]:
    return {
        replicate: [
            {
                "patient-a": (value + offset - 0.01, 1),
                "patient-b": (value + offset + 0.01, 1),
            }
            for value in values
        ]
        for replicate, offset in (("seed-1", -0.01), ("seed-2", 0.0), ("seed-3", 0.01))
    }


def _bootstrap() -> BootstrapConfig:
    return BootstrapConfig(replicates=500, seed=17, confidence_level=0.95)


def test_clustered_bootstrap_and_curve_comparison_find_supported_pattern() -> None:
    curves = _curves([0.60, 0.40, 0.30, 0.35, 0.50, 0.55, 0.45, 0.25, 0.20, 0.18])

    interval = clustered_bootstrap_interval(curves, 2, _mean, _bootstrap())
    comparison = compare_error_curve(
        curves,
        _mean,
        baseline_horizon_steps=4,
        smoothing_window_steps=2,
        minimum_change=0.05,
        bootstrap=_bootstrap(),
    )

    assert interval.lower < 0.30 < interval.upper
    assert comparison.first_minimum.start_step == 3
    assert comparison.later_peak.start_step == 5
    assert comparison.later_minimum.start_step == 9
    assert comparison.later_beats_first is True
    assert comparison.peak_supported is True
    assert comparison.second_descent_supported is True
    assert comparison.pattern_observed is True
    assert all(
        value.peak_worse_than_first and value.later_better_than_peak
        for value in comparison.replicate_agreement.values()
    )


def test_quantile_and_curve_contract_edge_cases() -> None:
    assert _quantile([3.0], 0.5) == 3.0
    with pytest.raises(ValidationError, match="bounds must be ordered"):
        ConfidenceInterval(lower=2, upper=1)
    with pytest.raises(ValidationError, match="steps must be ordered"):
        CurveWindow(start_step=2, end_step=1, mean=0.5)


def test_curve_pattern_does_not_depend_on_an_interpolation_gate() -> None:
    curves = _curves([0.60, 0.40, 0.30, 0.35, 0.50, 0.55, 0.45, 0.25, 0.20, 0.18])
    comparison = compare_error_curve(
        curves,
        _mean,
        baseline_horizon_steps=4,
        smoothing_window_steps=2,
        minimum_change=0.05,
        bootstrap=_bootstrap(),
    )

    assert min(mean_curve(curves, _mean)) == pytest.approx(0.18)
    assert comparison.pattern_observed is True


def test_paired_difference_is_deterministic_and_preserves_cluster_pairing() -> None:
    curves = _curves([0.5, 0.4, 0.6, 0.7])
    first = paired_clustered_window_difference(
        curves, range(0, 2), range(2, 4), _mean, _bootstrap()
    )
    second = paired_clustered_window_difference(
        curves, range(0, 2), range(2, 4), _mean, _bootstrap()
    )

    assert first == second
    assert first.lower > 0


@pytest.mark.parametrize(
    ("curves", "message"),
    [
        ({}, "at least one replicate"),
        ({"one": []}, "same non-zero step count"),
        ({"one": [{}]}, "at least one cluster"),
        ({"one": [{"a": (1.0,)}, {"b": (1.0,)}]}, "identities"),
        ({"one": [{"a": ()}]}, "non-empty finite"),
        ({"one": [{"a": (float("nan"),)}]}, "non-empty finite"),
        ({"one": [{"a": (1.0,), "b": (1.0, 2.0)}]}, "shared dimension"),
    ],
)
def test_rejects_invalid_clustered_curves(curves: object, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        mean_curve(cast(ReplicatedCurve, curves), _mean)


def test_rejects_invalid_curve_requests_and_non_finite_statistics() -> None:
    curves = _curves([0.5, 0.4, 0.6, 0.7])
    with pytest.raises(IndexError, match="out of range"):
        clustered_bootstrap_interval(curves, 4, _mean, _bootstrap())
    with pytest.raises(IndexError, match="empty or out of range"):
        paired_clustered_window_difference(curves, range(0), range(1, 2), _mean, _bootstrap())
    with pytest.raises(ValueError, match="finite value"):
        mean_curve(curves, lambda _totals: float("nan"))
    with pytest.raises(ValueError, match="smoothing window"):
        compare_error_curve(
            curves,
            _mean,
            baseline_horizon_steps=2,
            smoothing_window_steps=0,
            minimum_change=0.1,
            bootstrap=_bootstrap(),
        )
    with pytest.raises(ValueError, match="baseline horizon"):
        compare_error_curve(
            curves,
            _mean,
            baseline_horizon_steps=4,
            smoothing_window_steps=2,
            minimum_change=0.1,
            bootstrap=_bootstrap(),
        )
    with pytest.raises(ValueError, match="minimum curve change"):
        compare_error_curve(
            curves,
            _mean,
            baseline_horizon_steps=2,
            smoothing_window_steps=1,
            minimum_change=0,
            bootstrap=_bootstrap(),
        )
    with pytest.raises(ValueError, match="windows after"):
        compare_error_curve(
            _curves([0.5, 0.4, 0.6]),
            _mean,
            baseline_horizon_steps=2,
            smoothing_window_steps=1,
            minimum_change=0.1,
            bootstrap=_bootstrap(),
        )


def test_monotone_curve_does_not_report_supported_pattern() -> None:
    curves = _curves([0.6, 0.5, 0.4, 0.3, 0.2, 0.1])
    comparison = compare_error_curve(
        curves,
        _mean,
        baseline_horizon_steps=3,
        smoothing_window_steps=1,
        minimum_change=0.05,
        bootstrap=_bootstrap(),
    )

    assert comparison.peak_supported is False
    assert comparison.pattern_observed is False
