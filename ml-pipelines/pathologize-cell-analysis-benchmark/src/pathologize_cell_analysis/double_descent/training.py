from __future__ import annotations

import math
import os
import resource
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from data_artifacts.files import read_json, sha256_file, write_json
from ultralytics_extensions.checkpoints import (
    checkpoint_epoch,
    load_safe_checkpoint,
    training_rows,
)

from ..contracts import DoubleDescentConfig
from ..learned_baseline.config import LAYOUT_DIRECTORY, WEIGHTS_DIRECTORY
from .config import PARAMS_FILE, PROJECT_ROOT, load_config, seed_output


@dataclass
class SafetyMonitor:
    minimum_training_loss: float = math.inf
    best_validation_loss: float = math.inf
    best_map50_95: float = -math.inf
    divergent_training_epochs: int = 0
    regressed_validation_epochs: int = 0
    stop_reason: str | None = None
    deadline_reached: bool = False


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def training_arguments(config: DoubleDescentConfig, seed: int) -> dict[str, object]:
    training = config.training
    augmentation = training.augmentation
    return {
        "data": str(PROJECT_ROOT / LAYOUT_DIRECTORY / "detect.yaml"),
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
        "seed": seed,
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
        "save_period": config.checkpoint_cadence_epochs,
        "val": True,
        "verbose": True,
    }


def _finite_scalar(value: Any) -> float | None:
    if value is None:
        return None
    try:
        observed = float(value.detach().float().sum().item())
    except (AttributeError, TypeError, ValueError):
        return None
    return observed if math.isfinite(observed) else math.nan


def monitor_training_batch(trainer: Any, state: SafetyMonitor) -> None:
    loss = _finite_scalar(getattr(trainer, "loss", None))
    if loss is not None and not math.isfinite(loss):
        trainer.stop = True
        state.stop_reason = "non_finite_training_loss"


def monitor_training_epoch(
    trainer: Any,
    state: SafetyMonitor,
    config: DoubleDescentConfig,
) -> None:
    training_loss = _finite_scalar(getattr(trainer, "tloss", None))
    metrics = {
        str(key): float(value)
        for key, value in getattr(trainer, "metrics", {}).items()
        if isinstance(value, (float, int))
    }
    if training_loss is None or not metrics:
        return
    if not math.isfinite(training_loss) or any(not math.isfinite(v) for v in metrics.values()):
        trainer.stop = True
        state.stop_reason = "non_finite_validation_metric"
        return
    validation_losses = [value for key, value in metrics.items() if key.startswith("val/")]
    map50_95 = metrics.get("metrics/mAP50-95(B)")
    if not validation_losses or map50_95 is None:
        return
    validation_loss = sum(validation_losses)
    training_diverged = training_loss > (
        state.minimum_training_loss * config.safety.training_loss_multiple
    )
    state.divergent_training_epochs = (
        state.divergent_training_epochs + 1 if training_diverged else 0
    )
    validation_regressed = (
        validation_loss > state.best_validation_loss * config.safety.validation_loss_multiple
        and map50_95 < state.best_map50_95
    )
    state.regressed_validation_epochs = (
        state.regressed_validation_epochs + 1 if validation_regressed else 0
    )
    state.minimum_training_loss = min(state.minimum_training_loss, training_loss)
    state.best_validation_loss = min(state.best_validation_loss, validation_loss)
    state.best_map50_95 = max(state.best_map50_95, map50_95)
    if state.divergent_training_epochs >= config.safety.training_loss_epochs:
        trainer.stop = True
        state.stop_reason = "persistent_training_divergence"
    elif state.regressed_validation_epochs >= config.safety.validation_regression_epochs:
        trainer.stop = True
        state.stop_reason = "persistent_validation_regression"


def stop_at_deadline(trainer: Any, state: SafetyMonitor, deadline: float) -> None:
    if time.monotonic() >= deadline:
        trainer.stop = True
        state.stop_reason = "per_seed_wall_time"
        state.deadline_reached = True


