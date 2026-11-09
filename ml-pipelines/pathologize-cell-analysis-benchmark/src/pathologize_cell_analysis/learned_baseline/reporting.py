from __future__ import annotations

import textwrap
from typing import Any

from data_artifacts.files import read_json, write_json

from ..contracts import LearnedBaselineConfig
from .config import (
    JSON_REPORT_FILE,
    MARKDOWN_REPORT_FILE,
    OUTPUT_ROOT,
    load_config,
)

THREE_COLUMN_TABLE_ALIGNMENT = "| --- | ---: | ---: |"


def _number(value: float | int) -> str:
    if isinstance(value, int):
        return f"{value:,}"
    return f"{value:.4f}"


def _localization_metrics(values: dict[str, Any]) -> dict[str, float]:
    return {key: float(values[key]) for key in ("precision", "recall", "f1")}


def _segmentation_metrics(values: dict[str, Any]) -> dict[str, float]:
    keys = (
        "localization_coverage",
        "mean_instance_iou",
        "mean_instance_dice",
        "success_at_iou_0_5",
    )
    return {key: float(values[key]) for key in keys}


def _resource_metrics(values: dict[str, Any]) -> dict[str, float | int]:
    keys = ("wall_seconds", "cpu_seconds", "gpu_seconds", "peak_rss_bytes", "peak_vram_bytes")
    return {key: values[key] for key in keys}


def _comparison(evidence: dict[str, Any]) -> dict[str, Any]:
    source = evidence["comparison"]
    return {
        "transparent_baseline": source["transparent_baseline"],
        "learned_baseline": source["learned_baseline"],
    }


def metric_summary(evidence: dict[str, Any]) -> dict[str, object]:
    tasks = evidence["tasks"]
    curves = evidence["training_curves"]
    resources = evidence["resources"]
    comparison = _comparison(evidence)
    failures = evidence["failures"]
    detection = tasks["detect"]
    segmentation = tasks["segment"]
    return {
        "detection": {
            "localization": _localization_metrics(detection["localization"]),
            "box_map50": curves["detect"]["best_checkpoint"]["metrics"]["metrics/mAP50(B)"],
            "box_map50_95": curves["detect"]["best_checkpoint"]["metrics"]["metrics/mAP50-95(B)"],
            "per_class": {
                label: _localization_metrics(values["localization"])
                for label, values in detection["per_class"].items()
            },
            "held_out_sites": {
                site: _localization_metrics(values["localization"])
                for site, values in detection["held_out_site_slices"].items()
            },
        },
        "segmentation": {
            "localization": _localization_metrics(segmentation["localization"]),
            "instance_segmentation": _segmentation_metrics(segmentation["instance_segmentation"]),
            "mask_map50": curves["segment"]["best_checkpoint"]["metrics"]["metrics/mAP50(M)"],
            "mask_map50_95": curves["segment"]["best_checkpoint"]["metrics"]["metrics/mAP50-95(M)"],
            "per_class": {
                label: _segmentation_metrics(values["instance_segmentation"])
                for label, values in segmentation["per_class"].items()
            },
            "held_out_sites": {
                site: _segmentation_metrics(values["instance_segmentation"])
                for site, values in segmentation["held_out_site_slices"].items()
            },
        },
        "comparison": comparison,
        "resources": {
            "aggregate_gpu_seconds": resources["aggregate_gpu_seconds"],
            "training": {
                task: _resource_metrics(values) for task, values in resources["training"].items()
            },
            "inference": {
                task: _resource_metrics(values) for task, values in resources["inference"].items()
            },
        },
        "failure_count": len(failures),
    }


def _metric_report_row(label: str, curve: dict[str, Any], key: str) -> str:
    metric = curve["metrics"][key]
    checkpoint = curve["best_checkpoint"]
    return (
        f"| {label} | {_number(metric['first'])} | {_number(metric['best'])} "
        f"({metric['best_epoch']}) | {_number(metric['final'])} | "
        f"{_number(checkpoint['metrics'][key])} |"
    )


