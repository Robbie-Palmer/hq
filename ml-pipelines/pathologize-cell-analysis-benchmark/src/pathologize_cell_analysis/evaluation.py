from __future__ import annotations

import math
import resource
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from data_artifacts.files import sha256_bytes, write_json, write_jsonl
from numpy.typing import NDArray

from .classification import (
    ClassificationRecords,
    classification_metrics,
    update_classification_records,
    validate_probabilities,
)
from .contracts import (
    PublicBaselineConfig,
    ResourceEvidence,
    RunEvidence,
    TaskEvidence,
)
from .data import Annotation, SplitItem, load_annotations
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
from .methods import Classifier, PredictedNucleus, load_rgb, segment_nuclei

FloatArray = NDArray[np.float64]


@dataclass
class SliceRecords:
    localization: LocalizationRecords = field(default_factory=LocalizationRecords)
    instance_segmentation: InstanceSegmentationRecords = field(
        default_factory=InstanceSegmentationRecords
    )
    classification: ClassificationRecords = field(default_factory=ClassificationRecords)


def _slice_metrics(
    records: SliceRecords, classes: tuple[str, ...], tolerance_pixels: float
) -> tuple[TaskEvidence, dict[str, dict[str, float | int]]]:
    classification, per_class = classification_metrics(records.classification, classes)
    return TaskEvidence(
        localization=localization_metrics(records.localization, tolerance_pixels),
        instance_segmentation=segmentation_metrics(records.instance_segmentation),
        classification=classification,
    ), per_class


def _prediction_record(
    item: SplitItem,
    prediction: PredictedNucleus,
    probabilities: FloatArray,
    classes: tuple[str, ...],
) -> dict[str, object]:
    return {
        "field_sha256": _field_sha256(item),
        "instance_id": prediction.instance_id,
        "center": [prediction.center_x, prediction.center_y],
        "bbox": list(prediction.bbox),
        "class_probabilities": {
            label: float(probabilities[index]) for index, label in enumerate(classes)
        },
    }


def _field_sha256(item: SplitItem) -> str:
    return sha256_bytes(item.item_id.encode("utf-8"))


def _update_records(
    records: SliceRecords,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    probabilities: FloatArray,
    matches: list[tuple[int, int]],
    classes: tuple[str, ...],
    image_shape: tuple[int, int],
    exclusions: Counter[str],
) -> None:
    update_localization_records(records.localization, truth, predictions, matches)
    update_segmentation_records(
        records.instance_segmentation,
        truth,
        predictions,
        matches,
        image_shape,
    )
    exclusions.update(
        update_classification_records(
            records.classification,
            [annotation.class_name for annotation in truth],
            probabilities,
            matches,
            classes,
        )
    )


def _peak_rss_bytes() -> int:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(usage * 1024)


def evaluate_adapter(
    experiment: PublicBaselineConfig,
    data_root: Path,
    output_root: Path,
    classifier: Classifier,
    train_items: list[SplitItem],
    test_items: list[SplitItem],
) -> RunEvidence:
    start_wall = time.monotonic()
    start_cpu = time.process_time()
    deadline = start_wall + experiment.per_run_wall_seconds
    classifier.fit(data_root, train_items)
    aggregate = SliceRecords()
    sites: dict[str, SliceRecords] = defaultdict(SliceRecords)
    exclusions: Counter[str] = Counter()
    failures: list[dict[str, str]] = []
    prediction_records: list[dict[str, object]] = []
    prediction_path = output_root / classifier.adapter_id / "predictions.jsonl"
    for item in test_items:
        if time.monotonic() > deadline:
            failures.append(
                {
                    "field_sha256": _field_sha256(item),
                    "error_type": "WallTimeCeilingExceeded",
                    "message": f"run exceeded {experiment.per_run_wall_seconds} seconds",
                }
            )
            break
        try:
            image = load_rgb(data_root / item.image_path)
            truth = load_annotations(data_root / item.annotation_path)
            predictions = segment_nuclei(
                image,
                experiment.minimum_nucleus_pixels,
                experiment.watershed_minimum_distance_pixels,
            )
            probabilities = classifier.probabilities(image, predictions)
            validate_probabilities(probabilities, len(predictions), len(classifier.classes))
            matches = match_localizations(
                truth, predictions, experiment.localization_tolerance_pixels
            )
            _update_records(
                aggregate,
                truth,
                predictions,
                probabilities,
                matches,
                classifier.classes,
                image.shape[:2],
                exclusions,
            )
            _update_records(
                sites[item.site_id],
                truth,
                predictions,
                probabilities,
                matches,
                classifier.classes,
                image.shape[:2],
                Counter(),
            )
            prediction_records.extend(
                _prediction_record(
                    item,
                    prediction,
                    np.asarray(probability, dtype=np.float64),
                    classifier.classes,
                )
                for prediction, probability in zip(predictions, probabilities, strict=True)
            )
        except Exception as error:
            failures.append(
                {
                    "field_sha256": _field_sha256(item),
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
            )
    write_jsonl(prediction_path, prediction_records)
    tasks, per_class = _slice_metrics(
        aggregate, classifier.classes, experiment.localization_tolerance_pixels
    )
    site_slices = {
        site: _slice_metrics(records, classifier.classes, experiment.localization_tolerance_pixels)[
            0
        ]
        for site, records in sorted(sites.items())
    }
    wall_seconds = time.monotonic() - start_wall
    resources = ResourceEvidence(
        wall_seconds=wall_seconds,
        cpu_seconds=time.process_time() - start_cpu,
        gpu_seconds=0,
        peak_rss_bytes=_peak_rss_bytes(),
        peak_vram_bytes=0,
        accelerator="none",
        per_run_wall_ceiling_seconds=experiment.per_run_wall_seconds,
        aggregate_gpu_ceiling_seconds=experiment.aggregate_accelerator_seconds,
    )
    result = RunEvidence(
        adapter_id=classifier.adapter_id,
        localization=tasks.localization,
        instance_segmentation=tasks.instance_segmentation,
        classification=tasks.classification,
        per_class=per_class,
        site_slices=site_slices,
        exclusions=dict(sorted(exclusions.items())),
        failures=failures,
        resources=resources,
    )
    write_json(prediction_path.parent / "run.json", result)
    if not math.isfinite(result.classification.brier):
        raise ValueError("run produced a non-finite calibration metric")
    return result
