from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Task = Literal["detect", "segment"]


@dataclass(frozen=True)
class SpatialInstance:
    instance_id: int
    class_name: str
    confidence: float
    bbox_xyxy_pixels: tuple[float, float, float, float]
    polygon_xy_pixels: tuple[tuple[float, float], ...] | None


def normalize_result(
    result: Any,
    task: Task,
    class_names: list[str],
) -> tuple[int, int, list[SpatialInstance], list[dict[str, object]]]:
    height, width = (int(value) for value in result.orig_shape)
    predictions: list[SpatialInstance] = []
    rejections: list[dict[str, object]] = []
    if result.boxes is None:
        return width, height, predictions, rejections
    xyxy = result.boxes.xyxy.cpu().numpy()
    confidences = result.boxes.conf.cpu().numpy()
    classes = result.boxes.cls.cpu().numpy()
    mask_polygons = result.masks.xy if result.masks is not None else []
    for instance_id, (bbox, confidence, class_value) in enumerate(
        zip(xyxy, confidences, classes, strict=True), start=1
    ):
        class_index = int(class_value)
        if class_index < 0 or class_index >= len(class_names):
            rejections.append(
                {
                    "instance_id": instance_id,
                    "reason": "class_index_out_of_source_ontology",
                    "class_index": class_index,
                }
            )
            continue
        polygon_xy: tuple[tuple[float, float], ...] | None = None
        if task == "segment":
            if instance_id > len(mask_polygons) or len(mask_polygons[instance_id - 1]) < 3:
                rejections.append(
                    {
                        "instance_id": instance_id,
                        "reason": "segmentation_prediction_has_no_polygon",
                    }
                )
                continue
            polygon_xy = tuple(
                (float(point[0]), float(point[1]))
                for point in mask_polygons[instance_id - 1]
            )
        predictions.append(
            SpatialInstance(
                instance_id=instance_id,
                class_name=class_names[class_index],
                confidence=float(confidence),
                bbox_xyxy_pixels=(
                    float(bbox[0]),
                    float(bbox[1]),
                    float(bbox[2]),
                    float(bbox[3]),
                ),
                polygon_xy_pixels=polygon_xy,
            )
        )
    return width, height, predictions, rejections
