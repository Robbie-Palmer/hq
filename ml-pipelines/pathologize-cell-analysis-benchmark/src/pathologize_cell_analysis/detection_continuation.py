from __future__ import annotations

import math
import os
import shutil
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from data_artifacts.files import read_json, sha256_file, write_json, write_jsonl

from .contracts import AcceleratorResourceEvidence, DetectionContinuationExperiment
from .data import build_cohort
from .ultralytics_conversion import load_ultralytics_experiment
from .ultralytics_experiment import (
    _clear_ultralytics_caches,
    _clear_ultralytics_runtime_config,
    _evaluate_records,
    _normalize_result,
    _peak_rss_bytes,
    _prediction_arguments,
    _training_curve_summary,
    _training_rows,
    training_arguments,
)


@dataclass
class PlateauMonitor:
    best_map50_95: float
    patience: int
    minimum_improvement: float
    epochs_without_improvement: int = 0
    stop_reason: str | None = None

    def observe(self, trainer: Any) -> None:
        loss = getattr(trainer, "loss", None)
        if loss is not None and not bool(loss.isfinite().all()):
            trainer.stop = True
            self.stop_reason = "non_finite_training_loss"
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
            self.stop_reason = "non_finite_validation_metric"
            return
        map50_95 = metrics.get("metrics/mAP50-95(B)")
        if map50_95 is None:
            return
        if map50_95 > self.best_map50_95 + self.minimum_improvement:
            self.best_map50_95 = map50_95
            self.epochs_without_improvement = 0
        else:
            self.epochs_without_improvement += 1
        if self.epochs_without_improvement >= self.patience:
            trainer.stop = True
            self.stop_reason = "validation_patience"


@dataclass
class DeadlineMonitor:
    deadline: float
    stopped: bool = False

    def observe(self, trainer: Any) -> None:
        if time.monotonic() >= self.deadline:
            trainer.stop = True
            self.stopped = True


def load_detection_continuation(path: Path) -> DetectionContinuationExperiment:
    payload = read_json(path)
    if not isinstance(payload, dict):
        raise TypeError("detection continuation experiment must be a JSON object")
    return DetectionContinuationExperiment.model_validate(payload)


def _root(experiment_path: Path) -> Path:
    return experiment_path.resolve().parent.parent


def _verify_pin(root: Path, relative_path: str, expected_sha256: str) -> Path:
    path = root / relative_path
    if not path.is_file():
        raise FileNotFoundError(f"pinned continuation input is missing: {path}")
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise ValueError(f"pinned continuation input changed: {path}")
    return path


def _base_best_map50_95(root: Path, base_experiment: Any) -> float:
    rows = _training_rows(root / base_experiment.output_directory / "training" / "detect")
    if not rows:
        raise ValueError("base detection training curve is missing")
    return max(row["metrics/mAP50-95(B)"] for row in rows)


