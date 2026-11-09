from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from ..contracts import LearnedBaselineConfig
from .config import LAYOUT_DIRECTORY

Task = Literal["detect", "segment"]


@dataclass
class TrainingMonitor:
    best_map50_95: float = -math.inf
    best_validation_loss: float = math.inf
    regression_epochs: int = 0
    stop_reason: str | None = None


def training_arguments(
    experiment: LearnedBaselineConfig, root: Path, task: Task
) -> dict[str, object]:
    training = experiment.training
    augmentation = training.augmentation
    return {
        "data": str(root / LAYOUT_DIRECTORY / f"{task}.yaml"),
        "epochs": training.epochs,
        "patience": training.patience,
        "batch": training.batch,
        "imgsz": training.image_size,
        "device": training.device,
        "workers": training.workers,
        "optimizer": training.optimizer,
        "lr0": training.initial_learning_rate,
        "lrf": training.final_learning_rate_fraction,
        "momentum": training.momentum,
        "weight_decay": training.weight_decay,
        "warmup_epochs": training.warmup_epochs,
        "cos_lr": training.cosine_learning_rate,
        "amp": training.amp,
        "deterministic": training.deterministic,
        "seed": experiment.seeds[task],
        "cache": training.cache,
        "rect": training.rectangular_batches,
        "multi_scale": training.multi_scale,
        "close_mosaic": training.close_mosaic_epochs,
        "hsv_h": augmentation.hsv_h,
        "hsv_s": augmentation.hsv_s,
        "hsv_v": augmentation.hsv_v,
        "degrees": augmentation.degrees,
        "translate": augmentation.translate,
        "scale": augmentation.scale,
        "shear": augmentation.shear,
        "perspective": augmentation.perspective,
        "flipud": augmentation.flip_up_down,
        "fliplr": augmentation.flip_left_right,
        "bgr": augmentation.bgr,
        "mosaic": augmentation.mosaic,
        "mixup": augmentation.mixup,
        "cutmix": augmentation.cutmix,
        "copy_paste": augmentation.copy_paste,
        "cls_remap": False,
        "plots": False,
        "save": True,
        "save_period": -1,
        "val": True,
        "verbose": True,
    }


def seed_training_monitor(rows: list[dict[str, float]]) -> TrainingMonitor:
    state = TrainingMonitor()
    for row in rows:
        map50_95 = row["metrics/mAP50-95(B)"]
        validation_loss = sum(value for key, value in row.items() if key.startswith("val/"))
        if not math.isfinite(map50_95) or not math.isfinite(validation_loss):
            state.stop_reason = "non_finite_validation_metric"
            return state
        regressed = (
            validation_loss > state.best_validation_loss * 1.1 and map50_95 < state.best_map50_95
        )
        state.regression_epochs = state.regression_epochs + 1 if regressed else 0
        state.best_map50_95 = max(state.best_map50_95, map50_95)
        state.best_validation_loss = min(state.best_validation_loss, validation_loss)
    return state


def monitor_training(trainer: Any, state: TrainingMonitor, patience: int) -> None:
    loss = getattr(trainer, "loss", None)
    if loss is not None and not bool(loss.isfinite().all()):
        trainer.stop = True
        state.stop_reason = "non_finite_training_loss"
        return
    metrics = {
        str(key): float(value)
        for key, value in getattr(trainer, "metrics", {}).items()
        if isinstance(value, (float, int))
    }
    if not metrics:
        return
    if any(not math.isfinite(value) for value in metrics.values()):
        trainer.stop = True
        state.stop_reason = "non_finite_validation_metric"
        return
    validation_losses = [value for key, value in metrics.items() if key.startswith("val/")]
    map50_95 = metrics.get("metrics/mAP50-95(B)")
    if not validation_losses or map50_95 is None:
        return
    validation_loss = sum(validation_losses)
    regressed = (
        validation_loss > state.best_validation_loss * 1.1 and map50_95 < state.best_map50_95
    )
    state.regression_epochs = state.regression_epochs + 1 if regressed else 0
    state.best_map50_95 = max(state.best_map50_95, map50_95)
    state.best_validation_loss = min(state.best_validation_loss, validation_loss)
    if state.regression_epochs >= patience:
        trainer.stop = True
        state.stop_reason = "persistent_validation_regression"
