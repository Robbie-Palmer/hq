from pathlib import Path
from typing import Any

import pytest
import torch
from data_artifacts.files import read_json, write_json
from ultralytics_extensions.checkpoints import load_safe_checkpoint

from pathologize_cell_analysis.learned_baseline import reporting
from pathologize_cell_analysis.learned_baseline.config import (
    JSON_REPORT,
    MARKDOWN_REPORT,
    OUTPUT_DIRECTORY,
    load_config,
    output_root,
)
from pathologize_cell_analysis.learned_baseline.reporting import report_learned_baseline


def test_checkpoint_loading_restricts_deserialization(tmp_path: Path) -> None:
    checkpoint_path = tmp_path / "checkpoint.pt"
    torch.save({"epoch": 3, "loss": torch.tensor([0.25])}, checkpoint_path)

    checkpoint = load_safe_checkpoint(torch, checkpoint_path)

    assert checkpoint["epoch"] == 3
    assert torch.equal(checkpoint["loss"], torch.tensor([0.25]))


def test_experiment_output_directory_is_pinned(tmp_path: Path) -> None:
    config = load_config()

    assert output_root(tmp_path, config) == tmp_path / OUTPUT_DIRECTORY

    escaped = config.model_copy(update={"output_directory": "../../outside"})
    with pytest.raises(ValueError, match="output directory must be"):
        output_root(tmp_path, escaped)


def _curve(box: bool) -> dict[str, Any]:
    suffix = "B" if box else "M"
    metrics = {
        f"metrics/mAP50({suffix})": {
            "first": 0.1,
            "best": 0.2,
            "best_epoch": 2,
            "final": 0.2,
        },
        f"metrics/mAP50-95({suffix})": {
            "first": 0.05,
            "best": 0.1,
            "best_epoch": 2,
            "final": 0.1,
        },
    }
    return {
        "completed_epochs": 2,
        "stopped_by": "epoch_ceiling",
        "convergence_assessment": "not_established_before_epoch_ceiling",
        "training_loss": {"first": 2.0, "final": 1.0},
        "validation_loss": {"first": 3.0, "final": 2.0},
        "metrics": metrics,
        "best_checkpoint": {
            "epoch": 2,
            "metrics": {key: value["best"] for key, value in metrics.items()},
        },
    }


def _evidence(config: Any) -> dict[str, Any]:
    localization = {"precision": 0.5, "recall": 0.5, "f1": 0.5}
    segmentation = {
        "localization_coverage": 0.8,
        "mean_instance_iou": 0.4,
        "mean_instance_dice": 0.5,
        "success_at_iou_0_5": 0.6,
    }
    resource = {
        "wall_seconds": 5.0,
        "cpu_seconds": 4.0,
        "gpu_seconds": 4.0,
        "peak_rss_bytes": 1000,
        "peak_vram_bytes": 2000,
    }
    return {
        "tasks": {
            "detect": {
                "localization": localization,
                "per_class": {
                    label: {"localization": localization} for label in config.ontology_labels
                },
                "held_out_site_slices": {"TE": {"localization": localization}},
            },
            "segment": {
                "localization": localization,
                "instance_segmentation": segmentation,
                "per_class": {
                    label: {"instance_segmentation": segmentation}
                    for label in config.ontology_labels
                },
                "held_out_site_slices": {"TE": {"instance_segmentation": segmentation}},
            },
        },
        "training_curves": {"detect": _curve(True), "segment": _curve(False)},
        "comparison": {
            "transparent_baseline": {
                "localization_f1": 0.3,
                "conditional_instance_mean_iou": 0.2,
            },
            "ultralytics": {
                "detection_localization_f1": 0.5,
                "segmentation_localization_f1": 0.5,
                "conditional_instance_mean_iou": 0.4,
            },
        },
        "resources": {
            "aggregate_gpu_seconds": 10.0,
            "aggregate_gpu_ceiling_seconds": 86400,
            "training": {"detect": resource},
            "inference": {"detect": {**resource, "gpu_seconds": 1.0}},
        },
        "failures": [],
    }


def test_ultralytics_report_writes_only_pinned_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = load_config()
    evidence = _evidence(config)
    evidence_path = tmp_path / OUTPUT_DIRECTORY / "evaluation/evidence.json"
    write_json(evidence_path, evidence)
    monkeypatch.setattr(reporting, "OUTPUT_ROOT", evidence_path.parents[1])
    monkeypatch.setattr(
        reporting,
        "JSON_REPORT_FILE",
        tmp_path / JSON_REPORT,
    )
    monkeypatch.setattr(
        reporting,
        "MARKDOWN_REPORT_FILE",
        tmp_path / MARKDOWN_REPORT,
    )

    observed = report_learned_baseline()

    assert "parameters" not in observed
    comparison: Any = observed["comparison"]
    assert "learned_baseline" in comparison
    assert "ultralytics" not in comparison
    detection: Any = observed["detection"]
    assert detection["box_map50_95"] == 0.1
    assert read_json(tmp_path / JSON_REPORT) == observed
    assert (
        (tmp_path / MARKDOWN_REPORT)
        .read_text(encoding="utf-8")
        .startswith("# NuCLS learned baseline")
    )
