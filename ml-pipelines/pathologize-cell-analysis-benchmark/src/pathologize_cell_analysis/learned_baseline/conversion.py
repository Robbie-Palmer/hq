from __future__ import annotations

import json
import shutil
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from data_artifacts.files import sha256_file, write_json
from PIL import Image
from ultralytics_extensions.labels import bbox_to_yolo, polygon_to_yolo

from ..contracts import LearnedBaselineConfig, SplitItem
from ..data import (
    Annotation,
    _HttpsOnlyRedirectHandler,
    build_cohort,
    load_annotations,
    load_dataset_manifest,
)
from .config import (
    PARAMS_FILE,
    load_config,
    project_root,
)

Task = Literal["detect", "segment"]


@dataclass(frozen=True)
class ConversionExclusion:
    task: Task
    reason: str
    annotation_index: int
    class_name: str


@dataclass(frozen=True)
class ConversionResult:
    labels: tuple[str, ...]
    exclusions: tuple[ConversionExclusion, ...]
    adjustments: tuple[ConversionExclusion, ...]


@dataclass(frozen=True)
class AnnotationConversion:
    values: tuple[float, ...] | None = None
    exclusion: ConversionExclusion | None = None
    adjustment: ConversionExclusion | None = None


def _download_pinned_file(url: str, output: Path, size: int | None, digest: str) -> None:
    if not url.startswith("https://"):
        raise ValueError("model artifact URL must use HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "Pathologize/1.0"})  # noqa: S310
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler())
    with opener.open(request, timeout=60) as response, output.open("wb") as target:
        shutil.copyfileobj(response, target, length=1024 * 1024)
    if size is not None and output.stat().st_size != size:
        raise ValueError(f"model artifact byte count differs for {output.name}")
    if sha256_file(output) != digest:
        raise ValueError(f"model artifact digest differs for {output.name}")


def acquire_model_artifacts(
    params_path: Path = PARAMS_FILE,
) -> dict[str, object]:
    experiment = load_config(params_path)
    root = project_root(params_path)
    output_root = root / experiment.weights_directory
    if output_root.exists():
        raise FileExistsError(f"Ultralytics artifact output already exists: {output_root}")
    complete = False
    try:
        output_root.mkdir(parents=True)
        artifacts: list[object] = []
        for task, model in experiment.models.items():
            weights_path = output_root / model.weights
            definition_path = output_root / Path(model.definition).name
            _download_pinned_file(
                str(model.weights_url), weights_path, model.weights_bytes, model.weights_sha256
            )
            _download_pinned_file(
                str(model.definition_url), definition_path, None, model.definition_sha256
            )
            artifacts.extend(
                (
                    {
                        "task": task,
                        "kind": "starting_weights",
                        "path": weights_path.relative_to(root).as_posix(),
                        "url": str(model.weights_url),
                        "bytes": weights_path.stat().st_size,
                        "sha256": model.weights_sha256,
                        "license": model.weights_license,
                    },
                    {
                        "task": task,
                        "kind": "model_definition",
                        "path": definition_path.relative_to(root).as_posix(),
                        "url": str(model.definition_url),
                        "bytes": definition_path.stat().st_size,
                        "sha256": model.definition_sha256,
                        "license": experiment.package.license,
                    },
                )
            )
        result: dict[str, object] = {
            "schema_version": "1.0.0",
            "package": experiment.package.model_dump(mode="json"),
            "artifacts": artifacts,
        }
        write_json(output_root / "manifest.json", result)
        complete = True
    finally:
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return result


def _format_label(class_index: int, values: tuple[float, ...]) -> str:
    return " ".join((str(class_index), *(f"{value:.8f}" for value in values)))


