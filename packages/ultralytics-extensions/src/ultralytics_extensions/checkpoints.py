from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ResumeEvidence:
    checkpoint: Path
    completed_epochs: int
    elapsed_seconds_upper_bound: float


def _safe_checkpoint_globals() -> list[type[Any]]:
    from torch.nn import (
        BatchNorm2d,
        Conv2d,
        ConvTranspose2d,
        Identity,
        MaxPool2d,
        ModuleList,
        Sequential,
        SiLU,
        Upsample,
    )
    from ultralytics.nn.modules.block import (
        C2PSA,
        SPPF,
        Attention,
        Bottleneck,
        C3k,
        C3k2,
        Proto26,
        PSABlock,
    )
    from ultralytics.nn.modules.conv import Concat, Conv, DWConv
    from ultralytics.nn.modules.head import Detect, Segment26
    from ultralytics.nn.tasks import DetectionModel, SegmentationModel
    from ultralytics.utils import IterableSimpleNamespace

    return [
        Attention,
        BatchNorm2d,
        Bottleneck,
        C2PSA,
        C3k,
        C3k2,
        Concat,
        Conv,
        Conv2d,
        ConvTranspose2d,
        DWConv,
        Detect,
        DetectionModel,
        Identity,
        IterableSimpleNamespace,
        MaxPool2d,
        ModuleList,
        PSABlock,
        Proto26,
        SPPF,
        Segment26,
        SegmentationModel,
        Sequential,
        SiLU,
        Upsample,
    ]


def load_safe_checkpoint(torch_module: Any, checkpoint_path: Path) -> dict[str, Any]:
    with torch_module.serialization.safe_globals(_safe_checkpoint_globals()):
        checkpoint = torch_module.load(
            checkpoint_path,
            map_location="cpu",
            weights_only=True,
        )
    if not isinstance(checkpoint, dict):
        raise TypeError("Ultralytics checkpoint must be a dictionary")
    return checkpoint


def checkpoint_epoch(torch_module: Any, checkpoint_path: Path) -> int:
    checkpoint = load_safe_checkpoint(torch_module, checkpoint_path)
    epoch = checkpoint.get("epoch")
    if not isinstance(epoch, int):
        raise TypeError("Ultralytics checkpoint epoch must be an integer")
    return epoch


def training_rows(task_output: Path) -> list[dict[str, float]]:
    results_path = task_output / "results.csv"
    if not results_path.is_file():
        return []
    with results_path.open(encoding="utf-8", newline="") as source:
        return [
            {key.strip(): float(value) for key, value in row.items()}
            for row in csv.DictReader(source)
        ]


def resume_evidence(task_output: Path) -> ResumeEvidence | None:
    if not task_output.exists():
        return None
    rows = training_rows(task_output)
    checkpoint = task_output / "weights" / "last.pt"
    if not rows or not checkpoint.is_file():
        return None
    return ResumeEvidence(
        checkpoint=checkpoint,
        completed_epochs=int(rows[-1]["epoch"]),
        elapsed_seconds_upper_bound=rows[-1]["time"],
    )
