from __future__ import annotations

import math
import os
import resource
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from data_artifacts.files import sha256_file, write_json
from ultralytics_extensions.checkpoints import (
    ResumeEvidence,
    load_safe_checkpoint,
    resume_evidence,
    training_rows,
)

from .contracts import AcceleratorResourceEvidence, UltralyticsConfig
from .ultralytics_config import (
    ULTRALYTICS_PARAMS_FILE,
    load_ultralytics_config,
    output_root,
    project_root,
)

Task = Literal["detect", "segment"]


@dataclass
class DeadlineState:
    stopped: bool = False


@dataclass
class TrainingMonitor:
    best_map50_95: float = -math.inf
    best_validation_loss: float = math.inf
    regression_epochs: int = 0
    stop_reason: str | None = None


def training_arguments(experiment: UltralyticsConfig, root: Path, task: Task) -> dict[str, object]:
    training = experiment.training
    augmentation = training.augmentation
    return {
        "data": str(root / experiment.layout_directory / f"{task}.yaml"),
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


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _verify_training_inputs(
    experiment: UltralyticsConfig, root: Path, task: Task
) -> tuple[Path, Path]:
    model = experiment.models[task]
    weights = root / experiment.weights_directory / model.weights
    definition = root / experiment.weights_directory / Path(model.definition).name
    if sha256_file(weights) != model.weights_sha256:
        raise ValueError(f"starting weight digest differs for {task}")
    if sha256_file(definition) != model.definition_sha256:
        raise ValueError(f"model definition digest differs for {task}")
    layout_manifest = root / experiment.layout_directory / "manifest.json"
    if not layout_manifest.is_file():
        raise FileNotFoundError("derived Ultralytics layout manifest is missing")
    return weights, definition


def _clear_ultralytics_caches(layout_root: Path) -> None:
    for cache_path in layout_root.rglob("*.cache"):
        cache_path.unlink()


def _clear_ultralytics_runtime_config(output_root: Path) -> None:
    shutil.rmtree(output_root / "ultralytics-config", ignore_errors=True)


def _seed_training_monitor(rows: list[dict[str, float]]) -> TrainingMonitor:
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


def _monitor_training(trainer: Any, state: TrainingMonitor, patience: int) -> None:
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


def _load_training_model(
    yolo: Any,
    torch_module: Any,
    task: Task,
    weights: Path,
    resume: ResumeEvidence | None,
) -> Any:
    if resume is None:
        return yolo(str(weights), task=task)
    checkpoint = load_safe_checkpoint(torch_module, resume.checkpoint)
    required_state = {"optimizer", "ema", "scaler", "stopper", "train_args"}
    if not required_state.issubset(checkpoint):
        raise ValueError(f"{task} checkpoint lacks exact resume state")
    if int(checkpoint["epoch"]) + 1 != resume.completed_epochs:
        raise ValueError(f"{task} checkpoint epoch differs from results.csv")
    return yolo(str(resume.checkpoint), task=task)


def _fit_training_model(
    model: Any,
    resume: ResumeEvidence | None,
    arguments: dict[str, object],
    output_root: Path,
    task: Task,
) -> None:
    if resume is not None:
        model.train(resume=True)
        return
    model.train(
        **arguments,
        project=str(output_root),
        name=task,
        exist_ok=False,
    )


def _clean_failed_training_output(output_root: Path, output_root_existed: bool) -> None:
    has_checkpoint = any(
        (output_root / task / "weights" / "last.pt").is_file() for task in ("detect", "segment")
    )
    if not output_root_existed and not has_checkpoint:
        shutil.rmtree(output_root, ignore_errors=True)


def train_ultralytics(  # pragma: no cover
    params_path: Path = ULTRALYTICS_PARAMS_FILE,
) -> dict[str, object]:
    experiment = load_ultralytics_config(params_path)
    root = project_root(params_path)
    training_root = output_root(root, experiment) / "training"
    if (training_root / "manifest.json").exists():
        raise FileExistsError(f"training output already exists: {training_root}")
    output_root_existed = training_root.exists()
    training_root.mkdir(parents=True, exist_ok=True)
    complete = False
    resources: dict[str, object] = {}
    checkpoints: dict[str, object] = {}
    aggregate_gpu_seconds = experiment.prior_failed_gpu_seconds_upper_bound
    try:
        os.environ["YOLO_CONFIG_DIR"] = str(training_root / "ultralytics-config")
        import torch
        from torch import cuda
        from ultralytics import YOLO, settings

        if not cuda.is_available():
            raise RuntimeError("the configured CUDA accelerator is unavailable")
        settings.update({"datasets_dir": str(root)})
        for task in ("detect", "segment"):
            weights, definition = _verify_training_inputs(experiment, root, task)
            task_output = training_root / task
            resume = resume_evidence(task_output)
            rows = training_rows(task_output)
            prior_task_seconds = resume.elapsed_seconds_upper_bound if resume else 0.0
            deadline = (
                time.monotonic() + experiment.limits.per_task_wall_seconds - prior_task_seconds
            )
            wall_start = time.monotonic()
            cpu_start = time.process_time()
            cuda.reset_peak_memory_stats()
            start_event = cuda.Event(enable_timing=True)
            end_event = cuda.Event(enable_timing=True)
            deadline_state = DeadlineState()
            monitor = _seed_training_monitor(rows)
            if monitor.stop_reason is not None:
                raise RuntimeError(f"cannot resume {task}: {monitor.stop_reason}")

            def stop_at_deadline(
                trainer: Any,
                deadline_value: float = deadline,
                state: DeadlineState = deadline_state,
            ) -> None:
                if time.monotonic() >= deadline_value:
                    trainer.stop = True
                    state.stopped = True

            model = _load_training_model(YOLO, torch, task, weights, resume)
            model.add_callback("on_train_epoch_end", stop_at_deadline)
            model.add_callback(
                "on_fit_epoch_end",
                lambda trainer, state=monitor, patience=experiment.training.patience: (
                    _monitor_training(trainer, state, patience)
                ),
            )
            arguments = training_arguments(experiment, root, task)
            start_event.record()
            _fit_training_model(model, resume, arguments, training_root, task)
            end_event.record()
            cuda.synchronize()
            continuation_gpu_seconds = start_event.elapsed_time(end_event) / 1000
            gpu_seconds = prior_task_seconds + continuation_gpu_seconds
            aggregate_gpu_seconds += gpu_seconds
            if aggregate_gpu_seconds > experiment.limits.aggregate_gpu_seconds:
                raise RuntimeError("aggregate GPU-time ceiling exceeded")
            peak_vram = int(cuda.max_memory_allocated())
            if peak_vram > experiment.limits.maximum_peak_vram_bytes:
                raise RuntimeError("peak VRAM ceiling exceeded")
            if time.monotonic() > deadline and not deadline_state.stopped:
                raise RuntimeError("training exceeded its wall-time ceiling")
            best = task_output / "weights" / "best.pt"
            last = task_output / "weights" / "last.pt"
            if not best.is_file() or not last.is_file():
                raise FileNotFoundError(f"Ultralytics did not write both checkpoints for {task}")
            resources[task] = AcceleratorResourceEvidence(
                wall_seconds=prior_task_seconds + time.monotonic() - wall_start,
                cpu_seconds=time.process_time() - cpu_start,
                gpu_seconds=gpu_seconds,
                peak_rss_bytes=_peak_rss_bytes(),
                peak_vram_bytes=peak_vram,
                accelerator="cuda:0",
                measurement=(
                    "Ultralytics cumulative elapsed time as a conservative interrupted-run "
                    "GPU upper bound, plus CUDA event continuation time; PyTorch peak "
                    "allocated memory"
                    if resume is not None
                    else "CUDA event elapsed time and PyTorch peak allocated memory"
                ),
                wall_ceiling_seconds=experiment.limits.per_task_wall_seconds,
                aggregate_gpu_ceiling_seconds=experiment.limits.aggregate_gpu_seconds,
            ).model_dump(mode="json")
            checkpoints[task] = {
                "starting_weights": weights.relative_to(root).as_posix(),
                "starting_weights_sha256": sha256_file(weights),
                "model_definition": definition.relative_to(root).as_posix(),
                "model_definition_sha256": sha256_file(definition),
                "best": best.relative_to(root).as_posix(),
                "best_sha256": sha256_file(best),
                "last": last.relative_to(root).as_posix(),
                "last_sha256": sha256_file(last),
                "stopped_for_wall_time": deadline_state.stopped,
                "stop_reason": monitor.stop_reason,
                "resumed_from_interruption": resume is not None,
                "resume_checkpoint": (
                    resume.checkpoint.relative_to(root).as_posix() if resume else None
                ),
                "completed_epochs_before_resume": (resume.completed_epochs if resume else 0),
                "interrupted_elapsed_seconds_upper_bound": prior_task_seconds,
                "continuation_cuda_event_seconds": continuation_gpu_seconds,
            }
        result: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment_id": experiment.experiment_id,
            "package": experiment.package.model_dump(mode="json"),
            "package_lock": "uv.lock",
            "package_lock_sha256": sha256_file(root / "uv.lock"),
            "training_config": experiment.training.model_dump(mode="json"),
            "seeds": experiment.seeds,
            "resources": resources,
            "prior_failed_gpu_seconds_upper_bound": (
                experiment.prior_failed_gpu_seconds_upper_bound
            ),
            "aggregate_gpu_seconds": aggregate_gpu_seconds,
            "checkpoints": checkpoints,
        }
        _clear_ultralytics_runtime_config(training_root)
        write_json(training_root / "manifest.json", result)
        complete = True
    finally:
        _clear_ultralytics_caches(root / experiment.layout_directory)
        _clear_ultralytics_runtime_config(training_root)
        if not complete:
            _clean_failed_training_output(training_root, output_root_existed)
    return result
