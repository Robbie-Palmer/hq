from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Literal

import numpy as np
from data_artifacts.files import read_json, sha256_file, write_json

from ..contracts import DoubleDescentConfig
from .config import OUTPUT_ROOT, PARAMS_FILE, load_config, seed_evaluation

Split = Literal["train", "validation"]


def _read_seed_epochs(seed: int) -> list[dict[str, Any]]:
    curve = read_json(seed_evaluation(seed) / "curve.json")
    if not isinstance(curve, dict):
        raise TypeError("curve evidence must be an object")
    values: list[dict[str, Any]] = []
    for entry in curve["epochs"]:
        path = seed_evaluation(seed) / str(entry["path"])
        if "sha256" in entry and sha256_file(path) != entry["sha256"]:
            raise ValueError("epoch evidence digest differs from the curve index")
        value = read_json(path)
        if not isinstance(value, dict):
            raise TypeError("epoch evidence must be an object")
        values.append(value)
    return values


def _f1(truth: int, predicted: int, matched: int) -> float:
    precision = matched / predicted if predicted else 0.0
    recall = matched / truth if truth else 0.0
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0


def _cluster_counts(epoch: dict[str, Any], split: Split) -> dict[str, np.ndarray[Any, Any]]:
    return {
        patient: np.asarray(
            [values["truth_points"], values["predicted_points"], values["matched_points"]],
            dtype=np.int64,
        )
        for patient, values in epoch[split]["patient_clusters"].items()
    }


def _sample_seed_error(
    epoch: dict[str, Any],
    split: Split,
    rng: np.random.Generator,
) -> float:
    clusters = _cluster_counts(epoch, split)
    patient_ids = sorted(clusters)
    indices = rng.integers(0, len(patient_ids), size=len(patient_ids))
    totals = sum((clusters[patient_ids[index]] for index in indices), start=np.zeros(3, dtype=int))
    return 1 - _f1(int(totals[0]), int(totals[1]), int(totals[2]))


def bootstrap_interval(
    seed_epochs: dict[int, list[dict[str, Any]]],
    epoch_index: int,
    split: Split,
    config: DoubleDescentConfig,
) -> tuple[float, float]:
    rng = np.random.default_rng(config.analysis.bootstrap_seed + epoch_index)
    seeds = sorted(seed_epochs)
    samples = np.empty(config.analysis.bootstrap_replicates, dtype=np.float64)
    for replicate in range(config.analysis.bootstrap_replicates):
        selected = rng.integers(0, len(seeds), size=len(seeds))
        samples[replicate] = np.mean(
            [
                _sample_seed_error(seed_epochs[seeds[index]][epoch_index], split, rng)
                for index in selected
            ]
        )
    alpha = (1 - config.analysis.confidence_level) / 2
    return float(np.quantile(samples, alpha)), float(np.quantile(samples, 1 - alpha))


def _window_seed_error(
    epochs: list[dict[str, Any]],
    split: Split,
    window: range,
    patient_ids: list[str],
    indices: np.ndarray[Any, Any],
) -> float:
    errors: list[float] = []
    for epoch_index in window:
        clusters = _cluster_counts(epochs[epoch_index], split)
        totals = sum(
            (clusters[patient_ids[index]] for index in indices),
            start=np.zeros(3, dtype=int),
        )
        errors.append(1 - _f1(int(totals[0]), int(totals[1]), int(totals[2])))
    return float(np.mean(errors))