def _convert_box(
    annotation: Annotation,
    annotation_index: int,
    image_size: tuple[int, int],
    maximum_border_clip_pixels: float,
) -> AnnotationConversion:
    if annotation.annotation_type == "point":
        return AnnotationConversion(
            exclusion=ConversionExclusion(
                "detect", "point_has_no_area", annotation_index, annotation.class_name
            )
        )
    width, height = image_size
    source_bbox = (
        float(annotation.xmin),
        float(annotation.ymin),
        float(annotation.xmax),
        float(annotation.ymax),
    )
    clipped_bbox = (
        min(max(source_bbox[0], 0.0), float(width)),
        min(max(source_bbox[1], 0.0), float(height)),
        min(max(source_bbox[2], 0.0), float(width)),
        min(max(source_bbox[3], 0.0), float(height)),
    )
    maximum_clip = max(
        abs(source - clipped) for source, clipped in zip(source_bbox, clipped_bbox, strict=True)
    )
    invalid = ConversionExclusion(
        "detect", "invalid_source_box", annotation_index, annotation.class_name
    )
    if maximum_clip > maximum_border_clip_pixels:
        return AnnotationConversion(exclusion=invalid)
    try:
        values = bbox_to_yolo(clipped_bbox, image_size)
    except ValueError:
        return AnnotationConversion(exclusion=invalid)
    adjustment = (
        ConversionExclusion(
            "detect", "clipped_to_image_bounds", annotation_index, annotation.class_name
        )
        if clipped_bbox != source_bbox
        else None
    )
    return AnnotationConversion(values=values, adjustment=adjustment)


def _convert_polygon(
    annotation: Annotation,
    annotation_index: int,
    image_size: tuple[int, int],
    maximum_border_clip_pixels: float,
) -> AnnotationConversion:
    if annotation.annotation_type != "polyline":
        return AnnotationConversion(
            exclusion=ConversionExclusion(
                "segment",
                f"{annotation.annotation_type}_has_no_polygon",
                annotation_index,
                annotation.class_name,
            )
        )
    source_coordinates = tuple(zip(annotation.coordinates_x, annotation.coordinates_y, strict=True))
    width, height = image_size
    coordinates = tuple(
        (
            min(max(float(x), 0.0), float(width)),
            min(max(float(y), 0.0), float(height)),
        )
        for x, y in source_coordinates
    )
    maximum_clip = max(
        (
            max(abs(source_x - clipped_x), abs(source_y - clipped_y))
            for (source_x, source_y), (clipped_x, clipped_y) in zip(
                source_coordinates, coordinates, strict=True
            )
        ),
        default=0.0,
    )
    invalid = ConversionExclusion(
        "segment", "invalid_source_polygon", annotation_index, annotation.class_name
    )
    if maximum_clip > maximum_border_clip_pixels:
        return AnnotationConversion(exclusion=invalid)
    try:
        values = polygon_to_yolo(coordinates, image_size)
    except ValueError:
        return AnnotationConversion(exclusion=invalid)
    adjustment = (
        ConversionExclusion(
            "segment", "clipped_to_image_bounds", annotation_index, annotation.class_name
        )
        if coordinates != source_coordinates
        else None
    )
    return AnnotationConversion(values=values, adjustment=adjustment)


def convert_annotations(
    annotations: list[Annotation],
    image_size: tuple[int, int],
    ontology_labels: list[str],
    task: Task,
    maximum_border_clip_pixels: float = 0.0,
) -> ConversionResult:
    class_indices = {label: index for index, label in enumerate(ontology_labels)}
    labels: list[str] = []
    exclusions: list[ConversionExclusion] = []
    adjustments: list[ConversionExclusion] = []
    for index, annotation in enumerate(annotations):
        if annotation.class_name not in class_indices:
            exclusions.append(
                ConversionExclusion(
                    task, "class_not_in_source_ontology", index, annotation.class_name
                )
            )
            continue
        converted = (
            _convert_box(annotation, index, image_size, maximum_border_clip_pixels)
            if task == "detect"
            else _convert_polygon(annotation, index, image_size, maximum_border_clip_pixels)
        )
        if converted.exclusion is not None:
            exclusions.append(converted.exclusion)
            continue
        if converted.adjustment is not None:
            adjustments.append(converted.adjustment)
        if converted.values is None:
            raise RuntimeError("annotation conversion produced no result")
        labels.append(_format_label(class_indices[annotation.class_name], converted.values))
    return ConversionResult(tuple(labels), tuple(exclusions), tuple(adjustments))


def _write_dataset_yaml(path: Path, task: Task, experiment: LearnedBaselineConfig) -> None:
    names = "\n".join(
        f"  {index}: {json.dumps(label)}" for index, label in enumerate(experiment.ontology_labels)
    )
    path.write_text(
        "\n".join(
            (
                f"path: {experiment.layout_directory}/{task}",
                "train: images/train",
                "val: images/validation",
                "test: images/test",
                "names:",
                names,
                "",
            )
        ),
        encoding="utf-8",
    )


