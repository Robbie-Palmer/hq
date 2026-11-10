from __future__ import annotations

from pathlib import Path
from typing import Any

from data_artifacts.files import read_json, sha256_file, write_json

from .config import PROJECT_ROOT, data_root, load_config, ontology_labels
from .detection_calibration_contracts import (
    BASELINE_TEST_PREDICTIONS,
    CALIBRATION_PARAMS_FILE,
    EVIDENCE_FILENAME,
    INFERENCE_FILENAME,
    LOCK_PATH,
    REJECTIONS_FILENAME,
    TEST_ROOT,
    VALIDATION_ROOT,
    load_calibration_config,
    localization,
    prediction_path,
    prediction_records,
    resource_summary,
    slice_localization,
    split_items,
)
from .detection_calibration_statistics import (
    evaluate_detection_records,
    paired_slide_bootstrap,
)


def lock_detection_calibration(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    validation_evidence_path = VALIDATION_ROOT / EVIDENCE_FILENAME
    evidence = read_json(validation_evidence_path)
    if not evidence["passed"]:
        raise RuntimeError("validation gate failed; refusing to lock a test operating point")
    if LOCK_PATH.exists():
        raise FileExistsError(f"calibration lock already exists: {LOCK_PATH}")
    lock: dict[str, object] = {
        "schema_version": "1.0.0",
        "selection_split": "validation",
        "operating_point": evidence["selected"]["operating_point"],
        "validation_evidence_sha256": sha256_file(validation_evidence_path),
        "parameters_sha256": sha256_file(params_path),
        "maximum_test_evaluations": 1,
    }
    write_json(LOCK_PATH, lock)
    return lock


def load_lock(params_path: Path) -> dict[str, Any]:  # pragma: no cover
    lock = read_json(LOCK_PATH)
    if lock["parameters_sha256"] != sha256_file(params_path):
        raise ValueError("calibration parameters changed after the operating point was locked")
    return lock


def evaluate_detection_test(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config()
    calibration = load_calibration_config(params_path)
    lock = load_lock(params_path)
    evidence_path = TEST_ROOT / EVIDENCE_FILENAME
    if evidence_path.exists():
        raise FileExistsError(f"test evidence already exists: {evidence_path}")
    operating_point = lock["operating_point"]
    nms_iou = float(operating_point["nms_iou_threshold"])
    candidate_records = prediction_records(prediction_path(TEST_ROOT, nms_iou))
    baseline_records = prediction_records(PROJECT_ROOT / BASELINE_TEST_PREDICTIONS)
    items = split_items("test")
    labels = ontology_labels()
    source_root = data_root()
    baseline = evaluate_detection_records(
        baseline_records, items, source_root, labels, config.localization_tolerance_pixels
    )
    candidate = evaluate_detection_records(
        candidate_records, items, source_root, labels, config.localization_tolerance_pixels
    )
    uncertainty = paired_slide_bootstrap(
        baseline_records,
        candidate_records,
        items,
        source_root,
        calibration.bootstrap_resamples,
        calibration.bootstrap_seed,
        config.localization_tolerance_pixels,
    )
    baseline_localization = localization(baseline["localization"])
    candidate_localization = localization(candidate["localization"])
    validation_inference = read_json(VALIDATION_ROOT / INFERENCE_FILENAME)
    test_inference = read_json(TEST_ROOT / INFERENCE_FILENAME)
    validation_resources = resource_summary(validation_inference["resources"])
    test_resources = resource_summary(test_inference["resources"])
    failures = read_json(TEST_ROOT / REJECTIONS_FILENAME)
    evidence: dict[str, object] = {
        "schema_version": "1.0.0",
        "split": "test",
        "operating_point": operating_point,
        "baseline": {
            "localization": baseline_localization,
            "per_class": slice_localization(baseline, "per_class"),
            "held_out_sites": slice_localization(baseline, "held_out_site_slices"),
        },
        "calibrated": {
            "localization": candidate_localization,
            "per_class": slice_localization(candidate, "per_class"),
            "held_out_sites": slice_localization(candidate, "held_out_site_slices"),
        },
        "delta": {
            key: float(candidate_localization[key]) - float(baseline_localization[key])
            for key in ("precision", "recall", "f1")
        },
        "uncertainty": uncertainty,
        "failures": failures,
        "resources": {
            "validation_inference": validation_resources,
            "test_inference": test_resources,
            "calibration_total": {
                "wall_seconds": validation_resources["wall_seconds"]
                + test_resources["wall_seconds"],
                "gpu_seconds": validation_resources["gpu_seconds"] + test_resources["gpu_seconds"],
                "peak_vram_bytes": max(
                    validation_resources["peak_vram_bytes"], test_resources["peak_vram_bytes"]
                ),
            },
        },
        "apparent_false_positive_interpretation": (
            "Unmatched predictions remain unmatched annotations. They are not called artifacts "
            "unless blinded review distinguishes true artifacts from biologically present but "
            "unlabelled nuclei."
        ),
        "test_evaluations_performed": 1,
        "clinical_validity": False,
    }
    write_json(evidence_path, evidence)
    return evidence
