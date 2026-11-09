from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from data_artifacts.files import read_json, sha256_file, write_json

from .config import (
    OUTPUT_ROOT,
    PARAMS_FILE,
    PROJECT_ROOT,
    REPORT_JSON_FILE,
    REPORT_MARKDOWN_FILE,
    load_config,
    seed_evaluation,
    seed_output,
)


def _seed_values(test: dict[str, Any]) -> list[dict[str, Any]]:
    return [test["seeds"][seed] for seed in sorted(test["seeds"])]


def _mean(values: list[float]) -> float:
    return float(np.mean(values))


def _test_slices(seed_values: list[dict[str, Any]], key: str) -> dict[str, dict[str, float]]:
    labels = sorted(seed_values[0]["pathologize"][key])
    return {
        label: {
            "localization_f1_mean": _mean(
                [
                    float(seed["pathologize"][key][label]["localization"]["f1"])
                    for seed in seed_values
                ]
            ),
            "localization_f1_min": min(
                float(seed["pathologize"][key][label]["localization"]["f1"]) for seed in seed_values
            ),
            "localization_f1_max": max(
                float(seed["pathologize"][key][label]["localization"]["f1"]) for seed in seed_values
            ),
        }
        for label in labels
    }


def _curve_failure_count(seed: int) -> int:
    curve = read_json(seed_evaluation(seed) / "curve.json")
    return sum(
        len(read_json(seed_evaluation(seed) / str(epoch["path"]))["failures"])
        for epoch in curve["epochs"]
    )


def _resources(config: Any, test: dict[str, Any]) -> dict[str, object]:
    training = {
        str(seed): read_json(seed_output(seed) / "run.json")["resources"] for seed in config.seeds
    }
    curves = {
        str(seed): read_json(seed_evaluation(seed) / "curve.json")["resources"]
        for seed in config.seeds
    }
    return {
        "training": training,
        "curve_evaluation": curves,
        "sealed_test_evaluation": test["resources"],
        "aggregate_gpu_seconds": test["resources"]["experiment_gpu_seconds"],
        "aggregate_gpu_ceiling_seconds": config.limits.aggregate_gpu_seconds,
        "peak_vram_bytes": max(
            [int(value["peak_vram_bytes"]) for value in training.values()]
            + [int(value["peak_vram_bytes"]) for value in curves.values()]
            + [int(test["resources"]["peak_vram_bytes"])]
        ),
    }


def metric_summary(
    analysis: dict[str, Any], test: dict[str, Any], config: Any
) -> dict[str, object]:
    seeds = _seed_values(test)
    test_f1 = [float(seed["pathologize"]["localization"]["f1"]) for seed in seeds]
    test_map50 = [float(seed["ultralytics"]["mAP50"]) for seed in seeds]
    test_map50_95 = [float(seed["ultralytics"]["mAP50_95"]) for seed in seeds]
    curve_failures = sum(_curve_failure_count(seed) for seed in config.seeds)
    test_failures = sum(len(seed["failures"]) for seed in seeds)
    resources = _resources(config, test)
    return {
        "schema_version": "1.0.0",
        "experiment_id": config.experiment_id,
        "conclusion": analysis["pattern"]["conclusion"],
        "epoch_wise_double_descent_observed": analysis["pattern"]["observed"],
        "pattern": analysis["pattern"],
        "curves": analysis["curve"],
        "validation": {
            "endpoint_map50": analysis["endpoint"]["validation_map50"],
            "endpoint_map50_95": analysis["endpoint"]["validation_map50_95"],
            "best_map50": analysis["best_validation_map50"],
            "best_map50_95": analysis["best_validation_map50_95"],
        },
        "sealed_test": {
            "selection_policy": test["selection_policy"],
            "localization_f1_mean": _mean(test_f1),
            "localization_f1_by_seed": {
                str(seed): value for seed, value in zip(config.seeds, test_f1, strict=True)
            },
            "mAP50_mean": _mean(test_map50),
            "mAP50_95_mean": _mean(test_map50_95),
            "per_class": _test_slices(seeds, "per_class"),
            "site_slices": _test_slices(seeds, "site_slices"),
        },
        "baseline_comparison": {
            "merged_baseline_commit": config.baseline.merge_commit,
            "baseline_best_validation_map50": config.baseline.detection_best_map50,
            "baseline_best_validation_map50_95": config.baseline.detection_best_map50_95,
            "baseline_test_localization_f1": config.baseline.detection_test_localization_f1,
            "best_validation_map50_delta": analysis["best_validation_map50"]
            - config.baseline.detection_best_map50,
            "best_validation_map50_95_delta": analysis["best_validation_map50_95"]
            - config.baseline.detection_best_map50_95,
            "test_localization_f1_delta": _mean(test_f1)
            - config.baseline.detection_test_localization_f1,
        },
        "failures": {
            "curve_prediction_rejections": curve_failures,
            "sealed_test_prediction_rejections": test_failures,
        },
        "resources": resources,
        "provenance": {
            "parameters": {
                "path": PARAMS_FILE.relative_to(PROJECT_ROOT).as_posix(),
                "sha256": sha256_file(PARAMS_FILE),
            },
            "package": config.package.model_dump(mode="json"),
            "package_lock": {
                "path": "uv.lock",
                "sha256": sha256_file(PROJECT_ROOT / "uv.lock"),
            },
            "starting_weights": {
                "name": config.model.weights,
                "sha256": config.model.weights_sha256,
            },
            "seeds": config.seeds,
            "checkpoint_cadence_epochs": config.checkpoint_cadence_epochs,
            "checkpoint_digest_count": sum(
                len(read_json(seed_output(seed) / "run.json")["checkpoints"])
                for seed in config.seeds
            ),
            "run_evidence": {
                str(seed): (seed_output(seed) / "run.json").relative_to(PROJECT_ROOT).as_posix()
                for seed in config.seeds
            },
        },
        "clinical_validity": False,
    }


