from __future__ import annotations

import csv
import math
import os
import resource
import shutil
import textwrap
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from data_artifacts.files import read_json, sha256_file, write_json, write_jsonl
from skimage.draw import polygon

from .contracts import (
    AcceleratorResourceEvidence,
    SpatialPrediction,
    SpatialPredictionRecord,
    UltralyticsExperiment,
)
from .data import Annotation, SplitItem, build_cohort, load_annotations
from .instance_segmentation import (
    InstanceSegmentationRecords,
    segmentation_metrics,
    update_segmentation_records,
)
from .localization import (
    LocalizationRecords,
    localization_metrics,
    match_localizations,
    update_localization_records,
)
from .methods import PredictedNucleus
from .ultralytics_conversion import load_ultralytics_experiment

Task = Literal["detect", "segment"]
ULTRALYTICS_EXPERIMENT_PATH = Path("experiments/nucls-ultralytics-baseline.json")
ULTRALYTICS_OUTPUT_DIRECTORY = Path("outputs/public/nucls-ultralytics-yolo26n-v1")
ULTRALYTICS_JSON_REPORT = Path("reports/nucls-ultralytics-baseline.json")
ULTRALYTICS_MARKDOWN_REPORT = Path("reports/nucls-ultralytics-baseline.md")
ULTRALYTICS_PROJECT_ROOT = Path(__file__).resolve().parents[2]
ULTRALYTICS_EXPERIMENT_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_EXPERIMENT_PATH
ULTRALYTICS_OUTPUT_ROOT = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_OUTPUT_DIRECTORY
ULTRALYTICS_JSON_REPORT_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_JSON_REPORT
ULTRALYTICS_MARKDOWN_REPORT_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_MARKDOWN_REPORT


@dataclass
class SpatialSlice:
    localization: LocalizationRecords = field(default_factory=LocalizationRecords)
    segmentation: InstanceSegmentationRecords = field(default_factory=InstanceSegmentationRecords)


@dataclass
class DeadlineState:
    stopped: bool = False


@dataclass
class TrainingMonitor:
    best_map50_95: float = -math.inf
    best_validation_loss: float = math.inf
    regression_epochs: int = 0
    stop_reason: str | None = None


@dataclass(frozen=True)
class ResumeEvidence:
    checkpoint: Path
    completed_epochs: int
    elapsed_seconds_upper_bound: float


def _root(experiment_path: Path) -> Path:
    return experiment_path.resolve().parent.parent


def _experiment_output_root(root: Path, experiment: UltralyticsExperiment) -> Path:
    expected = ULTRALYTICS_OUTPUT_DIRECTORY.as_posix()
    if experiment.output_directory != expected:
        raise ValueError(f"Ultralytics output directory must be {expected}")
    return root / ULTRALYTICS_OUTPUT_DIRECTORY


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


def _load_safe_checkpoint(torch_module: Any, checkpoint_path: Path) -> dict[str, Any]:
    with torch_module.serialization.safe_globals(_safe_checkpoint_globals()):
        checkpoint = torch_module.load(
            checkpoint_path,
            map_location="cpu",
            weights_only=True,
        )
    if not isinstance(checkpoint, dict):
        raise TypeError("Ultralytics checkpoint must be a dictionary")
    return checkpoint


def training_arguments(
    experiment: UltralyticsExperiment, root: Path, task: Task
) -> dict[str, object]:
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
    experiment: UltralyticsExperiment, root: Path, task: Task
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


def _training_rows(task_output: Path) -> list[dict[str, float]]:
    results_path = task_output / "results.csv"
    if not results_path.is_file():
        return []
    with results_path.open(encoding="utf-8", newline="") as source:
        return [
            {key.strip(): float(value) for key, value in row.items()}
            for row in csv.DictReader(source)
        ]


def _resume_evidence(task_output: Path) -> ResumeEvidence | None:
    if not task_output.exists():
        return None
    rows = _training_rows(task_output)
    checkpoint = task_output / "weights" / "last.pt"
    if not rows or not checkpoint.is_file():
        raise ValueError(f"incomplete training output is not resumable: {task_output}")
    return ResumeEvidence(
        checkpoint=checkpoint,
        completed_epochs=int(rows[-1]["epoch"]),
        elapsed_seconds_upper_bound=rows[-1]["time"],
    )


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
    checkpoint = _load_safe_checkpoint(torch_module, resume.checkpoint)
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


