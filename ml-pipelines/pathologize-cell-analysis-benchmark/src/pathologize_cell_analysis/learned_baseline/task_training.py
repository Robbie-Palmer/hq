from __future__ import annotations

import resource
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from data_artifacts.files import sha256_file
from ultralytics_extensions.checkpoints import (
    ResumeEvidence,
    checkpoint_epoch,
    load_safe_checkpoint,
    resume_evidence,
    training_rows,
)
from ultralytics_extensions.recovery import (
    TrainingTaskState,
    consumed_gpu_seconds_upper_bound,
    load_training_task_state,
    write_training_task_state,
)

from ..contracts import AcceleratorResourceEvidence, LearnedBaselineConfig
from .training_policy import (
    TrainingMonitor,
    monitor_training,
    seed_training_monitor,
    training_arguments,
)

Task = Literal["detect", "segment"]


@dataclass
class DeadlineState:
    stopped: bool = False


@dataclass(frozen=True)
class TaskTrainingResult:
    resource: dict[str, Any]
    checkpoint: dict[str, Any]
    gpu_seconds: float


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _verify_training_inputs(
    experiment: LearnedBaselineConfig, root: Path, task: Task
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


def _resource_evidence(
    experiment: LearnedBaselineConfig,
    *,
    wall_seconds: float,
    cpu_seconds: float,
    gpu_seconds: float,
    peak_rss_bytes: int,
    peak_vram_bytes: int,
    resumed: bool,
) -> dict[str, Any]:
    return AcceleratorResourceEvidence(
        wall_seconds=wall_seconds,
        cpu_seconds=cpu_seconds,
        gpu_seconds=gpu_seconds,
        peak_rss_bytes=peak_rss_bytes,
        peak_vram_bytes=peak_vram_bytes,
        accelerator="cuda:0",
        measurement=(
            "Ultralytics cumulative elapsed time as a conservative interrupted-run "
            "GPU upper bound, plus CUDA event continuation time; PyTorch peak allocated memory"
            if resumed
            else "CUDA event elapsed time and PyTorch peak allocated memory"
        ),
        wall_ceiling_seconds=experiment.limits.per_task_wall_seconds,
        aggregate_gpu_ceiling_seconds=experiment.limits.aggregate_gpu_seconds,
    ).model_dump(mode="json")


def _checkpoint_evidence(
    root: Path,
    task: Task,
    weights: Path,
    definition: Path,
    task_output: Path,
    resume: ResumeEvidence | None,
    deadline_state: DeadlineState,
    monitor: TrainingMonitor,
    prior_task_seconds: float,
    continuation_gpu_seconds: float,
) -> dict[str, object]:
    best = task_output / "weights" / "best.pt"
    last = task_output / "weights" / "last.pt"
    if not best.is_file() or not last.is_file():
        raise FileNotFoundError(f"Ultralytics did not write both checkpoints for {task}")
    return {
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
        "resume_checkpoint": resume.checkpoint.relative_to(root).as_posix() if resume else None,
        "completed_epochs_before_resume": resume.completed_epochs if resume else 0,
        "interrupted_elapsed_seconds_upper_bound": prior_task_seconds,
        "continuation_cuda_event_seconds": continuation_gpu_seconds,
    }


def _validate_completed_task_state(
    root: Path, task: Task, state: TrainingTaskState
) -> tuple[dict[str, Any], dict[str, Any]]:
    if state.resource is None or state.checkpoint is None:
        raise ValueError(f"completed {task} state lacks evidence")
    for key in ("best", "last"):
        path = root / str(state.checkpoint[key])
        if not path.is_file() or sha256_file(path) != state.checkpoint[f"{key}_sha256"]:
            raise ValueError(f"completed {task} checkpoint evidence differs for {key}")
    return state.resource, state.checkpoint


def _prepare_task_retry(
    task_output: Path,
    task_state: TrainingTaskState | None,
    *,
    now_unix_seconds: float | None = None,
) -> tuple[ResumeEvidence | None, float, float]:
    resume = resume_evidence(task_output)
    if resume is None and task_output.exists():
        shutil.rmtree(task_output)
    if task_state is not None:
        consumed_seconds = consumed_gpu_seconds_upper_bound(
            task_state,
            now_unix_seconds=(time.time() if now_unix_seconds is None else now_unix_seconds),
        )
        unrecorded_seconds = max(
            0.0, consumed_seconds - task_state.consumed_gpu_seconds_upper_bound
        )
        return resume, consumed_seconds, unrecorded_seconds
    if resume is not None:
        return resume, resume.elapsed_seconds_upper_bound, 0.0
    return resume, 0.0, 0.0


def _run_final_validation(model: Any, arguments: dict[str, object]) -> None:
    model.val(
        data=arguments["data"],
        batch=arguments["batch"],
        imgsz=arguments["imgsz"],
        device=arguments["device"],
        workers=arguments["workers"],
        plots=False,
        verbose=True,
        split="val",
    )


def _validate_continuation_limits(
    experiment: LearnedBaselineConfig,
    peak_vram: int,
    deadline: float,
    deadline_state: DeadlineState,
) -> None:
    if peak_vram > experiment.limits.maximum_peak_vram_bytes:
        raise RuntimeError("peak VRAM ceiling exceeded")
    if time.monotonic() > deadline and not deadline_state.stopped:
        raise RuntimeError("training exceeded its wall-time ceiling")


def train_task(  # pragma: no cover
    experiment: LearnedBaselineConfig,
    root: Path,
    training_root: Path,
    task: Task,
    torch_module: Any,
    cuda: Any,
    yolo: Any,
) -> TaskTrainingResult:
    weights, definition = _verify_training_inputs(experiment, root, task)
    task_output = training_root / task
    state_path = training_root / f"{task}-state.json"
    task_state = load_training_task_state(state_path)
    if task_state is not None and task_state.status == "complete":
        stored_resource, stored_checkpoint = _validate_completed_task_state(root, task, task_state)
        return TaskTrainingResult(
            stored_resource, stored_checkpoint, task_state.consumed_gpu_seconds_upper_bound
        )

    resume, prior_task_seconds, unrecorded_wall_seconds = _prepare_task_retry(
        task_output, task_state
    )
    rows = training_rows(task_output)
    prior_wall_seconds = (
        task_state.wall_seconds + unrecorded_wall_seconds if task_state is not None else 0.0
    )
    prior_cpu_seconds = task_state.cpu_seconds if task_state is not None else 0.0
    prior_peak_rss = task_state.peak_rss_bytes if task_state is not None else 0
    prior_peak_vram = task_state.peak_vram_bytes if task_state is not None else 0
    if prior_task_seconds > experiment.limits.aggregate_gpu_seconds:
        raise RuntimeError("aggregate GPU-time ceiling exceeded")
    if prior_task_seconds >= experiment.limits.per_task_wall_seconds:
        raise RuntimeError("training exhausted its wall-time ceiling")
    deadline = time.monotonic() + experiment.limits.per_task_wall_seconds - prior_task_seconds
    wall_start = time.monotonic()
    attempt_started_at = time.time()
    cpu_start = time.process_time()
    cuda.reset_peak_memory_stats()
    start_event = cuda.Event(enable_timing=True)
    end_event = cuda.Event(enable_timing=True)
    deadline_state = DeadlineState()
    monitor = seed_training_monitor(rows)
    if monitor.stop_reason is not None:
        raise RuntimeError(f"cannot resume {task}: {monitor.stop_reason}")

    def current_task_state(status: Literal["running", "failed"]) -> TrainingTaskState:
        elapsed = time.monotonic() - wall_start
        return TrainingTaskState(
            status=status,
            consumed_gpu_seconds_upper_bound=prior_task_seconds + elapsed,
            wall_seconds=prior_wall_seconds + elapsed,
            cpu_seconds=prior_cpu_seconds + time.process_time() - cpu_start,
            peak_rss_bytes=max(prior_peak_rss, _peak_rss_bytes()),
            peak_vram_bytes=max(prior_peak_vram, int(cuda.max_memory_allocated())),
            attempt_base_gpu_seconds_upper_bound=(
                prior_task_seconds if status == "running" else None
            ),
            attempt_started_at_unix_seconds=(attempt_started_at if status == "running" else None),
        )

    write_training_task_state(state_path, current_task_state("running"))

    def stop_at_deadline(trainer: Any) -> None:
        if time.monotonic() >= deadline:
            trainer.stop = True
            deadline_state.stopped = True

    try:
        if (
            resume is not None
            and task_state is not None
            and checkpoint_epoch(torch_module, resume.checkpoint) == -1
        ):
            start_event.record()
            recovered_model = yolo(str(task_output / "weights" / "best.pt"), task=task)
            arguments = training_arguments(experiment, root, task)
            _run_final_validation(recovered_model, arguments)
            end_event.record()
            cuda.synchronize()
            continuation_gpu_seconds = start_event.elapsed_time(end_event) / 1000
            gpu_seconds = prior_task_seconds + continuation_gpu_seconds
            peak_vram = max(prior_peak_vram, int(cuda.max_memory_allocated()))
            _validate_continuation_limits(experiment, peak_vram, deadline, deadline_state)
            task_resource = _resource_evidence(
                experiment,
                wall_seconds=prior_wall_seconds + time.monotonic() - wall_start,
                cpu_seconds=prior_cpu_seconds + time.process_time() - cpu_start,
                gpu_seconds=gpu_seconds,
                peak_rss_bytes=max(prior_peak_rss, _peak_rss_bytes()),
                peak_vram_bytes=peak_vram,
                resumed=True,
            )
            task_checkpoint = _checkpoint_evidence(
                root,
                task,
                weights,
                definition,
                task_output,
                resume,
                deadline_state,
                monitor,
                prior_task_seconds,
                continuation_gpu_seconds,
            )
            task_checkpoint["recovered_final_validation"] = True
        else:
            model = _load_training_model(yolo, torch_module, task, weights, resume)
            model.add_callback("on_train_epoch_end", stop_at_deadline)
            model.add_callback(
                "on_fit_epoch_end",
                lambda trainer: monitor_training(trainer, monitor, experiment.training.patience),
            )
            model.add_callback(
                "on_fit_epoch_end",
                lambda _trainer: write_training_task_state(
                    state_path, current_task_state("running")
                ),
            )
            start_event.record()
            _fit_training_model(
                model,
                resume,
                training_arguments(experiment, root, task),
                training_root,
                task,
            )
            end_event.record()
            cuda.synchronize()
            continuation_gpu_seconds = start_event.elapsed_time(end_event) / 1000
            gpu_seconds = prior_task_seconds + continuation_gpu_seconds
            peak_vram = max(prior_peak_vram, int(cuda.max_memory_allocated()))
            _validate_continuation_limits(experiment, peak_vram, deadline, deadline_state)
            task_resource = _resource_evidence(
                experiment,
                wall_seconds=prior_wall_seconds + time.monotonic() - wall_start,
                cpu_seconds=prior_cpu_seconds + time.process_time() - cpu_start,
                gpu_seconds=gpu_seconds,
                peak_rss_bytes=max(prior_peak_rss, _peak_rss_bytes()),
                peak_vram_bytes=peak_vram,
                resumed=prior_task_seconds > 0,
            )
            task_checkpoint = _checkpoint_evidence(
                root,
                task,
                weights,
                definition,
                task_output,
                resume,
                deadline_state,
                monitor,
                prior_task_seconds,
                continuation_gpu_seconds,
            )
        complete_state = TrainingTaskState(
            status="complete",
            consumed_gpu_seconds_upper_bound=gpu_seconds,
            wall_seconds=float(task_resource["wall_seconds"]),
            cpu_seconds=float(task_resource["cpu_seconds"]),
            peak_rss_bytes=int(task_resource["peak_rss_bytes"]),
            peak_vram_bytes=int(task_resource["peak_vram_bytes"]),
            resource=task_resource,
            checkpoint=task_checkpoint,
        )
        write_training_task_state(state_path, complete_state)
        return TaskTrainingResult(task_resource, task_checkpoint, gpu_seconds)
    except BaseException:
        current_state = load_training_task_state(state_path)
        if current_state is None or current_state.status != "complete":
            write_training_task_state(state_path, current_task_state("failed"))
        raise