def train_detection_continuation(experiment_path: Path) -> dict[str, object]:  # pragma: no cover
    continuation = load_detection_continuation(experiment_path)
    root = _root(experiment_path)
    base_experiment = load_ultralytics_experiment(root / continuation.base_experiment)
    _verify_pin(
        root,
        continuation.base_training_manifest,
        continuation.base_training_manifest_sha256,
    )
    checkpoint_path = _verify_pin(
        root,
        continuation.starting_checkpoint,
        continuation.starting_checkpoint_sha256,
    )
    _verify_pin(root, continuation.base_report, continuation.base_report_sha256)
    observed_base_best = _base_best_map50_95(root, base_experiment)
    if not math.isclose(
        observed_base_best,
        continuation.base_best_map50_95,
        rel_tol=0,
        abs_tol=1e-9,
    ):
        raise ValueError("predeclared base validation best differs from the training curve")

    output_root = root / continuation.output_directory / "training"
    if output_root.exists():
        raise FileExistsError(f"continuation output already exists: {output_root}")
    output_root.mkdir(parents=True)
    complete = False
    try:
        os.environ["YOLO_CONFIG_DIR"] = str(output_root / "ultralytics-config")
        import torch
        from torch import cuda
        from ultralytics import YOLO, settings

        if not cuda.is_available():
            raise RuntimeError("the predeclared CUDA accelerator is unavailable")
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        stripped_fields = ("optimizer", "ema", "scaler", "stopper")
        if any(checkpoint.get(field) is not None for field in stripped_fields):
            raise ValueError("starting checkpoint unexpectedly contains resumable optimizer state")

        settings.update({"datasets_dir": str(root)})
        monitor = PlateauMonitor(
            best_map50_95=continuation.base_best_map50_95,
            patience=continuation.validation_patience,
            minimum_improvement=continuation.minimum_map50_95_improvement,
        )
        deadline = DeadlineMonitor(
            deadline=time.monotonic() + continuation.limits.per_task_wall_seconds
        )
        model = YOLO(str(checkpoint_path), task="detect")
        model.add_callback("on_train_epoch_end", deadline.observe)
        model.add_callback("on_fit_epoch_end", monitor.observe)
        arguments = training_arguments(base_experiment, root, "detect")
        arguments.update(
            {
                "epochs": continuation.additional_epoch_ceiling,
                "patience": continuation.additional_epoch_ceiling + 1,
            }
        )

        wall_start = time.monotonic()
        cpu_start = time.process_time()
        cuda.reset_peak_memory_stats()
        start_event = cuda.Event(enable_timing=True)
        end_event = cuda.Event(enable_timing=True)
        start_event.record()
        model.train(
            **arguments,
            project=str(output_root),
            name="detect",
            exist_ok=False,
        )
        end_event.record()
        cuda.synchronize()
        gpu_seconds = start_event.elapsed_time(end_event) / 1000
        peak_vram = int(cuda.max_memory_allocated())
        if gpu_seconds > continuation.limits.aggregate_gpu_seconds:
            raise RuntimeError("continuation exceeded its GPU-time ceiling")
        if peak_vram > continuation.limits.maximum_peak_vram_bytes:
            raise RuntimeError("continuation exceeded its peak VRAM ceiling")

        task_root = output_root / "detect"
        rows = _training_rows(task_root)
        if not rows:
            raise ValueError("continuation training curve is missing")
        best_path = task_root / "weights" / "best.pt"
        last_path = task_root / "weights" / "last.pt"
        if not best_path.is_file() or not last_path.is_file():
            raise FileNotFoundError("continuation did not write both checkpoints")
        completed_epochs = int(rows[-1]["epoch"])
        if monitor.stop_reason is not None:
            stop_reason = monitor.stop_reason
        elif deadline.stopped:
            stop_reason = "wall_time_ceiling"
        elif completed_epochs >= continuation.additional_epoch_ceiling:
            stop_reason = "additional_epoch_ceiling"
        else:
            stop_reason = "framework_stop"
        continuation_best = max(row["metrics/mAP50-95(B)"] for row in rows)
        result: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment": continuation.model_dump(mode="json"),
            "base_experiment_id": base_experiment.experiment_id,
            "optimizer_state_continued": False,
            "optimizer_reset_reason": (
                "Ultralytics stripped optimizer state after the completed base run"
            ),
            "completed_additional_epochs": completed_epochs,
            "stop_reason": stop_reason,
            "base_best_map50_95": continuation.base_best_map50_95,
            "continuation_best_map50_95": continuation_best,
            "improved_over_base": continuation_best > continuation.base_best_map50_95,
            # Ultralytics runs the fit callback once more while validating the
            # selected checkpoint after training. Cap the recorded count at the
            # predeclared patience so that it describes the stopping decision,
            # not that post-training callback.
            "epochs_without_improvement": min(
                monitor.epochs_without_improvement,
                continuation.validation_patience,
            ),
            "checkpoint": {
                "starting": continuation.starting_checkpoint,
                "starting_sha256": continuation.starting_checkpoint_sha256,
                "best": best_path.relative_to(root).as_posix(),
                "best_sha256": sha256_file(best_path),
                "last": last_path.relative_to(root).as_posix(),
                "last_sha256": sha256_file(last_path),
            },
            "training_config": arguments,
            "resource": AcceleratorResourceEvidence(
                wall_seconds=time.monotonic() - wall_start,
                cpu_seconds=time.process_time() - cpu_start,
                gpu_seconds=gpu_seconds,
                peak_rss_bytes=_peak_rss_bytes(),
                peak_vram_bytes=peak_vram,
                accelerator="cuda:0",
                measurement="CUDA event elapsed time and PyTorch peak allocated memory",
                wall_ceiling_seconds=continuation.limits.per_task_wall_seconds,
                aggregate_gpu_ceiling_seconds=continuation.limits.aggregate_gpu_seconds,
            ).model_dump(mode="json"),
        }
        _clear_ultralytics_runtime_config(output_root)
        write_json(output_root / "manifest.json", result)
        complete = True
    finally:
        _clear_ultralytics_caches(root / base_experiment.layout_directory)
        _clear_ultralytics_runtime_config(output_root)
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return result