def _verify_inputs(config: DoubleDescentConfig) -> tuple[Path, Path]:
    weights = PROJECT_ROOT / WEIGHTS_DIRECTORY / config.model.weights
    definition = PROJECT_ROOT / WEIGHTS_DIRECTORY / Path(config.model.definition).name
    if sha256_file(weights) != config.model.weights_sha256:
        raise ValueError("starting weight digest differs from the predeclaration")
    if sha256_file(definition) != config.model.definition_sha256:
        raise ValueError("model definition digest differs from the predeclaration")
    if not (PROJECT_ROOT / LAYOUT_DIRECTORY / "manifest.json").is_file():
        raise FileNotFoundError("frozen learned-layout manifest is missing")
    free_bytes = shutil.disk_usage(PROJECT_ROOT).free
    if free_bytes < config.limits.minimum_free_disk_bytes:
        raise RuntimeError("free disk is below the predeclared checkpoint floor")
    return weights, definition


def _state_path(output: Path) -> Path:
    return output / "state.json"


def _prior_state(output: Path) -> dict[str, Any]:
    path = _state_path(output)
    if not path.is_file():
        return {}
    value = read_json(path)
    if not isinstance(value, dict):
        raise TypeError("double-descent training state must be an object")
    return value


def _write_state(
    output: Path,
    state: SafetyMonitor,
    wall_start: float,
    prior_seconds: float,
    cuda: Any,
    status: str,
) -> None:
    write_json(
        _state_path(output),
        {
            "status": status,
            "consumed_gpu_seconds_upper_bound": prior_seconds + time.monotonic() - wall_start,
            "peak_vram_bytes": int(cuda.max_memory_allocated()),
            "stop_reason": state.stop_reason,
        },
    )


def _resume_model(output: Path, yolo: Any, torch_module: Any) -> tuple[Any, float, bool]:
    rows = training_rows(output)
    checkpoint = output / "weights" / "last.pt"
    if not rows or not checkpoint.is_file():
        if output.exists():
            shutil.rmtree(output)
        return None, 0.0, False
    observed_epoch = checkpoint_epoch(torch_module, checkpoint)
    if observed_epoch >= 0 and observed_epoch + 1 != int(rows[-1]["epoch"]):
        raise ValueError("resume checkpoint epoch differs from results.csv")
    stored = _prior_state(output)
    prior_seconds = max(
        float(rows[-1]["time"]),
        float(stored.get("consumed_gpu_seconds_upper_bound", 0.0)),
    )
    model = yolo(str(checkpoint), task="detect")
    checkpoint_state = load_safe_checkpoint(torch_module, checkpoint)
    required = {"optimizer", "ema", "scaler", "stopper", "train_args"}
    if not required.issubset(checkpoint_state):
        raise ValueError("resume checkpoint lacks exact optimizer state")
    return model, prior_seconds, True


def checkpoint_index(output: Path, torch_module: Any) -> list[dict[str, object]]:
    rows = training_rows(output)
    if not rows:
        raise ValueError("training results are empty")
    completed_epochs = int(rows[-1]["epoch"])
    by_epoch: dict[int, Path] = {}
    for path in sorted((output / "weights").glob("epoch*.pt")):
        epoch = checkpoint_epoch(torch_module, path) + 1
        if epoch > 0:
            by_epoch[epoch] = path
    if completed_epochs not in by_epoch:
        by_epoch[completed_epochs] = output / "weights" / "last.pt"
    missing = sorted(set(range(1, completed_epochs + 1)) - set(by_epoch))
    if missing:
        raise ValueError(f"per-epoch checkpoints are incomplete: {missing[:5]}")
    return [
        {
            "epoch": epoch,
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": sha256_file(path),
        }
        for epoch, path in sorted(by_epoch.items())
    ]


def _validate_resources(config: DoubleDescentConfig, gpu_seconds: float, peak_vram: int) -> None:
    if gpu_seconds > config.limits.per_seed_gpu_seconds:
        raise RuntimeError("per-seed GPU-time ceiling exceeded")
    if peak_vram > config.limits.maximum_peak_vram_bytes:
        raise RuntimeError("peak VRAM ceiling exceeded")


