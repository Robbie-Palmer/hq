from __future__ import annotations

import resource
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from data_artifacts.files import read_json, sha256_file, write_json
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
from .config import LAYOUT_DIRECTORY, WEIGHTS_DIRECTORY
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


SEGMENT_INITIALIZATION_RECORD = "segment-initialization.json"
BEST_CHECKPOINT_FILENAME = "best.pt"


@dataclass(frozen=True)
class TrainingAttempt:
    resume: ResumeEvidence | None
    prior_task_seconds: float
    prior_wall_seconds: float
    prior_cpu_seconds: float
    prior_peak_rss: int
    prior_peak_vram: int
    deadline: float
    wall_start: float
    attempt_started_at: float
    cpu_start: float
    start_event: Any
    end_event: Any
    deadline_state: DeadlineState
    monitor: TrainingMonitor
    finalized_checkpoint: bool


@dataclass(frozen=True)
class TaskRunContext:
    experiment: LearnedBaselineConfig
    root: Path
    training_root: Path
    task: Task
    weights: Path
    definition: Path
    task_output: Path
    state_path: Path
    initialization_checkpoint: Path | None
    initialization_record_path: Path | None


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _verify_training_inputs(
    experiment: LearnedBaselineConfig, root: Path, task: Task
) -> tuple[Path, Path]:
    model = experiment.models[task]
    weights = root / WEIGHTS_DIRECTORY / model.weights
    definition = root / WEIGHTS_DIRECTORY / Path(model.definition).name
    if sha256_file(weights) != model.weights_sha256:
        raise ValueError(f"starting weight digest differs for {task}")
    if sha256_file(definition) != model.definition_sha256:
        raise ValueError(f"model definition digest differs for {task}")
    layout_manifest = root / LAYOUT_DIRECTORY / "manifest.json"
    if not layout_manifest.is_file():
        raise FileNotFoundError("derived Ultralytics layout manifest is missing")
    return weights, definition


def _load_training_model(
    yolo: Any,
    torch_module: Any,
    task: Task,
    weights: Path,
    resume: ResumeEvidence | None,
    initialization_checkpoint: Path | None = None,
    initialization_record_path: Path | None = None,
) -> tuple[Any, dict[str, object] | None]:
    if resume is None:
        model = yolo(str(weights), task=task)
        if initialization_checkpoint is None:
            return model, None
        if initialization_record_path is None:
            raise ValueError("segment initialization record path is required")
        evidence = transfer_backbone_neck_from_checkpoint(
            model,
            torch_module,
            initialization_checkpoint,
        )
        write_json(initialization_record_path, evidence)
        return model, evidence
    checkpoint = load_safe_checkpoint(torch_module, resume.checkpoint)
    required_state = {"optimizer", "ema", "scaler", "stopper", "train_args"}
    if not required_state.issubset(checkpoint):
        raise ValueError(f"{task} checkpoint lacks exact resume state")
    if int(checkpoint["epoch"]) + 1 != resume.completed_epochs:
        raise ValueError(f"{task} checkpoint epoch differs from results.csv")
    evidence = None
    if initialization_checkpoint is not None:
        if initialization_record_path is None or not initialization_record_path.is_file():
            raise FileNotFoundError("segment initialization evidence is missing for resume")
        evidence = read_json(initialization_record_path)
        if evidence.get("source_checkpoint_sha256") != sha256_file(initialization_checkpoint):
            raise ValueError("segment initialization checkpoint digest differs for resume")
    return yolo(str(resume.checkpoint), task=task), evidence


