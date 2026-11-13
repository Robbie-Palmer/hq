from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict, Field
from scipy import ndimage as ndi
from skimage import color, filters, measure, morphology
from skimage.draw import polygon

from .data import DATASET_ROOT, Annotation, load_annotations, load_cohort
from .methods import load_rgb


class PilotOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    output: Path = Path("outputs/annotation-pilot")
    maximum_polygon_evaluations: int = Field(default=2000, ge=1)
    review_items: int = Field(default=12, ge=1, le=48)
    random_seed: int = 20261109


@dataclass(frozen=True)
class BoxMaskProposal:
    bbox: tuple[int, int, int, int]
    mask: NDArray[np.bool_]
    threshold: float
    candidate_components: int
    fill_fraction: float
    border_fraction: float

    @property
    def pixel_count(self) -> int:
        return int(np.count_nonzero(self.mask))


AnnotationCandidate = tuple[Any, int, Annotation]


def _clip_bbox(
    bbox: tuple[int, int, int, int], image_shape: tuple[int, int]
) -> tuple[int, int, int, int]:
    height, width = image_shape
    xmin, ymin, xmax, ymax = bbox
    left = max(0, min(xmin, width - 1))
    top = max(0, min(ymin, height - 1))
    right = max(left + 1, min(xmax + 1, width))
    bottom = max(top + 1, min(ymax + 1, height))
    return left, top, right, bottom


def _component_score(region: Any, shape: tuple[int, int]) -> float:
    height, width = shape
    row, column = region.centroid
    distance = np.hypot(
        (row - (height - 1) / 2) / max(height, 1),
        (column - (width - 1) / 2) / max(width, 1),
    )
    return float(np.log1p(region.area) - 5.0 * distance)


def propose_box_mask(image: NDArray[np.uint8], bbox: tuple[int, int, int, int]) -> BoxMaskProposal:
    clipped = _clip_bbox(bbox, image.shape[:2])
    xmin, ymin, xmax, ymax = clipped
    crop = image[ymin:ymax, xmin:xmax]
    hematoxylin = color.rgb2hed(crop.astype(np.float64) / 255.0)[:, :, 0]
    smoothed = filters.gaussian(hematoxylin, sigma=0.7, preserve_range=True)
    threshold = (
        float(filters.threshold_otsu(smoothed)) if smoothed.size > 1 else float(smoothed[0, 0])
    )
    foreground = smoothed > threshold
    foreground = morphology.closing(foreground, morphology.disk(1))
    maximum_speck_pixels = max(2, int(foreground.size * 0.015))
    foreground = morphology.remove_small_objects(foreground, max_size=maximum_speck_pixels)
    foreground = ndi.binary_fill_holes(foreground)
    labels = measure.label(foreground, connectivity=2)
    regions = list(measure.regionprops(labels))
    selected = np.zeros(foreground.shape, dtype=np.bool_)
    if regions:
        best = max(regions, key=lambda region: _component_score(region, foreground.shape))
        selected = labels == best.label
    pixel_count = int(np.count_nonzero(selected))
    border_pixels = int(
        np.count_nonzero(selected[0, :])
        + np.count_nonzero(selected[-1, :])
        + np.count_nonzero(selected[:, 0])
        + np.count_nonzero(selected[:, -1])
    )
    return BoxMaskProposal(
        bbox=clipped,
        mask=np.asarray(selected, dtype=np.bool_),
        threshold=threshold,
        candidate_components=len(regions),
        fill_fraction=pixel_count / selected.size,
        border_fraction=border_pixels / max(pixel_count, 1),
    )


def _truth_mask(annotation: Annotation, bbox: tuple[int, int, int, int]) -> NDArray[np.bool_]:
    xmin, ymin, xmax, ymax = bbox
    shape = (ymax - ymin, xmax - xmin)
    rows, columns = polygon(
        np.asarray(annotation.coordinates_y) - ymin,
        np.asarray(annotation.coordinates_x) - xmin,
        shape=shape,
    )
    mask = np.zeros(shape, dtype=np.bool_)
    mask[rows, columns] = True
    return mask


