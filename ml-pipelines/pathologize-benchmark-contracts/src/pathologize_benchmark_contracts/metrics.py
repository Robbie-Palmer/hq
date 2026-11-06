from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from .artifacts import resolve_under
from .contracts import (
    ExperimentManifest,
    FixtureItem,
    NucleiPrediction,
    NucleusClass,
    Prediction,
    QualityPrediction,
    TilePrediction,
    TilingPrediction,
    Workstream,
)
from .synthetic import read_pnm


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 1.0


def _f1(true_positive: int, false_positive: int, false_negative: int) -> float:
    return _ratio(2 * true_positive, 2 * true_positive + false_positive + false_negative)


def _load_mask(root: Path, relative: str) -> list[int]:
    _, _, values = read_pnm(resolve_under(root, relative))
    return values


def _binary_overlap(truth: list[int], prediction: list[int]) -> tuple[int, int]:
    intersection = sum(
        bool(expected) and bool(observed)
        for expected, observed in zip(truth, prediction, strict=True)
    )
    union = sum(
        bool(expected) or bool(observed)
        for expected, observed in zip(truth, prediction, strict=True)
    )
    return intersection, union


def _artifact_class_counts(truth: list[int], prediction: list[int]) -> dict[int, list[int]]:
    return {
        label: [
            sum(
                expected == label and observed == label
                for expected, observed in zip(truth, prediction, strict=True)
            ),
            sum(
                expected != label and observed == label
                for expected, observed in zip(truth, prediction, strict=True)
            ),
            sum(
                expected == label and observed != label
                for expected, observed in zip(truth, prediction, strict=True)
            ),
        ]
        for label in (1, 2)
    }


def _quality_item_counts(
    item: FixtureItem, prediction: QualityPrediction, root: Path
) -> tuple[int, int, int, int, int, dict[int, list[int]]]:
    tissue_truth = _load_mask(root, item.tissue_mask_path)
    artifact_truth = _load_mask(root, item.artifact_mask_path)
    if len(prediction.tissue_labels) != len(tissue_truth):
        raise ValueError(f"quality mask length differs for {item.item_id}")
    tissue_intersection, tissue_union = _binary_overlap(tissue_truth, prediction.tissue_labels)
    clean_truth = [
        int(bool(tissue) and artifact == 0)
        for tissue, artifact in zip(tissue_truth, artifact_truth, strict=True)
    ]
    clean_prediction = [
        int(bool(tissue) and artifact == 0)
        for tissue, artifact in zip(
            prediction.tissue_labels, prediction.artifact_labels, strict=True
        )
    ]
    clean_intersection, _ = _binary_overlap(clean_truth, clean_prediction)
    return (
        tissue_intersection,
        tissue_union,
        clean_intersection,
        sum(clean_truth) + sum(clean_prediction),
        int(prediction.reject_slide == any(artifact_truth)),
        _artifact_class_counts(artifact_truth, prediction.artifact_labels),
    )


def evaluate_quality(
    items: list[FixtureItem], predictions: list[QualityPrediction], root: Path
) -> dict[str, float]:
    by_id = {prediction.item_id: prediction for prediction in predictions}
    tissue_intersection = tissue_union = 0
    clean_intersection = clean_total = 0
    rejection_correct = 0
    class_counts = {label: [0, 0, 0] for label in (1, 2)}
    for item in items:
        item_counts = _quality_item_counts(item, by_id[item.item_id], root)
        tissue_intersection += item_counts[0]
        tissue_union += item_counts[1]
        clean_intersection += item_counts[2]
        clean_total += item_counts[3]
        rejection_correct += item_counts[4]
        for label, counts in item_counts[5].items():
            class_counts[label] = [
                current + added for current, added in zip(class_counts[label], counts, strict=True)
            ]
    artifact_f1 = sum(_f1(*counts) for counts in class_counts.values()) / len(class_counts)
    return {
        "tissue_iou": _ratio(tissue_intersection, tissue_union),
        "artifact_macro_f1": artifact_f1,
        "artifact_free_tissue_dice": _ratio(2 * clean_intersection, clean_total),
        "slide_rejection_accuracy": _ratio(rejection_correct, len(items)),
    }


def _tile_key(tile: TilePrediction) -> tuple[int, int, int, int]:
    return tile.x, tile.y, tile.width, tile.height