def _number(value: float) -> str:
    return f"{value:.4f}"


def _report_markdown(metrics: dict[str, Any], config: Any) -> str:
    pattern = metrics["pattern"]
    comparison = metrics["baseline_comparison"]
    resources = metrics["resources"]
    first_window = pattern["first_validation_minimum"]["epoch_window"]
    peak_window = pattern["later_peak"]["epoch_window"]
    later_window = pattern["later_minimum"]["epoch_window"]
    baseline_map50 = _number(comparison["baseline_best_validation_map50"])
    baseline_map50_95 = _number(comparison["baseline_best_validation_map50_95"])
    baseline_test_f1 = _number(comparison["baseline_test_localization_f1"])
    best_map50 = _number(metrics["validation"]["best_map50"])
    best_map50_95 = _number(metrics["validation"]["best_map50_95"])
    test_f1 = _number(metrics["sealed_test"]["localization_f1_mean"])
    map50_delta = _number(comparison["best_validation_map50_delta"])
    map50_95_delta = _number(comparison["best_validation_map50_95_delta"])
    test_f1_delta = _number(comparison["test_localization_f1_delta"])
    checkpoint_count = metrics["provenance"]["checkpoint_digest_count"]
    package_lock = metrics["provenance"]["package_lock"]["sha256"]
    starting_weights = metrics["provenance"]["starting_weights"]["sha256"]
    curve_failures = metrics["failures"]["curve_prediction_rejections"]
    test_failures = metrics["failures"]["sealed_test_prediction_rejections"]
    class_rows = "\n".join(
        f"| `{label}` | {_number(values['localization_f1_mean'])} | "
        f"{_number(values['localization_f1_min'])} to {_number(values['localization_f1_max'])} |"
        for label, values in metrics["sealed_test"]["per_class"].items()
    )
    site_rows = "\n".join(
        f"| `{site}` | {_number(values['localization_f1_mean'])} | "
        f"{_number(values['localization_f1_min'])} to {_number(values['localization_f1_max'])} |"
        for site, values in metrics["sealed_test"]["site_slices"].items()
    )
    return "\n".join(
        [
            "# NuCLS epoch-wise double descent",
            "",
            "This detector-only DVC experiment kept the merged NuCLS baseline fixed",
            "except for a 120-epoch horizon, disabled model-selection patience, and",
            "per-epoch checkpoints. It ran the same YOLO26n setup with seeds",
            ", ".join(str(seed) for seed in config.seeds) + ".",
            "",
            "## Result",
            "",
            f"Conclusion: `{metrics['conclusion']}`.",
            "",
            f"The three-epoch first minimum was epochs {first_window[0]} to {first_window[1]}.",
            f"The later peak was epochs {peak_window[0]} to {peak_window[1]}.",
            f"The later minimum was epochs {later_window[0]} to {later_window[1]}.",
            "",
            "The complete patient-bootstrap curve is the DVC plot at",
            f"`{metrics['curves']['path']}`. It contains all 120 epochs for train error,",
            "validation error, 95% intervals, mAP50, and mAP50-95.",
            "",
            "## Metrics",
            "",
            "| Metric | Merged baseline | Extended run | Delta |",
            "| --- | ---: | ---: | ---: |",
            f"| Best validation mAP50 | {baseline_map50} | {best_map50} | {map50_delta} |",
            f"| Best validation mAP50-95 | {baseline_map50_95} | {best_map50_95} | "
            f"{map50_95_delta} |",
            f"| Fixed-endpoint test localization F1 | {baseline_test_f1} | {test_f1} | "
            f"{test_f1_delta} |",
            "",
            "The sealed test split was evaluated only after curve analysis. Each seed "
            "used its fixed epoch-120 checkpoint.",
            "",
            "## Per-class and held-out-site slices",
            "",
            "| Source class | Mean test localization F1 | Seed range |",
            "| --- | ---: | ---: |",
            class_rows,
            "",
            "| Held-out site | Mean test localization F1 | Seed range |",
            "| --- | ---: | ---: |",
            site_rows,
            "",
            "## Resources and provenance",
            "",
            f"The run used {resources['aggregate_gpu_seconds']:.1f} measured GPU-seconds "
            "against the "
            f"{resources['aggregate_gpu_ceiling_seconds']:,}-second cap. Peak allocated VRAM was "
            f"{resources['peak_vram_bytes'] / (1024**3):.2f} GiB.",
            "",
            f"The three runs recorded {checkpoint_count:,} checkpoint digests.",
            "The package lock digest was",
            f"`{package_lock}` and the starting weight digest was",
            f"`{starting_weights}`.",
            "",
            f"Prediction conversion rejected {curve_failures:,} curve instances and "
            f"{test_failures:,} sealed-test instances.",
            "",
            "This experiment does not establish clinical validity.",
            "",
        ]
    )


def report(params_path: str = str(PARAMS_FILE)) -> dict[str, object]:
    config = load_config(Path(params_path))
    analysis = read_json(OUTPUT_ROOT / "analysis" / "evidence.json")
    test = read_json(OUTPUT_ROOT / "test" / "evidence.json")
    if not isinstance(analysis, dict) or not isinstance(test, dict):
        raise TypeError("analysis and test evidence must be objects")
    metrics = metric_summary(analysis, test, config)
    write_json(REPORT_JSON_FILE, metrics)
    REPORT_MARKDOWN_FILE.write_text(_report_markdown(metrics, config), encoding="utf-8")
    return metrics


def report_json() -> str:
    return json.dumps(read_json(REPORT_JSON_FILE), sort_keys=True)
