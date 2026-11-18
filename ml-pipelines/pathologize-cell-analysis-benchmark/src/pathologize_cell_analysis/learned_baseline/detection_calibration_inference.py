from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from data_artifacts.files import sha256_file, write_json, write_jsonl
from ultralytics_extensions.results import normalize_result

from ..contracts import AcceleratorResourceEvidence, SpatialPrediction
from .config import LAYOUT_DIRECTORY, PARAMS_FILE, PROJECT_ROOT, load_config, ontology_labels
from .detection_calibration_contracts import (
    CALIBRATION_PARAMS_FILE,
    INFERENCE_FILENAME,
    REJECTIONS_FILENAME,
    TEST_ROOT,
    VALIDATION_ROOT,
    CalibrationPredictionRecord,
    EvaluationSplit,
    load_calibration_config,
    prediction_path,
    require_complete_records,
    require_item,
    split_items,
    value_token,
)
from .prediction import _clear_runtime_files, _peak_rss_bytes, prediction_arguments


def run_detection_inference(
    split: EvaluationSplit,
    confidence_threshold: float,
    nms_iou_thresholds: tuple[float, ...],
    destination: Path,
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config()
    root = PROJECT_ROOT
    run_root = root / "outputs/learned-baseline"
    if destination.exists():
        if any(destination.iterdir()):
            raise FileExistsError(f"calibration inference output already exists: {destination}")
        destination.rmdir()
    os.environ["YOLO_CONFIG_DIR"] = str(destination / "ultralytics-config")
    from torch import cuda
    from ultralytics import YOLO

    items = split_items(split)
    labels = ontology_labels()
    checkpoint = run_root / "training/detect/weights/best.pt"
    model = YOLO(str(checkpoint), task="detect")
    image_root = root / LAYOUT_DIRECTORY / "detect/images" / split
    source_paths = [str(image_root / f"{item_id}.png") for item_id in sorted(items)]
    resources: dict[str, object] = {}
    rejections: list[dict[str, object]] = []
    written: list[Path] = []
    try:
        for nms_iou_threshold in nms_iou_thresholds:
            arguments = prediction_arguments(PARAMS_FILE, "detect")
            arguments["conf"] = confidence_threshold
            arguments["iou"] = nms_iou_threshold
            wall_start = time.monotonic()
            cpu_start = time.process_time()
            cuda.reset_peak_memory_stats()
            start_event = cuda.Event(enable_timing=True)
            end_event = cuda.Event(enable_timing=True)
            start_event.record()
            records: list[CalibrationPredictionRecord] = []
            calibration = load_calibration_config(params_path)
            for offset in range(0, len(source_paths), calibration.inference_batch_size):
                batch_paths = source_paths[offset : offset + calibration.inference_batch_size]
                results = model.predict(source=batch_paths, stream=True, **arguments)
                for result in results:
                    result_value: Any = result
                    item_id = Path(result_value.path).stem
                    item = require_item(item_id, items, split)
                    width, height, instances, rejected = normalize_result(
                        result_value, "detect", labels
                    )
                    records.append(
                        CalibrationPredictionRecord(
                            schema_version="1.0.0",
                            task="detect",
                            item_id=item.item_id,
                            slide_id=item.slide_id,
                            patient_id=item.patient_id,
                            site_id=item.site_id,
                            split=split,
                            image_width=width,
                            image_height=height,
                            predictions=[
                                SpatialPrediction(
                                    instance_id=instance.instance_id,
                                    class_name=instance.class_name,
                                    confidence=instance.confidence,
                                    bbox_xyxy_pixels=instance.bbox_xyxy_pixels,
                                    polygon_xy_pixels=None,
                                )
                                for instance in instances
                            ],
                        )
                    )
                    rejections.extend(
                        {
                            "split": split,
                            "nms_iou_threshold": nms_iou_threshold,
                            **entry,
                        }
                        for entry in rejected
                    )
            end_event.record()
            cuda.synchronize()
            require_complete_records(records, items, split)
            path = prediction_path(destination, nms_iou_threshold)
            write_jsonl(path, records)
            written.append(path)
            resources[value_token(nms_iou_threshold)] = AcceleratorResourceEvidence(
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
        inference = {
            "schema_version": "1.0.0",
            "split": split,
            "confidence_threshold": confidence_threshold,
            "nms_iou_thresholds": list(nms_iou_thresholds),
            "checkpoint_sha256": sha256_file(checkpoint),
            "parameters_sha256": sha256_file(params_path),
            "resources": resources,
        }
        write_json(destination / REJECTIONS_FILENAME, rejections)
        write_json(destination / INFERENCE_FILENAME, inference)
        written.extend((destination / REJECTIONS_FILENAME, destination / INFERENCE_FILENAME))
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    finally:
        _clear_runtime_files(root / LAYOUT_DIRECTORY, destination)
    return inference


def predict_detection_validation(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:
    calibration = load_calibration_config(params_path)
    return run_detection_inference(
        "validation",
        min(calibration.confidence_thresholds),
        calibration.nms_iou_thresholds,
        VALIDATION_ROOT,
        params_path,
    )


def predict_detection_test(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    from .detection_calibration_evaluation import load_lock

    lock = load_lock(params_path)
    operating_point = lock["operating_point"]
    return run_detection_inference(
        "test",
        float(operating_point["confidence_threshold"]),
        (float(operating_point["nms_iou_threshold"]),),
        TEST_ROOT,
        params_path,
    )