def bootstrap_window_difference(
    seed_epochs: dict[int, list[dict[str, Any]]],
    first: range,
    second: range,
    config: DoubleDescentConfig,
) -> tuple[float, float]:
    rng = np.random.default_rng(config.analysis.bootstrap_seed + first.start * 1000 + second.start)
    seeds = sorted(seed_epochs)
    samples = np.empty(config.analysis.bootstrap_replicates, dtype=np.float64)
    for replicate in range(config.analysis.bootstrap_replicates):
        selected = rng.integers(0, len(seeds), size=len(seeds))
        differences: list[float] = []
        for index in selected:
            epochs = seed_epochs[seeds[index]]
            patient_ids = sorted(_cluster_counts(epochs[first.start], "validation"))
            patient_indices = rng.integers(0, len(patient_ids), size=len(patient_ids))
            first_error = _window_seed_error(
                epochs, "validation", first, patient_ids, patient_indices
            )
            second_error = _window_seed_error(
                epochs, "validation", second, patient_ids, patient_indices
            )
            differences.append(second_error - first_error)
        samples[replicate] = np.mean(differences)
    alpha = (1 - config.analysis.confidence_level) / 2
    return float(np.quantile(samples, alpha)), float(np.quantile(samples, 1 - alpha))


def _interpolation_epoch(errors: list[float], config: DoubleDescentConfig) -> int | None:
    sustained = config.analysis.sustained_epochs
    for start in range(len(errors) - sustained + 1):
        if all(
            error <= config.analysis.interpolation_error_maximum
            for error in errors[start : start + sustained]
        ):
            return start + sustained
    return None


def _rolling(values: list[float], width: int) -> list[float]:
    return [
        float(np.mean(values[index : index + width])) for index in range(len(values) - width + 1)
    ]


def analyze_pattern(
    rows: list[dict[str, float]],
    seed_epochs: dict[int, list[dict[str, Any]]],
    config: DoubleDescentConfig,
) -> dict[str, object]:
    width = config.analysis.sustained_epochs
    errors = [row["validation_error"] for row in rows]
    smoothed = _rolling(errors, width)
    baseline_windows = config.analysis.baseline_horizon_epochs - width + 1
    first_start = min(range(baseline_windows), key=smoothed.__getitem__)
    peak_start = max(range(first_start + 1, len(smoothed)), key=smoothed.__getitem__)
    later_candidates = range(peak_start + 1, len(smoothed))
    later_start = (
        min(later_candidates, key=smoothed.__getitem__) if later_candidates else peak_start
    )
    first_window = range(first_start, first_start + width)
    peak_window = range(peak_start, peak_start + width)
    later_window = range(later_start, later_start + width)
    peak_increase = smoothed[peak_start] - smoothed[first_start]
    second_descent = smoothed[peak_start] - smoothed[later_start]
    later_vs_first = smoothed[later_start] - smoothed[first_start]
    peak_difference_ci = bootstrap_window_difference(seed_epochs, first_window, peak_window, config)
    descent_difference_ci = bootstrap_window_difference(
        seed_epochs, peak_window, later_window, config
    )
    interpolation_epochs = {
        str(seed): _interpolation_epoch(
            [float(epoch["train"]["task_error"]) for epoch in epochs], config
        )
        for seed, epochs in seed_epochs.items()
    }
    all_interpolated = all(epoch is not None for epoch in interpolation_epochs.values())
    threshold = config.analysis.minimum_error_change
    peak_supported = peak_increase >= threshold and peak_difference_ci[0] > 0
    descent_supported = second_descent >= threshold and descent_difference_ci[1] < 0
    seed_agreement = {
        str(seed): {
            "peak_worse_than_first": float(
                np.mean([epochs[index]["validation"]["task_error"] for index in peak_window])
            )
            > float(np.mean([epochs[index]["validation"]["task_error"] for index in first_window])),
            "later_better_than_peak": float(
                np.mean([epochs[index]["validation"]["task_error"] for index in later_window])
            )
            < float(np.mean([epochs[index]["validation"]["task_error"] for index in peak_window])),
        }
        for seed, epochs in seed_epochs.items()
    }
    directions_agree = all(
        value["peak_worse_than_first"] and value["later_better_than_peak"]
        for value in seed_agreement.values()
    )
    observed = all_interpolated and peak_supported and descent_supported and directions_agree
    if not all_interpolated:
        conclusion = "negative_failure_to_interpolate"
    elif not peak_supported:
        conclusion = "negative_no_supported_later_peak"
    elif not descent_supported:
        conclusion = "negative_no_supported_second_descent"
    elif not directions_agree:
        conclusion = "negative_inconsistent_seeds"
    else:
        conclusion = "epoch_wise_double_descent_observed"
    return {
        "conclusion": conclusion,
        "observed": observed,
        "interpolation_epochs": interpolation_epochs,
        "first_validation_minimum": {
            "epoch_window": [first_window.start + 1, first_window.stop],
            "mean_error": smoothed[first_start],
        },
        "later_peak": {
            "epoch_window": [peak_window.start + 1, peak_window.stop],
            "mean_error": smoothed[peak_start],
            "increase_from_first": peak_increase,
            "difference_ci": list(peak_difference_ci),
            "supported": peak_supported,
        },
        "later_minimum": {
            "epoch_window": [later_window.start + 1, later_window.stop],
            "mean_error": smoothed[later_start],
            "decrease_from_peak": second_descent,
            "difference_from_first": later_vs_first,
            "difference_ci": list(descent_difference_ci),
            "beats_first": later_vs_first < 0,
            "supported_second_descent": descent_supported,
        },
        "seed_agreement": seed_agreement,
    }