def _tile_indices(x: int, y: int, width: int, height: int, image_width: int) -> set[int]:
    return {
        row * image_width + column for row in range(y, y + height) for column in range(x, x + width)
    }


def _expected_tiles(
    item: FixtureItem, truth: list[int], tile_size: int, minimum_tissue: float
) -> set[tuple[int, int, int, int]]:
    expected: set[tuple[int, int, int, int]] = set()
    for y in range(0, item.height - tile_size + 1, tile_size):
        for x in range(0, item.width - tile_size + 1, tile_size):
            indices = _tile_indices(x, y, tile_size, tile_size, item.width)
            tissue_fraction = sum(bool(truth[index]) for index in indices) / len(indices)
            if tissue_fraction >= minimum_tissue:
                expected.add((x, y, tile_size, tile_size))
    return expected


def _selected_tile_stats(
    item: FixtureItem,
    truth: list[int],
    selected: set[tuple[int, int, int, int]],
) -> tuple[int, int, int]:
    covered: set[int] = set()
    background = pixels = 0
    for x, y, width, height in selected:
        if x + width > item.width or y + height > item.height:
            raise ValueError(f"tile escapes image bounds for {item.item_id}")
        indices = _tile_indices(x, y, width, height, item.width)
        covered.update(indices)
        background += sum(not truth[index] for index in indices)
        pixels += len(indices)
    covered_tissue = sum(bool(truth[index]) for index in covered)
    return covered_tissue, background, pixels


def evaluate_tiling(
    manifest: ExperimentManifest,
    items: list[FixtureItem],
    predictions: list[TilingPrediction],
    root: Path,
) -> dict[str, float]:
    by_id = {prediction.item_id: prediction for prediction in predictions}
    true_positive = false_positive = false_negative = 0
    covered_tissue = total_tissue = selected_background = selected_pixels = 0
    scale_errors: list[float] = []
    tile_size = int(manifest.parameters["tile_size"])
    minimum_tissue = float(manifest.parameters["minimum_tissue_fraction"])
    expected_mpp = float(manifest.parameters["target_microns_per_pixel"])
    for item in items:
        truth = _load_mask(root, item.tissue_mask_path)
        prediction = by_id[item.item_id]
        expected = _expected_tiles(item, truth, tile_size, minimum_tissue)
        selected = {_tile_key(tile) for tile in prediction.tiles}
        true_positive += len(expected & selected)
        false_positive += len(selected - expected)
        false_negative += len(expected - selected)
        item_covered, item_background, item_pixels = _selected_tile_stats(item, truth, selected)
        covered_tissue += item_covered
        selected_background += item_background
        selected_pixels += item_pixels
        total_tissue += sum(bool(value) for value in truth)
        scale_errors.append(abs(prediction.target_microns_per_pixel - expected_mpp) / expected_mpp)
    return {
        "tile_selection_f1": _f1(true_positive, false_positive, false_negative),
        "tissue_coverage": _ratio(covered_tissue, total_tissue),
        "selected_background_fraction": _ratio(selected_background, selected_pixels),
        "magnification_relative_error": sum(scale_errors) / len(scale_errors),
    }


def _truth_instances(
    item: FixtureItem, root: Path
) -> tuple[dict[int, set[int]], dict[int, NucleusClass]]:
    mask = _load_mask(root, item.nucleus_instance_mask_path)
    instances: dict[int, set[int]] = defaultdict(set)
    for index, instance_id in enumerate(mask):
        if instance_id:
            instances[instance_id].add(index)
    classes = {truth.instance_id: truth.class_name for truth in item.nucleus_truth}
    if set(instances) != set(classes):
        raise ValueError(f"nucleus truth IDs differ from mask for {item.item_id}")
    return dict(instances), classes


def _match_instances(
    truth: dict[int, set[int]], prediction: NucleiPrediction, threshold: float
) -> list[tuple[int, int, float]]:
    candidates: list[tuple[float, int, int]] = []
    for truth_id, truth_pixels in truth.items():
        for predicted in prediction.instances:
            predicted_pixels = set(predicted.pixels)
            intersection = len(truth_pixels & predicted_pixels)
            union = len(truth_pixels | predicted_pixels)
            iou = _ratio(intersection, union)
            if iou > threshold:
                candidates.append((iou, truth_id, predicted.instance_id))
    matched_truth: set[int] = set()
    matched_prediction: set[int] = set()
    matches: list[tuple[int, int, float]] = []
    for iou, truth_id, prediction_id in sorted(candidates, reverse=True):
        if truth_id not in matched_truth and prediction_id not in matched_prediction:
            matched_truth.add(truth_id)
            matched_prediction.add(prediction_id)
            matches.append((truth_id, prediction_id, iou))
    return matches