def transfer_backbone_neck_from_checkpoint(
    target_yolo: Any,
    torch_module: Any,
    source_checkpoint: Path,
) -> dict[str, object]:
    checkpoint = load_safe_checkpoint(torch_module, source_checkpoint)
    source_model = checkpoint.get("model")
    if source_model is None or not hasattr(source_model, "state_dict"):
        raise ValueError("detection checkpoint lacks model weights")
    target_model = target_yolo.model
    target_layers = getattr(target_model, "model", None)
    if target_layers is None or len(target_layers) < 2:
        raise ValueError("segmentation model does not expose a separable task head")
    head_prefix = f"model.{len(target_layers) - 1}."
    source_state = source_model.float().state_dict()
    target_state = target_model.state_dict()
    target_shared = {key for key in target_state if not key.startswith(head_prefix)}
    transferable = {
        key: value
        for key, value in source_state.items()
        if key in target_shared and target_state[key].shape == value.shape
    }
    missing_shared = sorted(target_shared - transferable.keys())
    transferred_head = sorted(key for key in transferable if key.startswith(head_prefix))
    if missing_shared:
        raise ValueError(
            f"detection checkpoint lacks {len(missing_shared)} shared segmentation tensors"
        )
    if transferred_head:
        raise ValueError("segment initialization attempted to transfer task-head tensors")
    head_before = {
        key: value.detach().clone()
        for key, value in target_state.items()
        if key.startswith(head_prefix)
    }
    target_model.load_state_dict(transferable, strict=False)
    head_after = target_model.state_dict()
    if any(not torch_module.equal(value, head_after[key]) for key, value in head_before.items()):
        raise ValueError("segment task head changed during backbone and neck transfer")
    return {
        "strategy": "detect_checkpoint_backbone_neck",
        "source_checkpoint": source_checkpoint.as_posix(),
        "source_checkpoint_sha256": sha256_file(source_checkpoint),
        "excluded_head_prefix": head_prefix,
        "transferred_tensor_count": len(transferable),
        "transferred_value_count": sum(value.numel() for value in transferable.values()),
        "retained_head_tensor_count": len(head_before),
    }


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
    initialization: dict[str, object] | None,
) -> dict[str, object]:
    best = task_output / "weights" / BEST_CHECKPOINT_FILENAME
    last = task_output / "weights" / "last.pt"
    if not best.is_file() or not last.is_file():
        raise FileNotFoundError(f"Ultralytics did not write both checkpoints for {task}")
    result: dict[str, object] = {
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
    if initialization is not None:
        result["initialization"] = initialization
    return result


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


def _prepare_training_attempt(
    experiment: LearnedBaselineConfig,
    task: Task,
    task_output: Path,
    task_state: TrainingTaskState | None,
    torch_module: Any,
    cuda: Any,
) -> TrainingAttempt:
    resume, prior_task_seconds, unrecorded_wall_seconds = _prepare_task_retry(
        task_output, task_state
    )
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
    monitor = seed_training_monitor(training_rows(task_output))
    if task_state is not None and task_state.stop_reason is not None:
        monitor.stop_reason = task_state.stop_reason
    finalized_checkpoint = (
        resume is not None
        and task_state is not None
        and checkpoint_epoch(torch_module, resume.checkpoint) == -1
    )
    if monitor.stop_reason is not None and not finalized_checkpoint:
        raise RuntimeError(f"cannot resume {task}: {monitor.stop_reason}")
    return TrainingAttempt(
        resume=resume,
        prior_task_seconds=prior_task_seconds,
        prior_wall_seconds=prior_wall_seconds,
        prior_cpu_seconds=prior_cpu_seconds,
        prior_peak_rss=prior_peak_rss,
        prior_peak_vram=prior_peak_vram,
        deadline=deadline,
        wall_start=wall_start,
        attempt_started_at=attempt_started_at,
        cpu_start=cpu_start,
        start_event=cuda.Event(enable_timing=True),
        end_event=cuda.Event(enable_timing=True),
        deadline_state=DeadlineState(),
        monitor=monitor,
        finalized_checkpoint=finalized_checkpoint,
    )


def _current_task_state(
    attempt: TrainingAttempt,
    cuda: Any,
    status: Literal["running", "failed"],
) -> TrainingTaskState:
    elapsed = time.monotonic() - attempt.wall_start
    return TrainingTaskState(
        status=status,
        consumed_gpu_seconds_upper_bound=attempt.prior_task_seconds + elapsed,
        wall_seconds=attempt.prior_wall_seconds + elapsed,
        cpu_seconds=attempt.prior_cpu_seconds + time.process_time() - attempt.cpu_start,
        peak_rss_bytes=max(attempt.prior_peak_rss, _peak_rss_bytes()),
        peak_vram_bytes=max(attempt.prior_peak_vram, int(cuda.max_memory_allocated())),
        stop_reason=attempt.monitor.stop_reason,
        attempt_base_gpu_seconds_upper_bound=(
            attempt.prior_task_seconds if status == "running" else None
        ),
        attempt_started_at_unix_seconds=(
            attempt.attempt_started_at if status == "running" else None
        ),
    )


def _stop_at_deadline(trainer: Any, attempt: TrainingAttempt) -> None:
    if time.monotonic() >= attempt.deadline:
        trainer.stop = True
        attempt.deadline_state.stopped = True


def _finish_attempt(
    experiment: LearnedBaselineConfig,
    root: Path,
    task: Task,
    weights: Path,
    definition: Path,
    task_output: Path,
    attempt: TrainingAttempt,
    cuda: Any,
    *,
    recovered_final_validation: bool,
    initialization: dict[str, object] | None,
) -> TaskTrainingResult:
    attempt.end_event.record()
    cuda.synchronize()
    continuation_gpu_seconds = attempt.start_event.elapsed_time(attempt.end_event) / 1000
    gpu_seconds = attempt.prior_task_seconds + continuation_gpu_seconds
    peak_vram = max(attempt.prior_peak_vram, int(cuda.max_memory_allocated()))
    _validate_continuation_limits(experiment, peak_vram, attempt.deadline, attempt.deadline_state)
    task_resource = _resource_evidence(
        experiment,
        wall_seconds=attempt.prior_wall_seconds + time.monotonic() - attempt.wall_start,
        cpu_seconds=attempt.prior_cpu_seconds + time.process_time() - attempt.cpu_start,
        gpu_seconds=gpu_seconds,
        peak_rss_bytes=max(attempt.prior_peak_rss, _peak_rss_bytes()),
        peak_vram_bytes=peak_vram,
        resumed=recovered_final_validation or attempt.prior_task_seconds > 0,
    )
    task_checkpoint = _checkpoint_evidence(
        root,
        task,
        weights,
        definition,
        task_output,
        attempt.resume,
        attempt.deadline_state,
        attempt.monitor,
        attempt.prior_task_seconds,
        continuation_gpu_seconds,
        initialization,
    )
    if recovered_final_validation:
        task_checkpoint["recovered_final_validation"] = True
    return TaskTrainingResult(task_resource, task_checkpoint, gpu_seconds)


def _run_recovered_validation(
    experiment: LearnedBaselineConfig,
    root: Path,
    task: Task,
    weights: Path,
    definition: Path,
    task_output: Path,
    attempt: TrainingAttempt,
    cuda: Any,
    yolo: Any,
    initialization_checkpoint: Path | None,
    initialization_record_path: Path | None,
) -> TaskTrainingResult:
    attempt.start_event.record()
    initialization = None
    if initialization_checkpoint is not None:
        if initialization_record_path is None or not initialization_record_path.is_file():
            raise FileNotFoundError("segment initialization evidence is missing for recovery")
        initialization = read_json(initialization_record_path)
        if initialization.get("source_checkpoint_sha256") != sha256_file(initialization_checkpoint):
            raise ValueError("segment initialization checkpoint digest differs for recovery")
    recovered_model = yolo(str(task_output / "weights" / BEST_CHECKPOINT_FILENAME), task=task)
    _run_final_validation(recovered_model, training_arguments(experiment, root, task))
    return _finish_attempt(
        experiment,
        root,
        task,
        weights,
        definition,
        task_output,
        attempt,
        cuda,
        recovered_final_validation=True,
        initialization=initialization,
    )


def _run_training_attempt(
    context: TaskRunContext,
    attempt: TrainingAttempt,
    torch_module: Any,
    cuda: Any,
    yolo: Any,
) -> TaskTrainingResult:
    model, initialization = _load_training_model(
        yolo,
        torch_module,
        context.task,
        context.weights,
        attempt.resume,
        context.initialization_checkpoint,
        context.initialization_record_path,
    )
    model.add_callback("on_train_epoch_end", lambda trainer: _stop_at_deadline(trainer, attempt))
    model.add_callback(
        "on_fit_epoch_end",
        lambda trainer: monitor_training(
            trainer, attempt.monitor, context.experiment.training.patience
        ),
    )
    model.add_callback(
        "on_fit_epoch_end",
        lambda _trainer: write_training_task_state(
            context.state_path, _current_task_state(attempt, cuda, "running")
        ),
    )
    attempt.start_event.record()
    _fit_training_model(
        model,
        attempt.resume,
        training_arguments(context.experiment, context.root, context.task),
        context.training_root,
        context.task,
    )
    return _finish_attempt(
        context.experiment,
        context.root,
        context.task,
        context.weights,
        context.definition,
        context.task_output,
        attempt,
        cuda,
        recovered_final_validation=False,
        initialization=initialization,
    )


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

    initialization_checkpoint = None
    initialization_record_path = None
    if task == "segment" and experiment.training.segment_initialization == (
        "detect_checkpoint_backbone_neck"
    ):
        initialization_checkpoint = training_root / "detect" / "weights" / BEST_CHECKPOINT_FILENAME
        if not initialization_checkpoint.is_file():
            raise FileNotFoundError("completed detection checkpoint is required for segmentation")
        initialization_record_path = training_root / SEGMENT_INITIALIZATION_RECORD
    context = TaskRunContext(
        experiment=experiment,
        root=root,
        training_root=training_root,
        task=task,
        weights=weights,
        definition=definition,
        task_output=task_output,
        state_path=state_path,
        initialization_checkpoint=initialization_checkpoint,
        initialization_record_path=initialization_record_path,
    )
    attempt = _prepare_training_attempt(
        experiment, task, task_output, task_state, torch_module, cuda
    )
    write_training_task_state(state_path, _current_task_state(attempt, cuda, "running"))

    try:
        if attempt.finalized_checkpoint:
            result = _run_recovered_validation(
                experiment,
                root,
                task,
                weights,
                definition,
                task_output,
                attempt,
                cuda,
                yolo,
                initialization_checkpoint,
                initialization_record_path,
            )
        else:
            result = _run_training_attempt(
                context,
                attempt,
                torch_module,
                cuda,
                yolo,
            )
        complete_state = TrainingTaskState(
            status="complete",
            consumed_gpu_seconds_upper_bound=result.gpu_seconds,
            wall_seconds=float(result.resource["wall_seconds"]),
            cpu_seconds=float(result.resource["cpu_seconds"]),
            peak_rss_bytes=int(result.resource["peak_rss_bytes"]),
            peak_vram_bytes=int(result.resource["peak_vram_bytes"]),
            stop_reason=attempt.monitor.stop_reason,
            resource=result.resource,
            checkpoint=result.checkpoint,
        )
        write_training_task_state(state_path, complete_state)
    except BaseException:
        current_state = load_training_task_state(state_path)
        if current_state is None or current_state.status != "complete":
            write_training_task_state(state_path, _current_task_state(attempt, cuda, "failed"))
        raise
    else:
        return result