def _write_curve(rows: list[dict[str, float]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def analyze(params_path: str = str(PARAMS_FILE)) -> dict[str, object]:
    config = load_config(Path(params_path))
    seed_epochs = {seed: _read_seed_epochs(seed) for seed in config.seeds}
    epoch_counts = {len(epochs) for epochs in seed_epochs.values()}
    if epoch_counts != {config.training.epochs}:
        raise ValueError("every seed must complete the predeclared horizon before analysis")
    rows: list[dict[str, float]] = []
    for epoch_index in range(config.training.epochs):
        epochs = [seed_epochs[seed][epoch_index] for seed in config.seeds]
        train_errors = [float(epoch["train"]["task_error"]) for epoch in epochs]
        validation_errors = [float(epoch["validation"]["task_error"]) for epoch in epochs]
        train_ci = bootstrap_interval(seed_epochs, epoch_index, "train", config)
        validation_ci = bootstrap_interval(seed_epochs, epoch_index, "validation", config)
        rows.append(
            {
                "epoch": float(epoch_index + 1),
                "train_error": float(np.mean(train_errors)),
                "train_error_ci_lower": train_ci[0],
                "train_error_ci_upper": train_ci[1],
                "validation_error": float(np.mean(validation_errors)),
                "validation_error_ci_lower": validation_ci[0],
                "validation_error_ci_upper": validation_ci[1],
                "validation_map50": float(
                    np.mean([epoch["ultralytics_validation"]["mAP50"] for epoch in epochs])
                ),
                "validation_map50_95": float(
                    np.mean([epoch["ultralytics_validation"]["mAP50_95"] for epoch in epochs])
                ),
            }
        )
    curve_path = OUTPUT_ROOT / "analysis" / "curves.csv"
    _write_curve(rows, curve_path)
    result: dict[str, object] = {
        "schema_version": "1.0.0",
        "experiment_id": config.experiment_id,
        "selection_policy": "fixed_epoch_120_endpoint",
        "cluster_unit": "patient_id",
        "bootstrap_replicates": config.analysis.bootstrap_replicates,
        "curve": {
            "path": curve_path.relative_to(OUTPUT_ROOT.parent.parent).as_posix(),
            "epochs": len(rows),
        },
        "pattern": analyze_pattern(rows, seed_epochs, config),
        "endpoint": rows[-1],
        "best_validation_map50": max(row["validation_map50"] for row in rows),
        "best_validation_map50_95": max(row["validation_map50_95"] for row in rows),
    }
    write_json(OUTPUT_ROOT / "analysis" / "evidence.json", result)
    return result