def evaluate_detection_continuation(
    experiment_path: Path,
) -> dict[str, object]:  # pragma: no cover
    continuation = load_detection_continuation(experiment_path)
    root = _root(experiment_path)
    base_experiment = load_ultralytics_experiment(root / continuation.base_experiment)
    run_root = root / continuation.output_directory
    training_manifest_path = run_root / "training" / "manifest.json"
    if not training_manifest_path.is_file():
        raise FileNotFoundError("continuation training manifest is missing")
    output_root = run_root / "evaluation"
    if output_root.exists():
        raise FileExistsError(f"continuation evaluation already exists: {output_root}")
    output_root.mkdir(parents=True)
    complete = False
    try:
        os.environ["YOLO_CONFIG_DIR"] = str(output_root / "ultralytics-config")
        import torch
        from torch import cuda
        from ultralytics import YOLO

        data_root = root / base_experiment.data_directory
        cohort = build_cohort(
            data_root,
            base_experiment.test_fold,
            base_experiment.validation_fold,
        )
        test_items = {item.item_id: item for item in cohort.items if item.split == "test"}
        checkpoint_path = run_root / "training" / "detect" / "weights" / "best.pt"
        model = YOLO(str(checkpoint_path), task="detect")
        image_root = root / base_experiment.layout_directory / "detect" / "images" / "test"
        sources = [str(image_root / f"{item_id}.png") for item_id in sorted(test_items)]

        wall_start = time.monotonic()
        cpu_start = time.process_time()
        cuda.reset_peak_memory_stats()
        start_event = cuda.Event(enable_timing=True)
        end_event = cuda.Event(enable_timing=True)
        start_event.record()
        results = model.predict(
            source=sources,
            stream=True,
            **_prediction_arguments(base_experiment, "detect"),
        )
        records = []
        rejections: list[dict[str, object]] = []
        for result in results:
            result_value: Any = result
            item_id = Path(result_value.path).stem
            if item_id not in test_items:
                raise ValueError(f"prediction source is outside the test split: {item_id}")
            record, result_rejections = _normalize_result(
                result_value,
                test_items[item_id],
                "detect",
                base_experiment.ontology_labels,
            )
            records.append(record)
            rejections.extend(result_rejections)
        end_event.record()
        cuda.synchronize()
        if {record.item_id for record in records} != set(test_items):
            raise ValueError("continuation predictions do not cover the frozen test split")
        write_jsonl(output_root / "predictions.jsonl", records)
        write_json(output_root / "rejections.json", rejections)

        task_evidence: dict[str, Any] = _evaluate_records(
            "detect",
            records,
            test_items,
            data_root,
            base_experiment.ontology_labels,
            base_experiment.localization_tolerance_pixels,
        )
        training_root = run_root / "training" / "detect"
        checkpoint = torch.load(
            training_root / "weights" / "best.pt",
            map_location="cpu",
            weights_only=False,
        )
        checkpoint_metrics = {
            str(key): float(value) for key, value in checkpoint["train_metrics"].items()
        }
        curve = _training_curve_summary(
            _training_rows(training_root),
            checkpoint_metrics,
            continuation.additional_epoch_ceiling,
        )
        training_manifest = read_json(training_manifest_path)
        base_report = read_json(root / continuation.base_report)
        base_detector_f1 = float(base_report["tasks"]["detect"]["localization"]["f1"])
        continuation_f1 = float(task_evidence["localization"]["f1"])
        inference_resource = AcceleratorResourceEvidence(
            wall_seconds=time.monotonic() - wall_start,
            cpu_seconds=time.process_time() - cpu_start,
            gpu_seconds=start_event.elapsed_time(end_event) / 1000,
            peak_rss_bytes=_peak_rss_bytes(),
            peak_vram_bytes=int(cuda.max_memory_allocated()),
            accelerator="cuda:0",
            measurement="CUDA event elapsed time and PyTorch peak allocated memory",
            wall_ceiling_seconds=continuation.limits.per_task_wall_seconds,
            aggregate_gpu_ceiling_seconds=continuation.limits.aggregate_gpu_seconds,
        ).model_dump(mode="json")
        total_gpu_seconds = float(training_manifest["resource"]["gpu_seconds"]) + float(
            inference_resource["gpu_seconds"]
        )
        evidence: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment": continuation.model_dump(mode="json"),
            "training": training_manifest,
            "training_curve": curve,
            "task": task_evidence,
            "comparison": {
                "transparent_baseline_localization_f1": base_report["comparison"][
                    "transparent_baseline"
                ]["localization_f1"],
                "base_detector_localization_f1": base_detector_f1,
                "continuation_localization_f1": continuation_f1,
            },
            "selection": {
                "promote_continuation": continuation_f1 > base_detector_f1,
                "selected_checkpoint": (
                    "continuation" if continuation_f1 > base_detector_f1 else "base_detector"
                ),
                "reason": (
                    "held_out_localization_f1_improved"
                    if continuation_f1 > base_detector_f1
                    else "held_out_localization_f1_did_not_improve"
                ),
            },
            "failures": rejections,
            "resources": {
                "training": training_manifest["resource"],
                "inference": inference_resource,
                "aggregate_gpu_seconds": total_gpu_seconds,
                "aggregate_gpu_ceiling_seconds": continuation.limits.aggregate_gpu_seconds,
            },
            "artifacts": {
                "training_manifest_sha256": sha256_file(training_manifest_path),
                "checkpoint_sha256": sha256_file(checkpoint_path),
                "predictions_sha256": sha256_file(output_root / "predictions.jsonl"),
            },
            "clinical_validity": False,
        }
        write_json(output_root / "evidence.json", evidence)
        complete = True
    finally:
        _clear_ultralytics_caches(root / base_experiment.layout_directory)
        _clear_ultralytics_runtime_config(output_root)
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return evidence


