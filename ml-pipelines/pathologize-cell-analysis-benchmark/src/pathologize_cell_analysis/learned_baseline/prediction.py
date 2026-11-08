from __future__ import annotations

import os
import resource
import shutil
import time
from pathlib import Path
from typing import Any, Literal

from data_artifacts.files import write_json, write_jsonl
from ultralytics_extensions.results import normalize_result

from ..contracts import AcceleratorResourceEvidence, SpatialPrediction, SpatialPredictionRecord
from ..data import SplitItem, build_cohort
from .config import (
    PARAMS_FILE,
    load_config,
    output_root,
    project_root,
)

Task = Literal["detect", "segment"]


def prediction_arguments(params_path: Path, task: Task) -> dict[str, object]:
    config = load_config(params_path)
    inference = config.inference
    arguments: dict[str, object] = {
        "imgsz": config.training.image_size,
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
    if task == "segment":
        arguments["retina_masks"] = inference.retina_masks
    return arguments


def normalize_pathologize_result(
    result: Any,
    item: SplitItem,
    task: Task,
    ontology: list[str],
) -> tuple[SpatialPredictionRecord, list[dict[str, object]]]:
    width, height, instances, rejections = normalize_result(result, task, ontology)
    predictions = [
        SpatialPrediction(
            instance_id=instance.instance_id,
            class_name=instance.class_name,
            confidence=instance.confidence,
            bbox_xyxy_pixels=instance.bbox_xyxy_pixels,
            polygon_xy_pixels=(
                list(instance.polygon_xy_pixels) if instance.polygon_xy_pixels is not None else None
            ),
        )
        for instance in instances
    ]
    return (
        SpatialPredictionRecord(
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
        ),
        [{"item_id": item.item_id, **rejection} for rejection in rejections],
    )


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _clear_runtime_files(layout_root: Path, prediction_root: Path) -> None:
    for cache_path in layout_root.rglob("*.cache"):
        cache_path.unlink()
    shutil.rmtree(prediction_root / "ultralytics-config", ignore_errors=True)


def _require_known_item(item_id: str, test_items: dict[str, SplitItem]) -> SplitItem:
    if item_id not in test_items:
        raise ValueError(f"prediction source is not in the frozen test split: {item_id}")
    return test_items[item_id]


def _require_complete_predictions(
    task: Task,
    records: list[SpatialPredictionRecord],
    test_items: dict[str, SplitItem],
) -> None:
    if {record.item_id for record in records} != set(test_items):
        raise ValueError(f"{task} predictions do not cover every frozen test item")


def predict_learned_baseline(
    params_path: Path = PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config(params_path)
    root = project_root(params_path)
    run_root = output_root(root, config)
    prediction_root = run_root / "evaluation"
    output_paths = {
        task: prediction_root / task / "predictions.jsonl" for task in ("detect", "segment")
    }
    inference_path = prediction_root / "inference.json"
    rejections_path = prediction_root / "rejections.json"
    if (
        inference_path.exists()
        or rejections_path.exists()
        or any(path.exists() for path in output_paths.values())
    ):
        raise FileExistsError("Ultralytics prediction output already exists")
    os.environ["YOLO_CONFIG_DIR"] = str(prediction_root / "ultralytics-config")
    from torch import cuda
    from ultralytics import YOLO

    data_root = root / config.data_directory
    cohort = build_cohort(data_root, config.test_fold, config.validation_fold)
    test_items = {item.item_id: item for item in cohort.items if item.split == "test"}
    resources: dict[str, object] = {}
    all_rejections: list[dict[str, object]] = []
    written: list[Path] = []
    try:
        for task in ("detect", "segment"):
            checkpoint = run_root / "training" / task / "weights" / "best.pt"
            model = YOLO(str(checkpoint), task=task)
            test_image_root = root / config.layout_directory / task / "images" / "test"
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
                **prediction_arguments(params_path, task),
            )
            records: list[SpatialPredictionRecord] = []
            for result in results:
                result_value: Any = result
                item_id = Path(result_value.path).stem
                record, rejections = normalize_pathologize_result(
                    result_value,
                    _require_known_item(item_id, test_items),
                    task,
                    config.ontology_labels,
                )
                records.append(record)
                all_rejections.extend({"task": task, **rejection} for rejection in rejections)
            end_event.record()
            cuda.synchronize()
            _require_complete_predictions(task, records, test_items)
            write_jsonl(output_paths[task], records)
            written.append(output_paths[task])
            resources[task] = AcceleratorResourceEvidence(
                wall_seconds=time.monotonic() - wall_start,
                cpu_seconds=time.process_time() - cpu_start,
                gpu_seconds=start_event.elapsed_time(end_event) / 1000,
                peak_rss_bytes=_peak_rss_bytes(),
                peak_vram_bytes=int(cuda.max_memory_allocated()),
                accelerator="cuda:0",
                measurement="CUDA event elapsed time and PyTorch peak allocated memory",
                wall_ceiling_seconds=config.limits.per_task_wall_seconds,
                aggregate_gpu_ceiling_seconds=config.limits.aggregate_gpu_seconds,
            ).model_dump(mode="json")
        evidence: dict[str, object] = {
            "schema_version": "1.0.0",
            "resources": resources,
        }
        write_json(rejections_path, all_rejections)
        write_json(inference_path, evidence)
        written.extend((rejections_path, inference_path))
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    finally:
        _clear_runtime_files(root / config.layout_directory, prediction_root)
    return evidence