def _report_markdown(evidence: dict[str, Any], config: LearnedBaselineConfig) -> str:
    tasks = evidence["tasks"]
    comparison = _comparison(evidence)
    resources = evidence["resources"]
    detection = tasks["detect"]
    segmentation = tasks["segment"]
    curves = evidence["training_curves"]
    detect_curve = curves["detect"]
    segment_curve = curves["segment"]
    class_lines: list[str] = []
    for label, values in detection["per_class"].items():
        mean_iou = segmentation["per_class"][label]["instance_segmentation"]["mean_instance_iou"]
        class_lines.append(
            f"| `{label}` | {_number(values['localization']['f1'])} | {_number(mean_iou)} |"
        )
    class_rows = "\n".join(class_lines)
    site_lines: list[str] = []
    for site, values in detection["held_out_site_slices"].items():
        mean_iou = segmentation["held_out_site_slices"][site]["instance_segmentation"][
            "mean_instance_iou"
        ]
        site_lines.append(
            f"| `{site}` | {_number(values['localization']['f1'])} | {_number(mean_iou)} |"
        )
    site_rows = "\n".join(site_lines)
    failures = evidence["failures"]
    lines = [
        "# NuCLS learned baseline",
        "",
        textwrap.fill(
            "This non-clinical DVC experiment trains YOLO26 nano detection and "
            "instance-segmentation models on the frozen public NuCLS folds. Pathologize "
            "records, not Ultralytics-native metrics, are the evaluation boundary.",
            width=120,
        ),
        "",
        "## Task results",
        "",
        "| Metric | Transparent baseline | Learned baseline |",
        THREE_COLUMN_TABLE_ALIGNMENT,
        "| Detection localization F1 | "
        f"{_number(comparison['transparent_baseline']['localization_f1'])} | "
        f"{_number(comparison['learned_baseline']['detection_localization_f1'])} |",
        "| Conditional polygon mean IoU | "
        f"{_number(comparison['transparent_baseline']['conditional_instance_mean_iou'])} | "
        f"{_number(comparison['learned_baseline']['conditional_instance_mean_iou'])} |",
        "",
        "## Learning curves and convergence",
        "",
        "| Task | Epochs | Stop | Train loss first/final | Val loss first/final | Convergence |",
        "| --- | ---: | --- | ---: | ---: | --- |",
        f"| Detection | {detect_curve['completed_epochs']} | `{detect_curve['stopped_by']}` | "
        f"{_number(detect_curve['training_loss']['first'])} / "
        f"{_number(detect_curve['training_loss']['final'])} | "
        f"{_number(detect_curve['validation_loss']['first'])} / "
        f"{_number(detect_curve['validation_loss']['final'])} | "
        f"`{detect_curve['convergence_assessment']}` |",
        f"| Segmentation | {segment_curve['completed_epochs']} | "
        f"`{segment_curve['stopped_by']}` | "
        f"{_number(segment_curve['training_loss']['first'])} / "
        f"{_number(segment_curve['training_loss']['final'])} | "
        f"{_number(segment_curve['validation_loss']['first'])} / "
        f"{_number(segment_curve['validation_loss']['final'])} | "
        f"`{segment_curve['convergence_assessment']}` |",
        "",
        "| Task metric | First | Best (epoch) | Final | Best-checkpoint value |",
        "| --- | ---: | ---: | ---: | ---: |",
        _metric_report_row("Detection box mAP50", detect_curve, "metrics/mAP50(B)"),
        _metric_report_row("Detection box mAP50-95", detect_curve, "metrics/mAP50-95(B)"),
        _metric_report_row("Segmentation mask mAP50", segment_curve, "metrics/mAP50(M)"),
        _metric_report_row("Segmentation mask mAP50-95", segment_curve, "metrics/mAP50-95(M)"),
        "",
        "## Per-class and held-out-site slices",
        "",
        "| Source class | Detection localization F1 | Segmentation mean IoU |",
        THREE_COLUMN_TABLE_ALIGNMENT,
        class_rows,
        "",
        "| Held-out site | Detection localization F1 | Segmentation mean IoU |",
        THREE_COLUMN_TABLE_ALIGNMENT,
        site_rows,
        "",
        "## Resources and failures",
        "",
        f"Aggregate measured GPU time was {resources['aggregate_gpu_seconds']:,.1f} seconds "
        f"against the {resources['aggregate_gpu_ceiling_seconds']:,}-second ceiling.",
        "",
        f"Prediction conversion rejected {len(failures):,} instances. "
        "The cached evaluation evidence records each rejection.",
        "",
        "## Provenance",
        "",
        textwrap.fill(
            f"Package: `ultralytics=={config.package.version}` under `{config.package.license}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            f"Detection weights: `{config.models['detect'].weights}` at "
            f"`{config.models['detect'].weights_sha256}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            f"Segmentation weights: `{config.models['segment'].weights}` at "
            f"`{config.models['segment'].weights_sha256}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            "DVC tracks the parameter, package-lock, split-manifest, checkpoint, prediction, "
            "and evaluation dependencies. Use DVC Experiments for parameter variations.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        "",
        "This experiment does not establish clinical validity.",
        "",
    ]
    return "\n".join(lines)


def report_learned_baseline() -> dict[str, object]:
    config = load_config()
    evidence = read_json(OUTPUT_ROOT / "evaluation" / "evidence.json")
    if not isinstance(evidence, dict):
        raise TypeError("learned-baseline evidence must be a JSON object")
    metrics = metric_summary(evidence)
    write_json(JSON_REPORT_FILE, metrics)
    MARKDOWN_REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    MARKDOWN_REPORT_FILE.write_text(_report_markdown(evidence, config), encoding="utf-8")
    return metrics