def train(seed: int, params_path: str = str(PARAMS_FILE)) -> dict[str, object]:  # pragma: no cover
    config = load_config(Path(params_path))
    if seed not in config.seeds:
        raise ValueError(f"seed {seed} is not predeclared")
    weights, definition = _verify_inputs(config)
    output = seed_output(seed)
    completed = output / "run.json"
    if completed.is_file():
        result = read_json(completed)
        if not isinstance(result, dict):
            raise TypeError("completed run evidence must be an object")
        return cast(dict[str, object], result)
    os.environ["YOLO_CONFIG_DIR"] = str(output / "ultralytics-config")
    import torch
    from torch import cuda
    from ultralytics import YOLO, settings

    if not cuda.is_available():
        raise RuntimeError("the predeclared CUDA accelerator is unavailable")
    settings.update({"datasets_dir": str(PROJECT_ROOT)})
    model, prior_seconds, resumed = _resume_model(output, YOLO, torch)
    if model is None:
        output.mkdir(parents=True, exist_ok=True)
        model = YOLO(str(weights), task="detect")
    state = SafetyMonitor()
    wall_start = time.monotonic()
    cpu_start = time.process_time()
    deadline = wall_start + config.limits.per_seed_wall_seconds - prior_seconds
    cuda.reset_peak_memory_stats()
    start_event = cuda.Event(enable_timing=True)
    end_event = cuda.Event(enable_timing=True)
    model.add_callback("on_train_batch_end", lambda trainer: monitor_training_batch(trainer, state))
    model.add_callback(
        "on_fit_epoch_end", lambda trainer: monitor_training_epoch(trainer, state, config)
    )
    model.add_callback(
        "on_fit_epoch_end", lambda trainer: stop_at_deadline(trainer, state, deadline)
    )
    model.add_callback(
        "on_fit_epoch_end",
        lambda _trainer: _write_state(output, state, wall_start, prior_seconds, cuda, "running"),
    )
    start_event.record()
    try:
        if resumed:
            model.train(resume=True)
        else:
            model.train(
                **training_arguments(config, seed),
                project=str(output.parent),
                name=output.name,
                exist_ok=False,
            )
        end_event.record()
        cuda.synchronize()
        continuation_gpu_seconds = start_event.elapsed_time(end_event) / 1000
        gpu_seconds = prior_seconds + continuation_gpu_seconds
        peak_vram = int(cuda.max_memory_allocated())
        _validate_resources(config, gpu_seconds, peak_vram)
        checkpoints = checkpoint_index(output, torch)
        rows = training_rows(output)
        result: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment_id": config.experiment_id,
            "seed": seed,
            "completed_epochs": int(rows[-1]["epoch"]),
            "stop_reason": state.stop_reason or "epoch_ceiling",
            "package": config.package.model_dump(mode="json"),
            "training": config.training.model_dump(mode="json"),
            "starting_weights": {
                "path": weights.relative_to(PROJECT_ROOT).as_posix(),
                "sha256": sha256_file(weights),
            },
            "model_definition": {
                "path": definition.relative_to(PROJECT_ROOT).as_posix(),
                "sha256": sha256_file(definition),
            },
            "package_lock": {"path": "uv.lock", "sha256": sha256_file(PROJECT_ROOT / "uv.lock")},
            "results": {
                "path": (output / "results.csv").relative_to(PROJECT_ROOT).as_posix(),
                "sha256": sha256_file(output / "results.csv"),
            },
            "checkpoints": checkpoints,
            "resources": {
                "wall_seconds": prior_seconds + time.monotonic() - wall_start,
                "cpu_seconds": time.process_time() - cpu_start,
                "gpu_seconds": gpu_seconds,
                "peak_rss_bytes": _peak_rss_bytes(),
                "peak_vram_bytes": peak_vram,
                "resumed": resumed,
            },
        }
        shutil.rmtree(output / "ultralytics-config", ignore_errors=True)
        write_json(completed, result)
        _write_state(output, state, wall_start, prior_seconds, cuda, "complete")
    except BaseException:
        _write_state(output, state, wall_start, prior_seconds, cuda, "failed")
        raise
    else:
        return result
    finally:
        for cache_path in (PROJECT_ROOT / LAYOUT_DIRECTORY).rglob("*.cache"):
            cache_path.unlink()
        shutil.rmtree(output / "ultralytics-config", ignore_errors=True)
