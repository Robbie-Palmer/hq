from __future__ import annotations

import os
import resource
import shutil
import time
from pathlib import Path
from typing import Any, cast

from data_artifacts.files import read_json, sha256_file, write_json

from ..learned_baseline.config import LAYOUT_DIRECTORY, cohort, ontology_labels
from .config import OUTPUT_ROOT, PARAMS_FILE, PROJECT_ROOT, load_config, seed_output
from .evaluation import _split_evidence


def _peak_rss_bytes() -> int:
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)


def _box_metrics(validation: Any) -> dict[str, float]:
    box = validation.box
    return {"mAP50": float(box.map50), "mAP50_95": float(box.map)}


def evaluate_test(params_path: str = str(PARAMS_FILE)) -> dict[str, object]:  # pragma: no cover
    config = load_config(Path(params_path))
    analysis = read_json(OUTPUT_ROOT / "analysis" / "evidence.json")
    if not isinstance(analysis, dict):
        raise TypeError("curve analysis must be an object")
    if analysis.get("selection_policy") != "fixed_epoch_120_endpoint":
        raise ValueError("sealed test evaluation requires the fixed endpoint policy")
    output = OUTPUT_ROOT / "test"
    evidence_path = output / "evidence.json"
    if evidence_path.is_file():
        value = read_json(evidence_path)
        if not isinstance(value, dict):
            raise TypeError("test evidence must be an object")
        return cast(dict[str, object], value)
    output.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(output / "ultralytics-config")
    from torch import cuda
    from ultralytics import YOLO

    if not cuda.is_available():
        raise RuntimeError("the predeclared CUDA accelerator is unavailable")
    product = cohort()
    items = {item.item_id: item for item in product.items if item.split == "test"}
    labels = ontology_labels()
    seed_results: dict[str, object] = {}
    aggregate_gpu_seconds = 0.0
    peak_vram = 0
    wall_start = time.monotonic()
    cpu_start = time.process_time()
    for seed in config.seeds:
        run = read_json(seed_output(seed) / "run.json")
        if not isinstance(run, dict):
            raise TypeError("training evidence must be an object")
        endpoint = next(
            (
                checkpoint
                for checkpoint in run["checkpoints"]
                if int(checkpoint["epoch"]) == config.training.epochs
            ),
            None,
        )
        if endpoint is None:
            raise ValueError(f"seed {seed} did not reach the fixed test endpoint")
        checkpoint = PROJECT_ROOT / str(endpoint["path"])
        if sha256_file(checkpoint) != endpoint["sha256"]:
            raise ValueError(f"seed {seed} endpoint checkpoint digest differs")
        model = YOLO(str(checkpoint), task="detect")
        cuda.reset_peak_memory_stats()
        start_event = cuda.Event(enable_timing=True)
        end_event = cuda.Event(enable_timing=True)
        seed_wall_start = time.monotonic()
        seed_cpu_start = time.process_time()
        start_event.record()
        pathologize, failures = _split_evidence(model, "test", items, labels, config)
        validation = model.val(
            data=str(PROJECT_ROOT / LAYOUT_DIRECTORY / "detect.yaml"),
            split="test",
            batch=config.training.batch,
            imgsz=config.training.image_size,
            device=config.training.device,
            workers=config.training.workers,
            plots=False,
            verbose=False,
        )
        end_event.record()
        cuda.synchronize()
        gpu_seconds = start_event.elapsed_time(end_event) / 1000
        seed_peak_vram = int(cuda.max_memory_allocated())
        aggregate_gpu_seconds += gpu_seconds
        peak_vram = max(peak_vram, seed_peak_vram)
        seed_results[str(seed)] = {
            "endpoint_epoch": config.training.epochs,
            "checkpoint": endpoint,
            "pathologize": pathologize,
            "ultralytics": _box_metrics(validation),
            "failures": failures,
            "resources": {
                "wall_seconds": time.monotonic() - seed_wall_start,
                "cpu_seconds": time.process_time() - seed_cpu_start,
                "gpu_seconds": gpu_seconds,
                "peak_rss_bytes": _peak_rss_bytes(),
                "peak_vram_bytes": seed_peak_vram,
            },
        }
        del model
        cuda.empty_cache()
    training_gpu_seconds = sum(
        float(read_json(seed_output(seed) / "run.json")["resources"]["gpu_seconds"])
        for seed in config.seeds
    )
    curve_gpu_seconds = sum(
        float(
            read_json(OUTPUT_ROOT / "curves" / str(seed) / "curve.json")["resources"]["gpu_seconds"]
        )
        for seed in config.seeds
    )
    total_gpu_seconds = training_gpu_seconds + curve_gpu_seconds + aggregate_gpu_seconds
    if total_gpu_seconds > config.limits.aggregate_gpu_seconds:
        raise RuntimeError("experiment exceeded the aggregate GPU-time ceiling")
    if peak_vram > config.limits.maximum_peak_vram_bytes:
        raise RuntimeError("test evaluation exceeded the peak VRAM ceiling")
    result: dict[str, object] = {
        "schema_version": "1.0.0",
        "experiment_id": config.experiment_id,
        "selection_policy": "fixed_epoch_120_endpoint",
        "seeds": seed_results,
        "resources": {
            "wall_seconds": time.monotonic() - wall_start,
            "cpu_seconds": time.process_time() - cpu_start,
            "gpu_seconds": aggregate_gpu_seconds,
            "peak_rss_bytes": _peak_rss_bytes(),
            "peak_vram_bytes": peak_vram,
            "experiment_gpu_seconds": total_gpu_seconds,
            "experiment_gpu_ceiling_seconds": config.limits.aggregate_gpu_seconds,
        },
    }
    shutil.rmtree(output / "ultralytics-config", ignore_errors=True)
    for cache_path in (PROJECT_ROOT / LAYOUT_DIRECTORY).rglob("*.cache"):
        cache_path.unlink()
    write_json(evidence_path, result)
    return result