def _overlap(truth: NDArray[np.bool_], proposal: NDArray[np.bool_]) -> tuple[float, float]:
    intersection = int(np.count_nonzero(truth & proposal))
    union = int(np.count_nonzero(truth | proposal))
    total = int(np.count_nonzero(truth) + np.count_nonzero(proposal))
    return intersection / union if union else 0.0, 2 * intersection / total if total else 0.0


def _annotation_id(item_id: str, annotation_index: int) -> str:
    value = f"{item_id}:{annotation_index}".encode()
    return hashlib.sha256(value).hexdigest()[:12]


def _percentile(values: list[float], quantile: float) -> float:
    return float(np.quantile(np.asarray(values), quantile)) if values else 0.0


def _summary(records: list[dict[str, Any]]) -> dict[str, Any]:
    ious = [float(record["iou"]) for record in records]
    dices = [float(record["dice"]) for record in records]
    return {
        "count": len(records),
        "mean_iou": float(np.mean(ious)) if ious else 0.0,
        "median_iou": float(np.median(ious)) if ious else 0.0,
        "p10_iou": _percentile(ious, 0.1),
        "mean_dice": float(np.mean(dices)) if dices else 0.0,
        "success_at_iou_0_5": float(np.mean(np.asarray(ious) >= 0.5)) if ious else 0.0,
    }


def _annotation_candidates(
    eligible: list[Any],
) -> tuple[list[AnnotationCandidate], list[AnnotationCandidate]]:
    polygon_candidates: list[AnnotationCandidate] = []
    rectangle_candidates: list[AnnotationCandidate] = []
    for item in eligible:
        annotations = load_annotations(DATASET_ROOT / item.annotation_path)
        for index, annotation in enumerate(annotations):
            if annotation.annotation_type == "polyline":
                polygon_candidates.append((item, index, annotation))
            elif annotation.annotation_type == "rectangle" and item.split == "train":
                rectangle_candidates.append((item, index, annotation))
    return polygon_candidates, rectangle_candidates


def _image_loader() -> Callable[[Any], NDArray[np.uint8]]:
    image_cache: dict[str, NDArray[np.uint8]] = {}

    def cached_image(item: Any) -> NDArray[np.uint8]:
        if item.item_id not in image_cache:
            image_cache[item.item_id] = load_rgb(DATASET_ROOT / item.image_path)
        return image_cache[item.item_id]

    return cached_image


def _polygon_evaluations(
    candidates: list[AnnotationCandidate],
    maximum_evaluations: int,
    cached_image: Callable[[Any], NDArray[np.uint8]],
) -> list[dict[str, Any]]:
    evaluations: list[dict[str, Any]] = []
    for item, index, annotation in candidates[:maximum_evaluations]:
        image = cached_image(item)
        proposal = propose_box_mask(
            image, (annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax)
        )
        truth = _truth_mask(annotation, proposal.bbox)
        iou, dice = _overlap(truth, proposal.mask)
        evaluations.append(
            {
                "sample_id": _annotation_id(item.item_id, index),
                "item_id": item.item_id,
                "annotation_index": index,
                "split": item.split,
                "site_id": item.site_id,
                "class_name": annotation.class_name,
                "iou": iou,
                "dice": dice,
                "fill_fraction": proposal.fill_fraction,
                "border_fraction": proposal.border_fraction,
                "candidate_components": proposal.candidate_components,
            }
        )
    return evaluations


def _balanced_candidates(
    rectangle_candidates: list[AnnotationCandidate], candidate_limit: int
) -> list[AnnotationCandidate]:
    rectangle_buckets: dict[tuple[str, str], list[AnnotationCandidate]] = defaultdict(list)
    for candidate in rectangle_candidates:
        item, _, annotation = candidate
        rectangle_buckets[(item.site_id, annotation.class_name)].append(candidate)
    bounded_candidates: list[AnnotationCandidate] = []
    while rectangle_buckets and len(bounded_candidates) < candidate_limit:
        for key in sorted([*rectangle_buckets]):
            values = rectangle_buckets[key]
            bounded_candidates.append(values.pop())
            if not values:
                del rectangle_buckets[key]
            if len(bounded_candidates) >= candidate_limit:
                break
    return bounded_candidates


