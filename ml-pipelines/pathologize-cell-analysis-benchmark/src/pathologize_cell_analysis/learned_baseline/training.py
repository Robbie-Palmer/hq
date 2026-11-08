from __future__ import annotations

import os
import shutil
from pathlib import Path

from data_artifacts.files import sha256_file, write_json

from .config import (
    PARAMS_FILE,
    load_config,
    output_root,
    project_root,
)
from .task_training import train_task


def _clear_ultralytics_caches(layout_root: Path) -> None:
    for cache_path in layout_root.rglob("*.cache"):
        cache_path.unlink()


def _clear_ultralytics_runtime_config(output_root: Path) -> None:
    shutil.rmtree(output_root / "ultralytics-config", ignore_errors=True)


def _clean_failed_training_output(output_root: Path, output_root_existed: bool) -> None:
    has_checkpoint = any(
        (output_root / task / "weights" / "last.pt").is_file() for task in ("detect", "segment")
    )
    has_recovery_state = any(output_root.glob("*-state.json"))
    if not output_root_existed and not has_checkpoint and not has_recovery_state:
        shutil.rmtree(output_root, ignore_errors=True)


def train_learned_baseline(  # pragma: no cover
    params_path: Path = PARAMS_FILE,
) -> dict[str, object]:
    experiment = load_config(params_path)
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
            task_result = train_task(experiment, root, training_root, task, torch, cuda, YOLO)
            resources[task] = task_result.resource
            checkpoints[task] = task_result.checkpoint
            aggregate_gpu_seconds += task_result.gpu_seconds
            if aggregate_gpu_seconds > experiment.limits.aggregate_gpu_seconds:
                raise RuntimeError("aggregate GPU-time ceiling exceeded")
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