def _convert_item(
    item: SplitItem,
    data_root: Path,
    output_root: Path,
    experiment: LearnedBaselineConfig,
    exclusion_counts: dict[str, Counter[str]],
    adjustment_counts: dict[str, Counter[str]],
) -> dict[str, object]:
    image_path = data_root / item.image_path
    with Image.open(image_path) as image:
        image_size = image.size
    annotations = load_annotations(data_root / item.annotation_path)
    task_records: dict[str, object] = {}
    for task in ("detect", "segment"):
        task_root = output_root / task
        derived_image = task_root / "images" / item.split / image_path.name
        label_path = task_root / "labels" / item.split / f"{item.item_id}.txt"
        derived_image.parent.mkdir(parents=True, exist_ok=True)
        label_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, derived_image)
        converted = convert_annotations(
            annotations,
            image_size,
            experiment.ontology_labels,
            task,
            experiment.maximum_border_clip_pixels,
        )
        label_path.write_text(
            "" if not converted.labels else "\n".join(converted.labels) + "\n",
            encoding="utf-8",
        )
        for exclusion in converted.exclusions:
            exclusion_counts[task][exclusion.reason] += 1
        for adjustment in converted.adjustments:
            adjustment_counts[task][adjustment.reason] += 1
        task_records[task] = {
            "label_path": label_path.relative_to(output_root).as_posix(),
            "label_count": len(converted.labels),
            "empty_image": not converted.labels,
            "exclusions": [exclusion.__dict__ for exclusion in converted.exclusions],
            "adjustments": [adjustment.__dict__ for adjustment in converted.adjustments],
        }
    return {
        "item_id": item.item_id,
        "slide_id": item.slide_id,
        "patient_id": item.patient_id,
        "site_id": item.site_id,
        "split": item.split,
        "source_image": item.image_path,
        "source_annotation": item.annotation_path,
        "source_image_sha256": sha256_file(image_path),
        "image_width": image_size[0],
        "image_height": image_size[1],
        "source_annotation_count": len(annotations),
        "tasks": task_records,
    }


def prepare_training_layout(
    params_path: Path = PARAMS_FILE,
) -> dict[str, object]:
    experiment = load_config(params_path)
    root = project_root(params_path)
    data_root = root / experiment.data_directory
    output_root = root / experiment.layout_directory
    if output_root.exists():
        raise FileExistsError(f"Ultralytics layout already exists: {output_root}")
    manifest = load_dataset_manifest(root / experiment.dataset_manifest)
    expected_ontology = [*manifest.classification_labels, *manifest.unmappable_categories]
    if experiment.ontology_labels != expected_ontology:
        raise ValueError("Ultralytics ontology differs from the pinned public source ontology")
    cohort = build_cohort(data_root, experiment.test_fold, experiment.validation_fold)
    complete = False
    try:
        output_root.mkdir(parents=True)
        exclusion_counts: dict[str, Counter[str]] = {
            "detect": Counter(),
            "segment": Counter(),
        }
        adjustment_counts: dict[str, Counter[str]] = {
            "detect": Counter(),
            "segment": Counter(),
        }
        item_records = [
            _convert_item(
                item,
                data_root,
                output_root,
                experiment,
                exclusion_counts,
                adjustment_counts,
            )
            for item in cohort.items
        ]
        for task in ("detect", "segment"):
            _write_dataset_yaml(output_root / f"{task}.yaml", task, experiment)
        result: dict[str, object] = {
            "schema_version": "1.0.0",
            "experiment_id": experiment.experiment_id,
            "dataset_id": manifest.dataset_id,
            "source_ontology": experiment.ontology_labels,
            "ontology_mapping_performed": False,
            "coordinate_semantics": (
                "Source pixel-edge coordinates use x from the left and y from the top. "
                "Boxes are xmin,ymin,xmax,ymax and polygons retain source vertices. "
                "Only Ultralytics label serialization normalizes values by image width and height."
            ),
            "leakage_units": ["patient_id", "slide_id"],
            "split": cohort.model_dump(mode="json"),
            "items": item_records,
            "exclusion_counts": {
                task: dict(sorted(counts.items())) for task, counts in exclusion_counts.items()
            },
            "adjustment_counts": {
                task: dict(sorted(counts.items())) for task, counts in adjustment_counts.items()
            },
            "ignored_regions": [],
            "ambiguous_source_categories": list(manifest.unmappable_categories),
        }
        write_json(output_root / "manifest.json", result)
        complete = True
    finally:
        if not complete:
            shutil.rmtree(output_root, ignore_errors=True)
    return result
