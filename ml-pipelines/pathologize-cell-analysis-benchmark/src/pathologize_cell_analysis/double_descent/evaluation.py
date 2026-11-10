from __future__ import annotations

import os
import resource
import shutil
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal, cast

from data_artifacts.files import read_json, sha256_file, write_json
from ultralytics_extensions.checkpoints import training_rows

from ..contracts import SpatialPredictionRecord
from ..data import SplitItem
from ..learned_baseline.config import LAYOUT_DIRECTORY, cohort, data_root, ontology_labels
from ..learned_baseline.evaluation import evaluate_records
from ..learned_baseline.prediction import normalize_pathologize_result
from .config import PARAMS_FILE, PROJECT_ROOT, load_config, seed_evaluation, seed_output

EvaluationSplit = Literal["train", "validation", "test"]


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _prediction_arguments(config: Any) -> dict[str, object]:
    inference = config.inference
    return {
        "imgsz": config.training.image_size,
        "batch": config.training.batch,
        "device": config.training.device,
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


def _predict_split(
    model: Any,
    split: EvaluationSplit,
    items: dict[str, SplitItem],
    labels: list[str],
    config: Any,
) -> tuple[list[SpatialPredictionRecord], list[dict[str, object]]]:
    image_root = PROJECT_ROOT / LAYOUT_DIRECTORY / "detect" / "images" / split
    source_paths = [str(image_root / f"{item_id}.png") for item_id in sorted(items)]
    records: list[SpatialPredictionRecord] = []
    rejections: list[dict[str, object]] = []
    batch_size = config.training.batch
    for offset in range(0, len(source_paths), batch_size):
        results = model.predict(
            source=source_paths[offset : offset + batch_size],
            stream=True,
            **_prediction_arguments(config),
        )
        for result in results:
            item_id = Path(result.path).stem
            if item_id not in items:
                raise ValueError(
                    f"prediction source is outside the frozen {split} split: {item_id}"
                )
            record, rejected = normalize_pathologize_result(
                result,
                items[item_id],
                "detect",
                labels,
            )
            records.append(record)
            rejections.extend({"split": split, **entry} for entry in rejected)
    if {record.item_id for record in records} != set(items):
        raise ValueError(f"predictions do not cover every frozen {split} item")
    return records, rejections


def _patient_slices(
    records: list[SpatialPredictionRecord],
    items: dict[str, SplitItem],
    labels: list[str],
    tolerance: float,
) -> dict[str, dict[str, object]]:
    grouped: dict[str, list[SpatialPredictionRecord]] = defaultdict(list)
    for record in records:
        grouped[items[record.item_id].patient_id].append(record)
    result: dict[str, dict[str, object]] = {}
    for patient_id, patient_records in sorted(grouped.items()):
        evidence = evaluate_records(
            "detect",
            patient_records,
            items,
            data_root(),
            labels,
            tolerance,
        )
        result[patient_id] = cast(dict[str, object], evidence["localization"])
    return result


def _split_evidence(
    model: Any,
    split: EvaluationSplit,
    items: dict[str, SplitItem],
    labels: list[str],
    config: Any,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    records, rejections = _predict_split(model, split, items, labels, config)
    metrics = evaluate_records(
        "detect",
        records,
        items,
        data_root(),
        labels,
        config.localization_tolerance_pixels,
    )
    localization = cast(dict[str, object], metrics["localization"])
    return (
        {
            "task_error": 1 - float(cast(float, localization["f1"])),
            "localization": localization,
            "per_class": metrics["per_class"],
            "site_slices": metrics["held_out_site_slices"],
            "patient_clusters": _patient_slices(
                records,
                items,
                labels,
                config.localization_tolerance_pixels,
            ),
        },
        rejections,
    )


def _completed_epoch(path: Path, checkpoint_sha256: str) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    value = read_json(path)
    if not isinstance(value, dict):
        raise TypeError("epoch evidence must be an object")
    if value.get("checkpoint_sha256") != checkpoint_sha256:
        raise ValueError("cached epoch evidence refers to a different checkpoint")
    return value


def _validation_metrics(rows: list[dict[str, float]], epoch: int) -> dict[str, float]:
    matching = next((row for row in rows if int(row["epoch"]) == epoch), None)
    if matching is None:
        raise ValueError(f"training curve has no epoch {epoch}")
    return {
        "mAP50": matching["metrics/mAP50(B)"],
        "mAP50_95": matching["metrics/mAP50-95(B)"],
        "training_loss": sum(value for key, value in matching.items() if key.startswith("train/")),
        "validation_loss": sum(value for key, value in matching.items() if key.startswith("val/")),
    }


def _completed_curve(path: Path, run_sha256: str) -> dict[str, object] | None:
    if not path.is_file():
        return None
    value = read_json(path)
    if not isinstance(value, dict):
        raise TypeError("curve evidence must be an object")
    if value.get("run_sha256") != run_sha256:
        raise ValueError("completed curve evidence refers to a different training run")
    return cast(dict[str, object], value)


def _validate_evaluation_resources(
    config: Any,
    training_gpu_seconds: float,
    evaluation_gpu_seconds: float,
    training_wall_seconds: float,
    evaluation_wall_seconds: float,
    peak_vram: int,
) -> None:
    if training_gpu_seconds + evaluation_gpu_seconds > config.limits.per_seed_gpu_seconds:
        raise RuntimeError("per-seed GPU-time ceiling exceeded during curve evaluation")
    if training_wall_seconds + evaluation_wall_seconds > config.limits.per_seed_wall_seconds:
        raise RuntimeError("per-seed wall-time ceiling exceeded during curve evaluation")
    if peak_vram > config.limits.maximum_peak_vram_bytes:
        raise RuntimeError("peak VRAM ceiling exceeded during curve evaluation")


def evaluate(  # pragma: no cover
    seed: int, params_path: str = str(PARAMS_FILE)
) -> dict[str, object]:
    config = load_config(Path(params_path))
    if seed not in config.seeds:
        raise ValueError(f"seed {seed} is not predeclared")
    training_root = seed_output(seed)
    run_path = training_root / "run.json"
    run_value = read_json(run_path)
    if not isinstance(run_value, dict):
        raise TypeError("training evidence must be an object")
    run_sha256 = sha256_file(run_path)
    output = seed_evaluation(seed)
    completed = output / "curve.json"
    completed_value = _completed_curve(completed, run_sha256)
    if completed_value is not None:
        return completed_value
    output.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(output / "ultralytics-config")
    from torch import cuda
    from ultralytics import YOLO

    if not cuda.is_available():
        raise RuntimeError("the predeclared CUDA accelerator is unavailable")
    product = cohort()
    labels = ontology_labels()
    split_items = {
        split: {item.item_id: item for item in product.items if item.split == split}
        for split in ("train", "validation")
    }
    rows = training_rows(training_root)
    training_resources = run_value["resources"]
    training_gpu_seconds = float(training_resources["gpu_seconds"])
    training_wall_seconds = float(training_resources["wall_seconds"])
    evaluation_gpu_seconds = 0.0
    evaluation_wall_seconds = 0.0
    evaluation_cpu_seconds = 0.0
    peak_vram = int(training_resources["peak_vram_bytes"])
    epoch_records: list[dict[str, Any]] = []
    for checkpoint in run_value["checkpoints"]:
        epoch = int(checkpoint["epoch"])
        checkpoint_path = PROJECT_ROOT / str(checkpoint["path"])
        if sha256_file(checkpoint_path) != checkpoint["sha256"]:
            raise ValueError(f"checkpoint digest differs at epoch {epoch}")
        evidence_path = output / "epochs" / f"{epoch:03d}.json"
        existing = _completed_epoch(evidence_path, str(checkpoint["sha256"]))
        if existing is not None:
            epoch_records.append(existing)
            evaluation_gpu_seconds += float(existing["resources"]["gpu_seconds"])
            evaluation_wall_seconds += float(existing["resources"]["wall_seconds"])
            evaluation_cpu_seconds += float(existing["resources"]["cpu_seconds"])
            peak_vram = max(peak_vram, int(existing["resources"]["peak_vram_bytes"]))
            continue
        model = YOLO(str(checkpoint_path), task="detect")
        cuda.reset_peak_memory_stats()
        start_event = cuda.Event(enable_timing=True)
        end_event = cuda.Event(enable_timing=True)
        epoch_wall_start = time.monotonic()
        epoch_cpu_start = time.process_time()
        start_event.record()
        train_evidence, train_rejections = _split_evidence(
            model, "train", split_items["train"], labels, config
        )
        validation_evidence, validation_rejections = _split_evidence(
            model, "validation", split_items["validation"], labels, config
        )
        end_event.record()
        cuda.synchronize()
        epoch_gpu_seconds = start_event.elapsed_time(end_event) / 1000
        epoch_peak_vram = int(cuda.max_memory_allocated())
        evaluation_gpu_seconds += epoch_gpu_seconds
        evaluation_wall_seconds += time.monotonic() - epoch_wall_start
        evaluation_cpu_seconds += time.process_time() - epoch_cpu_start
        peak_vram = max(peak_vram, epoch_peak_vram)
        _validate_evaluation_resources(
            config,
            training_gpu_seconds,
            evaluation_gpu_seconds,
            training_wall_seconds,
            evaluation_wall_seconds,
            peak_vram,
        )
        evidence: dict[str, object] = {
            "schema_version": "1.0.0",
            "seed": seed,
            "epoch": epoch,
            "checkpoint": checkpoint["path"],
            "checkpoint_sha256": checkpoint["sha256"],
            "ultralytics_validation": _validation_metrics(rows, epoch),
            "train": train_evidence,
            "validation": validation_evidence,
            "failures": [*train_rejections, *validation_rejections],
            "resources": {
                "wall_seconds": time.monotonic() - epoch_wall_start,
                "cpu_seconds": time.process_time() - epoch_cpu_start,
                "gpu_seconds": epoch_gpu_seconds,
                "peak_rss_bytes": _peak_rss_bytes(),
                "peak_vram_bytes": epoch_peak_vram,
            },
        }
        write_json(evidence_path, evidence)
        epoch_records.append(evidence)
        del model
        cuda.empty_cache()
    result: dict[str, object] = {
        "schema_version": "1.0.0",
        "experiment_id": config.experiment_id,
        "run_sha256": run_sha256,
        "seed": seed,
        "cluster_unit": "patient_id",
        "epochs": [
            {
                "epoch": record["epoch"],
                "path": f"epochs/{int(record['epoch']):03d}.json",
                "sha256": sha256_file(output / "epochs" / f"{int(record['epoch']):03d}.json"),
            }
            for record in epoch_records
        ],
        "resources": {
            "wall_seconds": evaluation_wall_seconds,
            "cpu_seconds": evaluation_cpu_seconds,
            "gpu_seconds": evaluation_gpu_seconds,
            "peak_rss_bytes": _peak_rss_bytes(),
            "peak_vram_bytes": peak_vram,
        },
    }
    shutil.rmtree(output / "ultralytics-config", ignore_errors=True)
    for cache_path in (PROJECT_ROOT / LAYOUT_DIRECTORY).rglob("*.cache"):
        cache_path.unlink()
    write_json(completed, result)
    return result