def _proposal_records(
    candidates: list[AnnotationCandidate],
    cached_image: Callable[[Any], NDArray[np.uint8]],
) -> list[dict[str, Any]]:
    proposals: list[dict[str, Any]] = []
    for item, index, annotation in candidates:
        image = cached_image(item)
        proposal = propose_box_mask(
            image, (annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax)
        )
        risk = abs(proposal.fill_fraction - 0.5) + 2.0 * proposal.border_fraction
        proposals.append(
            {
                "sample_id": _annotation_id(item.item_id, index),
                "item_id": item.item_id,
                "annotation_index": index,
                "split": item.split,
                "site_id": item.site_id,
                "class_name": annotation.class_name,
                "bbox": list(proposal.bbox),
                "fill_fraction": proposal.fill_fraction,
                "border_fraction": proposal.border_fraction,
                "candidate_components": proposal.candidate_components,
                "risk": risk,
            }
        )
    return proposals


def _evaluation_records(options: PilotOptions) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cohort = load_cohort()
    eligible = [item for item in cohort.items if item.split in {"train", "validation"}]
    polygon_candidates, rectangle_candidates = _annotation_candidates(eligible)
    rng = np.random.default_rng(options.random_seed)
    rng.shuffle(polygon_candidates)
    rng.shuffle(rectangle_candidates)
    cached_image = _image_loader()
    evaluations = _polygon_evaluations(
        polygon_candidates,
        options.maximum_polygon_evaluations,
        cached_image,
    )
    bounded_candidates = _balanced_candidates(
        rectangle_candidates,
        max(120, options.review_items * 20),
    )
    proposals = _proposal_records(bounded_candidates, cached_image)
    return evaluations, proposals


def _select_review_records(
    evaluations: list[dict[str, Any]], proposals: list[dict[str, Any]], count: int
) -> list[dict[str, Any]]:
    validation = sorted(
        (record for record in evaluations if record["split"] == "validation"),
        key=lambda record: float(record["iou"]),
    )
    anchors: list[dict[str, Any]] = []
    if validation:
        anchors.extend(
            validation[round((len(validation) - 1) * fraction)]
            for fraction in (0.05, 0.25, 0.5, 0.75, 0.95)
        )
    target_proposals = max(1, count - len(anchors))
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in sorted(proposals, key=lambda value: float(value["risk"]), reverse=True):
        buckets[str(record["class_name"])].append(record)
    selected = anchors[:count]
    while len(selected) < count and buckets:
        for class_name in sorted([*buckets]):
            values = buckets[class_name]
            if values:
                selected.append(values.pop(0))
            if not values:
                del buckets[class_name]
            if len(selected) >= min(count, len(anchors) + target_proposals):
                break
    return selected[:count]


def _record_source(record: dict[str, Any]) -> tuple[Any, Annotation, NDArray[np.uint8]]:
    item = next(item for item in load_cohort().items if item.item_id == record["item_id"])
    annotation = load_annotations(DATASET_ROOT / item.annotation_path)[record["annotation_index"]]
    return item, annotation, load_rgb(DATASET_ROOT / item.image_path)