def report_detection_continuation(
    experiment_path: Path,
    json_output: Path,
    markdown_output: Path,
) -> dict[str, Any]:
    continuation = load_detection_continuation(experiment_path)
    root = _root(experiment_path)
    raw_evidence = read_json(root / continuation.output_directory / "evaluation" / "evidence.json")
    if not isinstance(raw_evidence, dict):
        raise TypeError("continuation evidence must be a JSON object")
    evidence = cast(dict[str, Any], raw_evidence)
    write_json(json_output, evidence)
    comparison = evidence["comparison"]
    selection = evidence["selection"]
    training = evidence["training"]
    curve = evidence["training_curve"]
    markdown = "\n".join(
        [
            "# NuCLS detector continuation",
            "",
            textwrap.fill(
                "This non-clinical continuation starts from the pinned best checkpoint of the "
                "completed baseline. The optimizer state was unavailable, so this is a separate "
                "fine-tuning experiment.",
                width=120,
            ),
            "",
            "## Result",
            "",
            "| Measure | Base detector | Continuation |",
            "| --- | ---: | ---: |",
            "| Held-out localization F1 | "
            f"{float(comparison['base_detector_localization_f1']):.4f} | "
            f"{float(comparison['continuation_localization_f1']):.4f} |",
            f"| Validation mAP50-95 | {float(training['base_best_map50_95']):.4f} | "
            f"{float(training['continuation_best_map50_95']):.4f} |",
            "",
            textwrap.fill(
                "The continuation is not a promotion candidate. Its small validation gain did "
                "not transfer to the held-out fold, so the original detector checkpoint remains "
                f"selected (`{selection['reason']}`).",
                width=120,
            ),
            "",
            "## Stopping evidence",
            "",
            textwrap.fill(
                f"The continuation ran {training['completed_additional_epochs']} additional "
                f"epochs and stopped for `{training['stop_reason']}`. Its validation assessment "
                f"is `{curve['convergence_assessment']}`.",
                width=120,
            ),
            "",
            f"Prediction conversion rejected {len(evidence['failures'])} instances.",
            "",
            "This experiment does not establish clinical validity.",
            "",
        ]
    )
    markdown_output.parent.mkdir(parents=True, exist_ok=True)
    markdown_output.write_text(markdown, encoding="utf-8")
    return evidence