def train_ultralytics(experiment_path: Path) -> dict[str, object]:  # pragma: no cover
    experiment = load_ultralytics_experiment(experiment_path)
    root = _root(experiment_path)
    output_root = _experiment_output_root(root, experiment) / "training"
    if (output_root / "manifest.json").exists():
        raise FileExistsError(f"training output already exists: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    complete = False
    resources: dict[str, object] = {}
    checkpoints: dict[str, object] = {}
    aggregate_gpu_seconds = experiment.prior_failed_gpu_seconds_upper_bound
    try:
        os.environ["YOLO_CONFIG_DIR"] = str(output_root / "ultralytics-config")
        import torch
        from torch import cuda
        from ultralytics import YOLO, settings

        if not cuda.is_available():
            raise RuntimeError("the predeclared CUDA accelerator is unavailable")
        settings.update({"datasets_dir": str(root)})
        for task in ("detect", "segment"):
            weights, definition = _verify_training_inputs(experiment, root, task)
            task_output = output_root / task
            resume = _resume_evidence(task_output)
            rows = _training_rows(task_output)
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
            _fit_training_model(model, resume, arguments, output_root, task)
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
        _clear_ultralytics_runtime_config(output_root)
        write_json(output_root / "manifest.json", result)
        complete = True
    finally:
        _clear_ultralytics_caches(root / experiment.layout_directory)
        _clear_ultralytics_runtime_config(output_root)
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return result


def _prediction_arguments(experiment: UltralyticsExperiment, task: Task) -> dict[str, object]:
    inference = experiment.inference
    arguments: dict[str, object] = {
        "imgsz": experiment.training.image_size,
        "device": experiment.training.device,
        "conf": inference.confidence_threshold,
        "iou": inference.iou_threshold,
        "agnostic_nms": inference.class_agnostic_nms,
        "nms": inference.nms,
        "max_det": inference.maximum_detections,
        "half": inference.half_precision,
        "save": False,
        "save_txt": False,
        "save_conf": False,
        "verbose": False,
    }
    if task == "segment":
        arguments["retina_masks"] = inference.retina_masks
    return arguments


def _normalize_result(
    result: Any,
    item: SplitItem,
    task: Task,
    ontology: list[str],
) -> tuple[SpatialPredictionRecord, list[dict[str, object]]]:
    height, width = result.orig_shape
    boxes = result.boxes
    masks = result.masks
    predictions: list[SpatialPrediction] = []
    rejections: list[dict[str, object]] = []
    if boxes is not None:
        xyxy = boxes.xyxy.cpu().numpy()
        confidences = boxes.conf.cpu().numpy()
        classes = boxes.cls.cpu().numpy()
        mask_polygons = masks.xy if masks is not None else []
        for index, (bbox, confidence, class_value) in enumerate(
            zip(xyxy, confidences, classes, strict=True), start=1
        ):
            class_index = int(class_value)
            if class_index < 0 or class_index >= len(ontology):
                rejections.append(
                    {
                        "item_id": item.item_id,
                        "instance_id": index,
                        "reason": "class_index_out_of_source_ontology",
                        "class_index": class_index,
                    }
                )
                continue
            polygon_xy: list[tuple[float, float]] | None = None
            if task == "segment":
                if index > len(mask_polygons) or len(mask_polygons[index - 1]) < 3:
                    rejections.append(
                        {
                            "item_id": item.item_id,
                            "instance_id": index,
                            "reason": "segmentation_prediction_has_no_polygon",
                        }
                    )
                    continue
                polygon_xy = [
                    (float(point[0]), float(point[1])) for point in mask_polygons[index - 1]
                ]
            predictions.append(
                SpatialPrediction(
                    instance_id=index,
                    class_name=ontology[class_index],
                    confidence=float(confidence),
                    bbox_xyxy_pixels=tuple(float(value) for value in bbox),
                    polygon_xy_pixels=polygon_xy,
                )
            )
    record = SpatialPredictionRecord(
        schema_version="1.0.0",
        task=task,
        item_id=item.item_id,
        slide_id=item.slide_id,
        patient_id=item.patient_id,
        site_id=item.site_id,
        split="test",
        image_width=width,
        image_height=height,
        predictions=predictions,
    )
    return record, rejections


def _as_predicted_nucleus(
    prediction: SpatialPrediction, image_shape: tuple[int, int]
) -> PredictedNucleus:
    xmin, ymin, xmax, ymax = prediction.bbox_xyxy_pixels
    flat_pixels = np.asarray([], dtype=np.int64)
    if prediction.polygon_xy_pixels is not None:
        columns = [point[0] for point in prediction.polygon_xy_pixels]
        rows = [point[1] for point in prediction.polygon_xy_pixels]
        polygon_rows, polygon_columns = polygon(rows, columns, shape=image_shape)
        flat_pixels = np.asarray(
            polygon_rows * image_shape[1] + polygon_columns,
            dtype=np.int64,
        )
    return PredictedNucleus(
        instance_id=prediction.instance_id,
        center_x=(xmin + xmax) / 2,
        center_y=(ymin + ymax) / 2,
        xmin=round(xmin),
        ymin=round(ymin),
        xmax=round(xmax),
        ymax=round(ymax),
        flat_pixels=flat_pixels,
    )


def _update_slice(
    records: SpatialSlice,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    tolerance: float,
    image_shape: tuple[int, int],
    include_segmentation: bool,
) -> None:
    matches = match_localizations(truth, predictions, tolerance)
    update_localization_records(records.localization, truth, predictions, matches)
    if include_segmentation:
        update_segmentation_records(records.segmentation, truth, predictions, matches, image_shape)


def _slice_result(
    records: SpatialSlice, tolerance: float, include_segmentation: bool
) -> dict[str, object]:
    localization = localization_metrics(records.localization, tolerance).model_dump(mode="json")
    result: dict[str, object] = {"localization": localization}
    if include_segmentation:
        result["instance_segmentation"] = segmentation_metrics(records.segmentation).model_dump(
            mode="json"
        )
    return result


def _evaluate_records(
    task: Task,
    records: list[SpatialPredictionRecord],
    items: dict[str, SplitItem],
    data_root: Path,
    ontology: list[str],
    tolerance: float,
) -> dict[str, object]:
    aggregate = SpatialSlice()
    sites: dict[str, SpatialSlice] = defaultdict(SpatialSlice)
    classes: dict[str, SpatialSlice] = {label: SpatialSlice() for label in ontology}
    include_segmentation = task == "segment"
    for record in records:
        item = items[record.item_id]
        truth = load_annotations(data_root / item.annotation_path)
        predictions = [
            _as_predicted_nucleus(prediction, (record.image_height, record.image_width))
            for prediction in record.predictions
        ]
        _update_slice(
            aggregate,
            truth,
            predictions,
            tolerance,
            (record.image_height, record.image_width),
            include_segmentation,
        )
        _update_slice(
            sites[item.site_id],
            truth,
            predictions,
            tolerance,
            (record.image_height, record.image_width),
            include_segmentation,
        )
        for label in ontology:
            class_truth = [annotation for annotation in truth if annotation.class_name == label]
            class_predictions = [
                _as_predicted_nucleus(prediction, (record.image_height, record.image_width))
                for prediction in record.predictions
                if prediction.class_name == label
            ]
            _update_slice(
                classes[label],
                class_truth,
                class_predictions,
                tolerance,
                (record.image_height, record.image_width),
                include_segmentation,
            )
    return {
        **_slice_result(aggregate, tolerance, include_segmentation),
        "per_class": {
            label: _slice_result(values, tolerance, include_segmentation)
            for label, values in classes.items()
        },
        "held_out_site_slices": {
            site: _slice_result(values, tolerance, include_segmentation)
            for site, values in sorted(sites.items())
        },
    }


def _aggregate_loss(rows: list[dict[str, float]], prefix: str) -> list[float]:
    return [sum(value for key, value in row.items() if key.startswith(prefix)) for row in rows]


def _series_summary(rows: list[dict[str, float]], key: str) -> dict[str, float | int]:
    values = [row[key] for row in rows]
    best_index = max(range(len(values)), key=values.__getitem__)
    return {
        "first": values[0],
        "best": values[best_index],
        "best_epoch": int(rows[best_index]["epoch"]),
        "final": values[-1],
    }


def _training_curve_summary(
    rows: list[dict[str, float]],
    best_checkpoint_metrics: dict[str, float],
    maximum_epochs: int,
) -> dict[str, object]:
    if not rows:
        raise ValueError("training results are empty")
    training_loss = _aggregate_loss(rows, "train/")
    validation_loss = _aggregate_loss(rows, "val/")
    metric_keys = [
        key
        for key in (
            "metrics/mAP50(B)",
            "metrics/mAP50-95(B)",
            "metrics/mAP50(M)",
            "metrics/mAP50-95(M)",
        )
        if key in rows[0]
    ]
    matching_row = min(
        rows,
        key=lambda row: sum(
            abs(row[key] - best_checkpoint_metrics[key])
            for key in metric_keys
            if key in best_checkpoint_metrics
        ),
    )
    completed_epochs = int(rows[-1]["epoch"])
    stopped_by = "epoch_ceiling" if completed_epochs >= maximum_epochs else "validation_patience"
    convergence = (
        "validation_plateau_supports_convergence"
        if stopped_by == "validation_patience"
        else "not_established_before_epoch_ceiling"
    )
    return {
        "completed_epochs": completed_epochs,
        "stopped_by": stopped_by,
        "convergence_assessment": convergence,
        "training_loss": {
            "first": training_loss[0],
            "final": training_loss[-1],
            "minimum": min(training_loss),
        },
        "validation_loss": {
            "first": validation_loss[0],
            "final": validation_loss[-1],
            "minimum": min(validation_loss),
        },
        "metrics": {key: _series_summary(rows, key) for key in metric_keys},
        "best_checkpoint": {
            "epoch": int(matching_row["epoch"]),
            "metrics": best_checkpoint_metrics,
        },
    }


def evaluate_ultralytics(experiment_path: Path) -> dict[str, object]:  # pragma: no cover
    experiment = load_ultralytics_experiment(experiment_path)
    root = _root(experiment_path)
    run_root = _experiment_output_root(root, experiment)
    training_manifest_path = run_root / "training" / "manifest.json"
    if not training_manifest_path.is_file():
        raise FileNotFoundError("training manifest is missing")
    output_root = run_root / "evaluation"
    if output_root.exists():
        raise FileExistsError(f"evaluation output already exists: {output_root}")
    output_root.mkdir(parents=True)
    os.environ["YOLO_CONFIG_DIR"] = str(output_root / "ultralytics-config")
    import torch
    from torch import cuda
    from ultralytics import YOLO

    data_root = root / experiment.data_directory
    cohort = build_cohort(data_root, experiment.test_fold, experiment.validation_fold)
    test_items = {item.item_id: item for item in cohort.items if item.split == "test"}
    complete = False
    task_evidence: dict[str, Any] = {}
    inference_resources: dict[str, Any] = {}
    all_rejections: list[dict[str, object]] = []
    try:
        for task in ("detect", "segment"):
            checkpoint = run_root / "training" / task / "weights" / "best.pt"
            model = YOLO(str(checkpoint), task=task)
            test_image_root = root / experiment.layout_directory / task / "images" / "test"
            source_paths = [
                str(test_image_root / f"{item_id}.png") for item_id in sorted(test_items)
            ]
            wall_start = time.monotonic()
            cpu_start = time.process_time()
            cuda.reset_peak_memory_stats()
            start_event = cuda.Event(enable_timing=True)
            end_event = cuda.Event(enable_timing=True)
            start_event.record()
            results = model.predict(
                source=source_paths,
                stream=True,
                **_prediction_arguments(experiment, task),
            )
            records: list[SpatialPredictionRecord] = []
            for result in results:
                result_value: Any = result
                item_id = Path(result_value.path).stem
                if item_id not in test_items:
                    raise ValueError(
                        f"prediction source is not in the frozen test split: {item_id}"
                    )
                record, rejections = _normalize_result(
                    result_value,
                    test_items[item_id],
                    task,
                    experiment.ontology_labels,
                )
                records.append(record)
                all_rejections.extend({"task": task, **rejection} for rejection in rejections)
            end_event.record()
            cuda.synchronize()
            if {record.item_id for record in records} != set(test_items):
                raise ValueError(f"{task} predictions do not cover every frozen test item")
            prediction_path = output_root / task / "predictions.jsonl"
            write_jsonl(prediction_path, records)
            gpu_seconds = start_event.elapsed_time(end_event) / 1000
            inference_resources[task] = AcceleratorResourceEvidence(
                wall_seconds=time.monotonic() - wall_start,
                cpu_seconds=time.process_time() - cpu_start,
                gpu_seconds=gpu_seconds,
                peak_rss_bytes=_peak_rss_bytes(),
                peak_vram_bytes=int(cuda.max_memory_allocated()),
                accelerator="cuda:0",
                measurement="CUDA event elapsed time and PyTorch peak allocated memory",
                wall_ceiling_seconds=experiment.limits.per_task_wall_seconds,
                aggregate_gpu_ceiling_seconds=experiment.limits.aggregate_gpu_seconds,
            ).model_dump(mode="json")
            task_evidence[task] = _evaluate_records(
                task,
                records,
                test_items,
                data_root,
                experiment.ontology_labels,
                experiment.localization_tolerance_pixels,
            )
        write_json(output_root / "rejections.json", all_rejections)
        training_manifest = read_json(training_manifest_path)
        training_curves: dict[str, object] = {}
        for task in ("detect", "segment"):
            task_training_root = run_root / "training" / task
            checkpoint = _load_safe_checkpoint(
                torch,
                task_training_root / "weights" / "best.pt",
            )
            checkpoint_metrics = {
                str(key): float(value) for key, value in checkpoint["train_metrics"].items()
            }
            training_curves[task] = _training_curve_summary(
                _training_rows(task_training_root),
                checkpoint_metrics,
                experiment.training.epochs,
            )
        total_gpu_seconds = float(training_manifest["aggregate_gpu_seconds"]) + sum(
            float(resource_record["gpu_seconds"])
            for resource_record in inference_resources.values()
        )
        if total_gpu_seconds > experiment.limits.aggregate_gpu_seconds:
            raise RuntimeError("training and inference exceeded the aggregate GPU-time ceiling")
        transparent = read_json(root / experiment.transparent_baseline_report)
        comparison = {
            "transparent_baseline": {
                "localization_f1": transparent["localization"]["f1"],
                "conditional_instance_mean_iou": transparent["instance_segmentation"][
                    "mean_instance_iou"
                ],
            },
            "ultralytics": {
                "detection_localization_f1": task_evidence["detect"]["localization"]["f1"],
                "segmentation_localization_f1": task_evidence["segment"]["localization"]["f1"],
                "conditional_instance_mean_iou": task_evidence["segment"]["instance_segmentation"][
                    "mean_instance_iou"
                ],
            },
        }
        layout_manifest = read_json(root / experiment.layout_directory / "manifest.json")
        artifacts = {
            "split_manifest": {
                "path": (root / experiment.layout_directory / "manifest.json")
                .relative_to(root)
                .as_posix(),
                "sha256": sha256_file(root / experiment.layout_directory / "manifest.json"),
            },
            "package_lock": {"path": "uv.lock", "sha256": sha256_file(root / "uv.lock")},
            "training_manifest": {
                "path": training_manifest_path.relative_to(root).as_posix(),
                "sha256": sha256_file(training_manifest_path),
            },
            "predictions": {
                task: {
                    "path": (output_root / task / "predictions.jsonl").relative_to(root).as_posix(),
                    "sha256": sha256_file(output_root / task / "predictions.jsonl"),
                }
                for task in ("detect", "segment")
            },
            "training_curves": {
                task: {
                    "path": (run_root / "training" / task / "results.csv")
                    .relative_to(root)
                    .as_posix(),
                    "sha256": sha256_file(run_root / "training" / task / "results.csv"),
                }
                for task in ("detect", "segment")
            },
        }
        evidence: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment": experiment.model_dump(mode="json"),
            "split": {
                "item_counts": cohort.item_counts,
                "patient_counts": cohort.patient_counts,
                "slide_counts": cohort.slide_counts,
                "patient_intersections": cohort.patient_intersections,
                "slide_intersections": cohort.slide_intersections,
                "held_out_test_sites": cohort.held_out_test_sites,
            },
            "tasks": task_evidence,
            "training_curves": training_curves,
            "conversion": {
                "exclusion_counts": layout_manifest["exclusion_counts"],
                "adjustment_counts": layout_manifest["adjustment_counts"],
                "ignored_regions": layout_manifest["ignored_regions"],
            },
            "comparison": comparison,
            "failures": all_rejections,
            "resources": {
                "training": training_manifest["resources"],
                "inference": inference_resources,
                "aggregate_gpu_seconds": total_gpu_seconds,
                "aggregate_gpu_ceiling_seconds": experiment.limits.aggregate_gpu_seconds,
            },
            "artifacts": artifacts,
            "clinical_validity": False,
        }
        write_json(output_root / "evidence.json", evidence)
        complete = True
    finally:
        _clear_ultralytics_caches(root / experiment.layout_directory)
        _clear_ultralytics_runtime_config(output_root)
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return evidence