def _render_panel(record: dict[str, Any], panel_size: int = 280) -> Image.Image:
    _, annotation, image = _record_source(record)
    proposal = propose_box_mask(
        image, (annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax)
    )
    xmin, ymin, xmax, ymax = proposal.bbox
    margin = max(6, round(max(xmax - xmin, ymax - ymin) * 0.35))
    left = max(0, xmin - margin)
    top = max(0, ymin - margin)
    right = min(image.shape[1], xmax + margin)
    bottom = min(image.shape[0], ymax + margin)
    crop = Image.fromarray(image[top:bottom, left:right]).convert("RGBA")
    overlay = Image.new("RGBA", crop.size, (0, 0, 0, 0))
    local_mask = np.zeros((bottom - top, right - left), dtype=np.bool_)
    local_mask[ymin - top : ymax - top, xmin - left : xmax - left] = proposal.mask
    green = np.zeros((bottom - top, right - left, 4), dtype=np.uint8)
    green[local_mask] = (0, 230, 120, 105)
    overlay = Image.alpha_composite(overlay, Image.fromarray(green, mode="RGBA"))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle(
        (xmin - left, ymin - top, xmax - left - 1, ymax - top - 1),
        outline="#ffd166",
        width=2,
    )
    if annotation.annotation_type == "polyline":
        points = [
            (x - left, y - top)
            for x, y in zip(annotation.coordinates_x, annotation.coordinates_y, strict=True)
        ]
        draw.line(points + points[:1], fill="#ef476f", width=2)
    rendered = Image.alpha_composite(crop, overlay).convert("RGB")
    available = (panel_size - 16, panel_size - 58)
    scale = min(available[0] / rendered.width, available[1] / rendered.height)
    rendered = rendered.resize(
        (max(1, round(rendered.width * scale)), max(1, round(rendered.height * scale))),
        Image.Resampling.NEAREST,
    )
    panel = Image.new("RGB", (panel_size, panel_size), "#111827")
    panel.paste(rendered, ((panel_size - rendered.width) // 2, 26))
    label = f"{record['sample_id']}  {record['class_name']}  {record['site_id']}"
    detail = (
        f"polygon reference  IoU {record['iou']:.3f}"
        if "iou" in record
        else f"UNREVIEWED box  fill {record['fill_fraction']:.2f}"
    )
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.text((8, 7), label, fill="#f9fafb")
    panel_draw.text((8, panel_size - 19), detail, fill="#d1d5db")
    return panel


def _render_sheet(records: list[dict[str, Any]], output: Path) -> None:
    columns = 3
    panel_size = 280
    rows = (len(records) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * panel_size, rows * panel_size), "#030712")
    for index, record in enumerate(records):
        position = ((index % columns) * panel_size, (index // columns) * panel_size)
        sheet.paste(_render_panel(record, panel_size), position)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def run_annotation_pilot(options: PilotOptions) -> dict[str, Any]:
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    evaluations, proposals = _evaluation_records(options)
    review_records = _select_review_records(evaluations, proposals, options.review_items)
    validation_records = [record for record in evaluations if record["split"] == "validation"]
    per_class = {
        class_name: _summary(
            [record for record in validation_records if record["class_name"] == class_name]
        )
        for class_name in sorted({str(record["class_name"]) for record in validation_records})
    }
    report = {
        "schema_version": "1.0.0",
        "dataset_id": "nucls-corrected-single-rater-20220301",
        "proposal_status": "unreviewed_derived_annotation_candidates",
        "method": "box-prompt-hematoxylin-otsu-central-component-v1",
        "random_seed": options.random_seed,
        "source_geometry_preserved": True,
        "source_annotations_modified": False,
        "evaluation": {
            "train": _summary([record for record in evaluations if record["split"] == "train"]),
            "validation": _summary(validation_records),
            "validation_per_class": per_class,
        },
        "review_batch": {
            "count": len(review_records),
            "source_types": dict(
                Counter(
                    "polygon_reference" if "iou" in record else "rectangle"
                    for record in review_records
                )
            ),
            "records": review_records,
        },
        "provenance_note": (
            "Rectangle-derived masks are machine proposals, not NuCLS source annotations or final "
            "truth. Each review decision is revisable and retains its iteration history."
        ),
    }
    (output / "pilot-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    (output / "polygon-evaluations.jsonl").write_text(
        "".join(json.dumps(record, sort_keys=True) + "\n" for record in evaluations),
        encoding="utf-8",
    )
    (output / "rectangle-proposals.jsonl").write_text(
        "".join(json.dumps(record, sort_keys=True) + "\n" for record in proposals),
        encoding="utf-8",
    )
    feedback_template = {
        "schema_version": "1.0.0",
        "iteration": 1,
        "method": report["method"],
        "review_questions": [
            "Does the source box contain a nucleus instance?",
            "If it does, is the proposed mask useful or does it need correction?",
        ],
        "decisions": [
            {
                "sample_id": record["sample_id"],
                "source_type": "polygon_reference" if "iou" in record else "rectangle",
                "object_decision": "not_reviewed",
                "mask_decision": "not_reviewed",
                "issue_tags": [],
                "comment": "",
            }
            for record in review_records
        ],
    }
    (output / "feedback-template.json").write_text(
        json.dumps(feedback_template, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _render_sheet(review_records, output / "review-batch.png")
    return report