def evaluate_nuclei(
    manifest: ExperimentManifest,
    items: list[FixtureItem],
    predictions: list[NucleiPrediction],
    root: Path,
) -> dict[str, float]:
    by_id = {prediction.item_id: prediction for prediction in predictions}
    threshold = float(manifest.parameters["instance_match_iou"])
    true_positive = false_positive = false_negative = 0
    intersection = truth_pixels_total = predicted_pixels_total = 0
    matched_iou = 0.0
    class_counts = {
        class_name: [0, 0, 0] for class_name in ("synthetic_type_a", "synthetic_type_b")
    }
    for item in items:
        truth, truth_classes = _truth_instances(item, root)
        prediction = by_id[item.item_id]
        prediction_by_id = {instance.instance_id: instance for instance in prediction.instances}
        if len(prediction_by_id) != len(prediction.instances):
            raise ValueError(f"predicted nucleus IDs are not unique for {item.item_id}")
        matches = _match_instances(truth, prediction, threshold)
        true_positive += len(matches)
        false_positive += len(prediction.instances) - len(matches)
        false_negative += len(truth) - len(matches)
        matched_iou += sum(match[2] for match in matches)
        truth_union = set().union(*truth.values()) if truth else set()
        predicted_union = (
            set().union(*(set(instance.pixels) for instance in prediction.instances))
            if prediction.instances
            else set()
        )
        intersection += len(truth_union & predicted_union)
        truth_pixels_total += len(truth_union)
        predicted_pixels_total += len(predicted_union)
        matched_truth = {truth_id for truth_id, _, _ in matches}
        matched_prediction = {prediction_id for _, prediction_id, _ in matches}
        for class_name, counts in class_counts.items():
            counts[0] += sum(
                truth_classes[truth_id] == class_name
                and prediction_by_id[prediction_id].class_name == class_name
                for truth_id, prediction_id, _ in matches
            )
            counts[1] += sum(
                instance.class_name == class_name and instance.instance_id not in matched_prediction
                for instance in prediction.instances
            )
            counts[1] += sum(
                prediction_by_id[prediction_id].class_name == class_name
                and truth_classes[truth_id] != class_name
                for truth_id, prediction_id, _ in matches
            )
            counts[2] += sum(
                truth_classes[truth_id] == class_name and truth_id not in matched_truth
                for truth_id in truth
            )
            counts[2] += sum(
                truth_classes[truth_id] == class_name
                and prediction_by_id[prediction_id].class_name != class_name
                for truth_id, prediction_id, _ in matches
            )
    classification_f1 = sum(_f1(*counts) for counts in class_counts.values()) / len(class_counts)
    denominator = true_positive + 0.5 * false_positive + 0.5 * false_negative
    return {
        "detection_f1": _f1(true_positive, false_positive, false_negative),
        "semantic_dice": _ratio(2 * intersection, truth_pixels_total + predicted_pixels_total),
        "mean_matched_iou": _ratio(matched_iou, true_positive),
        "classification_macro_f1": classification_f1,
        "binary_panoptic_quality": _ratio(matched_iou, denominator),
    }


def evaluate_predictions(
    manifest: ExperimentManifest,
    items: list[FixtureItem],
    predictions: list[Prediction],
    root: Path,
) -> dict[str, float]:
    if len(predictions) != len(items):
        raise ValueError("prediction count differs from the evaluation cohort")
    if manifest.workstream == Workstream.SLIDE_QUALITY:
        return evaluate_quality(
            items,
            [prediction for prediction in predictions if isinstance(prediction, QualityPrediction)],
            root,
        )
    if manifest.workstream == Workstream.TILING_POLICY:
        return evaluate_tiling(
            manifest,
            items,
            [prediction for prediction in predictions if isinstance(prediction, TilingPrediction)],
            root,
        )
    return evaluate_nuclei(
        manifest,
        items,
        [prediction for prediction in predictions if isinstance(prediction, NucleiPrediction)],
        root,
    )