def _number(value: float | int | str) -> str:
    return f"{float(value):.4f}"


def _metric_report_row(label: str, curve: dict[str, Any], key: str) -> str:
    metric = curve["metrics"][key]
    checkpoint = curve["best_checkpoint"]
    return (
        f"| {label} | {_number(metric['first'])} | {_number(metric['best'])} "
        f"({metric['best_epoch']}) | {_number(metric['final'])} | "
        f"{_number(checkpoint['metrics'][key])} |"
    )


def _report_markdown(evidence: dict[str, Any]) -> str:
    experiment = evidence["experiment"]
    tasks = evidence["tasks"]
    comparison = evidence["comparison"]
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
        "# NuCLS Ultralytics baseline",
        "",
        textwrap.fill(
            "This non-clinical experiment trains the predeclared YOLO26 nano detection and "
            "instance-segmentation models on the frozen public NuCLS folds. Pathologize records, "
            "not Ultralytics-native metrics, are the evaluation boundary.",
            width=120,
        ),
        "",
        "## Task results",
        "",
        "| Metric | Transparent baseline | Ultralytics |",
        "| --- | ---: | ---: |",
        "| Detection localization F1 | "
        f"{_number(comparison['transparent_baseline']['localization_f1'])} | "
        f"{_number(comparison['ultralytics']['detection_localization_f1'])} |",
        "| Conditional polygon mean IoU | "
        f"{_number(comparison['transparent_baseline']['conditional_instance_mean_iou'])} | "
        f"{_number(comparison['ultralytics']['conditional_instance_mean_iou'])} |",
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
        "| --- | ---: | ---: |",
        class_rows,
        "",
        "| Held-out site | Detection localization F1 | Segmentation mean IoU |",
        "| --- | ---: | ---: |",
        site_rows,
        "",
        "## Resources and failures",
        "",
        f"Aggregate measured GPU time was {_number(resources['aggregate_gpu_seconds'])} seconds "
        f"against a {resources['aggregate_gpu_ceiling_seconds']:,}-second ceiling.",
        "",
        f"Prediction conversion rejected {len(failures):,} instances. "
        "The evidence JSON records each rejection.",
        "",
        "## Provenance",
        "",
        textwrap.fill(
            f"Package: `ultralytics=={experiment['package']['version']}` under "
            f"`{experiment['package']['license']}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            f"Detection weights: `{experiment['models']['detect']['weights']}` at "
            f"`{experiment['models']['detect']['weights_sha256']}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            f"Segmentation weights: `{experiment['models']['segment']['weights']}` at "
            f"`{experiment['models']['segment']['weights_sha256']}`.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        textwrap.fill(
            "The experiment JSON records preprocessing, augmentation, optimizer, schedule, "
            "threshold, NMS, seed, package-lock, split-manifest, checkpoint, and prediction pins.",
            width=120,
            initial_indent="- ",
            subsequent_indent="  ",
        ),
        "",
        "This experiment does not establish clinical validity.",
        "",
    ]
    return "\n".join(lines)


def report_ultralytics() -> dict[str, object]:
    load_ultralytics_experiment(ULTRALYTICS_EXPERIMENT_FILE)
    evidence = read_json(ULTRALYTICS_OUTPUT_ROOT / "evaluation" / "evidence.json")
    if not isinstance(evidence, dict):
        raise TypeError("Ultralytics evidence must be a JSON object")
    write_json(ULTRALYTICS_JSON_REPORT_FILE, evidence)
    ULTRALYTICS_MARKDOWN_REPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with ULTRALYTICS_MARKDOWN_REPORT_FILE.open("w", encoding="utf-8") as output:
        output.write(_report_markdown(evidence))
    return dict(evidence)
