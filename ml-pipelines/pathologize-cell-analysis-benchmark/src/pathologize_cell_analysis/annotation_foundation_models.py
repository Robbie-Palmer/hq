from __future__ import annotations

import hashlib
import json
import os
import shutil
import tarfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import numpy as np
import torch
from cellSAM.model import get_local_model
from cellSAM.utils import fill_holes_and_remove_small_masks, format_image_shape, normalize_image
from data_artifacts.files import read_yaml, sha256_file
from huggingface_hub import hf_hub_download
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFilter
from pydantic import BaseModel, ConfigDict, Field
from skimage.draw import polygon
from transformers.models.sam.modeling_sam import SamModel
from transformers.models.sam.processing_sam import SamProcessor
from transformers.models.sam2.modeling_sam2 import Sam2Model
from transformers.models.sam2.processing_sam2 import Sam2Processor

from .annotation_pilot import propose_box_mask
from .data import DATASET_ROOT, Annotation, load_annotations, load_cohort
from .methods import load_rgb


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FoundationModelPin(StrictModel):
    adapter: str
    repository: str
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    weights_file: str
    weights_bytes: int = Field(gt=0)
    weights_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    license: Literal["Apache-2.0", "Modified-Apache-2.0-NonCommercial"]


class CellSamModelPin(FoundationModelPin):
    archive_member: str = Field(pattern=r"^[^/].*\.pt$")
    member_bytes: int = Field(gt=0)
    member_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class SmokeConfig(StrictModel):
    polygon_references: int = Field(gt=0, le=100)
    review_records: int = Field(gt=0, le=48)


class WorkbenchConfig(StrictModel):
    batch_id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$")
    created_at: datetime
    image_size: int = Field(ge=224, le=1024)


class ComparisonLimits(StrictModel):
    wall_seconds_per_model: int = Field(gt=0, le=3600)
    maximum_peak_vram_bytes: int = Field(gt=0)


class IterationGates(StrictModel):
    minimum_validation_mean_iou: float = Field(ge=0, le=1)
    minimum_validation_success_at_iou_0_5: float = Field(ge=0, le=1)


class FoundationComparisonConfig(StrictModel):
    schema_version: Literal["1.0.0"]
    random_seed: int = Field(ge=0)
    models: dict[Literal["medsam", "sam2"], FoundationModelPin]
    gated_models: dict[Literal["cellsam"], CellSamModelPin]
    smoke: SmokeConfig
    workbench: WorkbenchConfig
    limits: ComparisonLimits
    iteration_gates: IterationGates
    stop_rules: list[str] = Field(min_length=1)


class ComparisonOptions(StrictModel):
    params: Path = Path("params/nucls-annotation-pilot.yaml")
    pilot_output: Path = Path("outputs/annotation-pilot")
    output: Path = Path("outputs/annotation-foundation-models")
    cellsam_weights: Path = Path("models/annotation/cellsam-v1.2/cellsam_general.pt")
    device: Literal["cuda:0"] = "cuda:0"


@dataclass(frozen=True)
class ModelResult:
    masks: dict[str, NDArray[np.bool_]]
    wall_seconds: float
    peak_vram_bytes: int


def load_comparison_config(path: Path) -> FoundationComparisonConfig:
    return FoundationComparisonConfig.model_validate(read_yaml(path))


def _validate_cellsam_archive(
    downloaded: Path, pin: CellSamModelPin
) -> tuple[str, list[dict[str, Any]]]:
    if downloaded.stat().st_size != pin.weights_bytes:
        raise RuntimeError("CellSAM archive byte count differs from the pinned model")
    digest = sha256_file(downloaded)
    if digest != pin.weights_sha256:
        raise RuntimeError("CellSAM archive SHA-256 differs from the pinned model")
    members: list[dict[str, Any]] = []
    with tarfile.open(downloaded, mode="r:gz") as archive:
        for member in archive.getmembers():
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts:
                raise RuntimeError("CellSAM archive contains an unsafe path")
            if member.isfile():
                members.append({"path": member.name, "bytes": member.size})
    matching_members = [member for member in members if member["path"] == pin.archive_member]
    if matching_members != [{"path": pin.archive_member, "bytes": pin.member_bytes}]:
        raise RuntimeError("CellSAM archive does not contain the pinned model member")
    return digest, members


def _extract_cellsam_member(downloaded: Path, output: Path, pin: CellSamModelPin) -> None:
    if output.is_file() and sha256_file(output) == pin.member_sha256:
        return
    temporary = output.with_suffix(output.suffix + ".part")
    with tarfile.open(downloaded, mode="r:gz") as archive:
        member = archive.getmember(pin.archive_member)
        source = archive.extractfile(member)
        if source is None:
            raise RuntimeError("CellSAM model member could not be read")
        with source, temporary.open("wb") as target:
            shutil.copyfileobj(source, target)
    if temporary.stat().st_size != pin.member_bytes:
        temporary.unlink(missing_ok=True)
        raise RuntimeError("extracted CellSAM model byte count differs from the pin")
    if sha256_file(temporary) != pin.member_sha256:
        temporary.unlink(missing_ok=True)
        raise RuntimeError("extracted CellSAM model SHA-256 differs from the pin")
    temporary.replace(output)


def acquire_cellsam_weights(
    params: Path = Path("params/nucls-annotation-pilot.yaml"),
    output: Path = Path("models/annotation/cellsam-v1.2/cellsam_general.pt"),
) -> dict[str, Any]:
    config = load_comparison_config(params)
    pin = config.gated_models["cellsam"]
    token = os.environ.get("HF_TOKEN")
    if token is None or token == "":
        raise RuntimeError("HF_TOKEN is required for the gated CellSAM repository")
    downloaded = Path(
        hf_hub_download(
            repo_id=pin.repository,
            filename=pin.weights_file,
            revision=pin.revision,
            token=token,
        )
    )
    digest, members = _validate_cellsam_archive(downloaded, pin)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    _extract_cellsam_member(downloaded, output, pin)
    return {
        "repository": pin.repository,
        "revision": pin.revision,
        "archive": downloaded.as_posix(),
        "bytes": downloaded.stat().st_size,
        "sha256": digest,
        "license": pin.license,
        "members": members,
        "model": {
            "path": output.as_posix(),
            "bytes": output.stat().st_size,
            "sha256": sha256_file(output),
        },
    }


def _cohort_items() -> dict[str, Any]:
    return {item.item_id: item for item in load_cohort().items}


def _load_record(
    record: dict[str, Any], items: dict[str, Any]
) -> tuple[Annotation, NDArray[np.uint8]]:
    item = items[str(record["item_id"])]
    annotation = load_annotations(DATASET_ROOT / item.annotation_path)[
        int(record["annotation_index"])
    ]
    return annotation, load_rgb(DATASET_ROOT / item.image_path)


def _truth_mask(annotation: Annotation, shape: tuple[int, int]) -> NDArray[np.bool_]:
    rows, columns = polygon(annotation.coordinates_y, annotation.coordinates_x, shape=shape)
    mask = np.zeros(shape, dtype=np.bool_)
    mask[rows, columns] = True
    return mask


def _clip_to_box(mask: NDArray[np.bool_], annotation: Annotation) -> NDArray[np.bool_]:
    clipped = np.zeros(mask.shape, dtype=np.bool_)
    height, width = mask.shape
    xmin = max(0, min(annotation.xmin, width - 1))
    ymin = max(0, min(annotation.ymin, height - 1))
    xmax = max(xmin + 1, min(annotation.xmax + 1, width))
    ymax = max(ymin + 1, min(annotation.ymax + 1, height))
    clipped[ymin:ymax, xmin:xmax] = mask[ymin:ymax, xmin:xmax]
    return clipped


def _overlap(truth: NDArray[np.bool_], proposal: NDArray[np.bool_]) -> tuple[float, float]:
    intersection = int(np.count_nonzero(truth & proposal))
    union = int(np.count_nonzero(truth | proposal))
    total = int(np.count_nonzero(truth) + np.count_nonzero(proposal))
    return intersection / union if union else 0.0, 2 * intersection / total if total else 0.0


def _postprocess_mask(
    adapter: Literal["medsam", "sam2"], processor: Any, outputs: Any, inputs: Any
) -> NDArray[np.bool_]:
    if adapter == "medsam":
        masks = processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(),
            inputs["original_sizes"].cpu(),
            inputs["reshaped_input_sizes"].cpu(),
        )[0]
    else:
        masks = processor.post_process_masks(
            outputs.pred_masks.cpu(), inputs["original_sizes"].cpu()
        )[0]
    values = np.asarray(masks[0, 0], dtype=np.bool_)
    return values


def _run_model(
    adapter: Literal["medsam", "sam2"],
    pin: FoundationModelPin,
    records: list[dict[str, Any]],
    items: dict[str, Any],
    device: str,
) -> ModelResult:
    model_class = SamModel if adapter == "medsam" else Sam2Model
    processor_class = SamProcessor if adapter == "medsam" else Sam2Processor
    processor = processor_class.from_pretrained(
        pin.repository, revision=pin.revision, trust_remote_code=False
    )
    model = model_class.from_pretrained(
        pin.repository, revision=pin.revision, trust_remote_code=False
    ).to(device)
    model.eval()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    start = time.perf_counter()
    masks: dict[str, NDArray[np.bool_]] = {}
    for record in records:
        annotation, image = _load_record(record, items)
        box = [
            [
                float(annotation.xmin),
                float(annotation.ymin),
                float(annotation.xmax),
                float(annotation.ymax),
            ]
        ]
        inputs = processor(
            images=Image.fromarray(image), input_boxes=[box], return_tensors="pt"
        ).to(device)
        with torch.inference_mode(), torch.autocast(device_type="cuda", dtype=torch.float16):
            outputs = model(**inputs, multimask_output=False)
        mask = _postprocess_mask(adapter, processor, outputs, inputs)
        masks[str(record["sample_id"])] = _clip_to_box(mask, annotation)
    torch.cuda.synchronize()
    result = ModelResult(
        masks=masks,
        wall_seconds=time.perf_counter() - start,
        peak_vram_bytes=int(torch.cuda.max_memory_allocated()),
    )
    del model
    torch.cuda.empty_cache()
    return result


def _segment_cellsam_box(
    image: NDArray[np.uint8], model: Any, box: list[list[float]], device: str
) -> NDArray[np.bool_]:
    normalized = normalize_image(format_image_shape(image))
    tensor = torch.from_numpy(normalized.transpose((2, 0, 1))).float().unsqueeze(0).to(device)
    model = model.eval().to(device)
    bounding_boxes = torch.tensor(box).unsqueeze(0)
    predictions = model.predict(tensor, boxes_per_heatmap=bounding_boxes)
    if predictions is None or predictions[0] is None:
        return np.zeros(image.shape[:2], dtype=np.bool_)
    labels = fill_holes_and_remove_small_masks(predictions[0], min_size=25)
    return np.asarray(labels > 0, dtype=np.bool_)


def _run_cellsam(
    pin: CellSamModelPin,
    weights: Path,
    records: list[dict[str, Any]],
    items: dict[str, Any],
    device: str,
) -> ModelResult:
    if not weights.is_file():
        raise RuntimeError("CellSAM weights are missing; run annotation:cellsam:acquire first")
    if weights.stat().st_size != pin.member_bytes or sha256_file(weights) != pin.member_sha256:
        raise RuntimeError("CellSAM model weights differ from the pinned archive member")
    model = get_local_model(weights.as_posix())
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    start = time.perf_counter()
    masks: dict[str, NDArray[np.bool_]] = {}
    for record in records:
        annotation, image = _load_record(record, items)
        box = [
            [
                float(annotation.xmin),
                float(annotation.ymin),
                float(annotation.xmax),
                float(annotation.ymax),
            ]
        ]
        with torch.inference_mode():
            mask = _segment_cellsam_box(image, model, box, device)
        masks[str(record["sample_id"])] = _clip_to_box(mask, annotation)
    torch.cuda.synchronize()
    result = ModelResult(
        masks=masks,
        wall_seconds=time.perf_counter() - start,
        peak_vram_bytes=int(torch.cuda.max_memory_allocated()),
    )
    del model
    torch.cuda.empty_cache()
    return result


def _verify_cached_weights(pin: FoundationModelPin) -> dict[str, Any]:
    cache = Path.home() / ".cache/huggingface/hub"
    model_directory = "models--" + pin.repository.replace("/", "--")
    weight_path = cache / model_directory / "snapshots" / pin.revision / pin.weights_file
    if not weight_path.is_file():
        raise RuntimeError(f"model loader did not cache pinned weights at {weight_path}")
    resolved = weight_path.resolve()
    if resolved.stat().st_size != pin.weights_bytes:
        raise RuntimeError(f"cached weight byte count differs for {pin.repository}")
    digest = sha256_file(resolved)
    if digest != pin.weights_sha256:
        raise RuntimeError(f"cached weight SHA-256 differs for {pin.repository}")
    return {"path": weight_path.as_posix(), "sha256": digest, "bytes": resolved.stat().st_size}


def _records(pilot_output: Path, config: FoundationComparisonConfig) -> list[dict[str, Any]]:
    review = json.loads((pilot_output / "pilot-report.json").read_text(encoding="utf-8"))[
        "review_batch"
    ]["records"][: config.smoke.review_records]
    evaluations = [
        json.loads(line)
        for line in (pilot_output / "polygon-evaluations.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    references = [record for record in evaluations if record["split"] == "validation"]
    references.sort(key=lambda record: str(record["sample_id"]))
    selected = references[: config.smoke.polygon_references]
    by_id = {str(record["sample_id"]): record for record in [*selected, *review]}
    return list(by_id.values())


def _metric_summary(ious: list[float], dices: list[float]) -> dict[str, Any]:
    return {
        "count": len(ious),
        "mean_iou": float(np.mean(ious)) if ious else 0.0,
        "mean_dice": float(np.mean(dices)) if dices else 0.0,
        "success_at_iou_0_5": float(np.mean(np.asarray(ious) >= 0.5)) if ious else 0.0,
    }


def _metrics(
    records: list[dict[str, Any]],
    masks: dict[str, NDArray[np.bool_]],
    items: dict[str, Any],
    random_seed: int,
) -> dict[str, Any]:
    ious: list[float] = []
    dices: list[float] = []
    per_record: list[dict[str, Any]] = []
    for record in records:
        if "iou" not in record:
            continue
        annotation, image = _load_record(record, items)
        truth = _truth_mask(annotation, image.shape[:2])
        iou, dice = _overlap(truth, masks[str(record["sample_id"])])
        ious.append(iou)
        dices.append(dice)
        per_record.append({"sample_id": record["sample_id"], "iou": iou, "dice": dice})
    result = _metric_summary(ious, dices)
    rng = np.random.default_rng(random_seed)
    if ious:
        samples = rng.choice(np.asarray(ious), size=(10_000, len(ious)), replace=True).mean(axis=1)
        result["mean_iou_bootstrap_95_ci"] = [
            float(np.quantile(samples, 0.025)),
            float(np.quantile(samples, 0.975)),
        ]
    for field, output_name in (("class_name", "per_class"), ("site_id", "per_site")):
        values: dict[str, dict[str, list[float]]] = {}
        for record, iou, dice in zip(
            (record for record in records if "iou" in record), ious, dices, strict=True
        ):
            group = values.setdefault(str(record[field]), {"ious": [], "dices": []})
            group["ious"].append(iou)
            group["dices"].append(dice)
        result[output_name] = {
            name: _metric_summary(group["ious"], group["dices"])
            for name, group in sorted(values.items())
        }
    result["records"] = per_record
    return result


def _baseline_masks(
    records: list[dict[str, Any]], items: dict[str, Any]
) -> dict[str, NDArray[np.bool_]]:
    masks: dict[str, NDArray[np.bool_]] = {}
    for record in records:
        annotation, image = _load_record(record, items)
        proposal = propose_box_mask(
            image, (annotation.xmin, annotation.ymin, annotation.xmax, annotation.ymax)
        )
        mask = np.zeros(image.shape[:2], dtype=np.bool_)
        xmin, ymin, xmax, ymax = proposal.bbox
        mask[ymin:ymax, xmin:xmax] = proposal.mask
        masks[str(record["sample_id"])] = mask
    return masks


def _render_panel(
    record: dict[str, Any], mask: NDArray[np.bool_], title: str, items: dict[str, Any]
) -> Image.Image:
    annotation, image = _load_record(record, items)
    xmin, ymin = annotation.xmin, annotation.ymin
    xmax, ymax = annotation.xmax + 1, annotation.ymax + 1
    margin = max(8, round(max(xmax - xmin, ymax - ymin) * 0.6))
    left, top = max(0, xmin - margin), max(0, ymin - margin)
    right, bottom = min(image.shape[1], xmax + margin), min(image.shape[0], ymax + margin)
    crop = Image.fromarray(image[top:bottom, left:right]).convert("RGBA")
    overlay_values = np.zeros((bottom - top, right - left, 4), dtype=np.uint8)
    overlay_values[mask[top:bottom, left:right]] = (0, 230, 120, 100)
    overlay = Image.fromarray(overlay_values, mode="RGBA")
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((xmin - left, ymin - top, xmax - left, ymax - top), outline="#ffd166", width=1)
    if annotation.annotation_type == "polyline":
        points = [
            (x - left, y - top)
            for x, y in zip(annotation.coordinates_x, annotation.coordinates_y, strict=True)
        ]
        draw.line(points + points[:1], fill="#ef476f", width=1)
    rendered = Image.alpha_composite(crop, overlay).convert("RGB")
    rendered = rendered.resize((220, 180), Image.Resampling.NEAREST)
    panel = Image.new("RGB", (220, 205), "#111827")
    panel.paste(rendered, (0, 25))
    ImageDraw.Draw(panel).text((6, 7), f"{record['sample_id']}  {title}", fill="#f9fafb")
    return panel


def _render_sheet(
    records: list[dict[str, Any]],
    masks: dict[str, dict[str, NDArray[np.bool_]]],
    items: dict[str, Any],
    output: Path,
) -> None:
    selected_ids = {"9a0eedd17699", "ed3e7dd692d2", "57500f5efd1b"}
    selected = [record for record in records if record["sample_id"] in selected_ids]
    selected.extend(record for record in records if "iou" in record and record not in selected)
    selected = selected[:8]
    columns = (
        ("baseline", "threshold"),
        ("medsam", "MedSAM"),
        ("sam2", "SAM 2.1 small"),
        ("cellsam", "CellSAM general"),
    )
    sheet = Image.new("RGB", (220 * len(columns), len(selected) * 205), "#030712")
    for row, record in enumerate(selected):
        for column, (key, name) in enumerate(columns):
            panel = _render_panel(record, masks[key][str(record["sample_id"])], name, items)
            sheet.paste(panel, (column * 220, row * 205))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def _producer_revision(params: Path) -> str:
    digest = hashlib.sha256()
    sources = (Path(__file__), Path(__file__).with_name("annotation_pilot.py"), params.resolve())
    for source in sources:
        digest.update(source.name.encode())
        digest.update(source.read_bytes())
    return digest.hexdigest()


def _asset_record(asset_id: str, kind: str, path: Path, root: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
    return {
        "id": asset_id,
        "kind": kind,
        "path": path.relative_to(root).as_posix(),
        "media_type": "image/png",
        "sha256": sha256_file(path),
        "width": width,
        "height": height,
    }


def _crop_bounds(
    annotation: Annotation, shape: tuple[int, int], margin_fraction: float = 0.75
) -> tuple[int, int, int, int]:
    height, width = shape
    box_width = annotation.xmax - annotation.xmin + 1
    box_height = annotation.ymax - annotation.ymin + 1
    side = max(box_width, box_height)
    side = max(side + round(side * margin_fraction * 2), 16)
    center_x = (annotation.xmin + annotation.xmax + 1) / 2
    center_y = (annotation.ymin + annotation.ymax + 1) / 2
    left = max(0, min(round(center_x - side / 2), width - side))
    top = max(0, min(round(center_y - side / 2), height - side))
    right = min(width, left + side)
    bottom = min(height, top + side)
    return left, top, right, bottom


def _render_workbench_source(
    image: NDArray[np.uint8],
    annotation: Annotation,
    bounds: tuple[int, int, int, int],
    size: int,
) -> Image.Image:
    left, top, right, bottom = bounds
    rendered = Image.fromarray(image[top:bottom, left:right]).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    scale_x = size / (right - left)
    scale_y = size / (bottom - top)
    draw = ImageDraw.Draw(rendered)
    draw.rectangle(
        (
            round((annotation.xmin - left) * scale_x),
            round((annotation.ymin - top) * scale_y),
            round((annotation.xmax + 1 - left) * scale_x),
            round((annotation.ymax + 1 - top) * scale_y),
        ),
        outline="#ffd166",
        width=2,
    )
    return rendered


def _render_workbench_mask(
    mask: NDArray[np.bool_], bounds: tuple[int, int, int, int], size: int
) -> Image.Image:
    left, top, right, bottom = bounds
    values = Image.fromarray(mask[top:bottom, left:right]).resize(
        (size, size), Image.Resampling.NEAREST
    )
    selected = np.asarray(values, dtype=np.bool_)
    overlay = np.zeros((size, size, 4), dtype=np.uint8)
    overlay[selected] = (0, 230, 120, 105)
    edge = selected & ~np.asarray(
        Image.fromarray(selected).filter(ImageFilter.MinFilter(3)), dtype=np.bool_
    )
    overlay[edge] = (0, 255, 150, 230)
    return Image.fromarray(overlay, mode="RGBA")


def _render_workbench_reference(
    annotation: Annotation, bounds: tuple[int, int, int, int], size: int
) -> Image.Image:
    left, top, right, bottom = bounds
    scale_x = size / (right - left)
    scale_y = size / (bottom - top)
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    points = [
        (round((x - left) * scale_x), round((y - top) * scale_y))
        for x, y in zip(annotation.coordinates_x, annotation.coordinates_y, strict=True)
    ]
    if points:
        ImageDraw.Draw(overlay).line(points + points[:1], fill="#ef476f", width=2)
    return overlay


def _write_workbench_bundle(
    config: FoundationComparisonConfig,
    params: Path,
    pilot_output: Path,
    masks: dict[str, dict[str, NDArray[np.bool_]]],
    items: dict[str, Any],
    output: Path,
) -> Path:
    review_records = json.loads((pilot_output / "pilot-report.json").read_text(encoding="utf-8"))[
        "review_batch"
    ]["records"][: config.smoke.review_records]
    root = output / "workbench"
    assets_root = root / "assets"
    assets_root.mkdir(parents=True, exist_ok=True)
    assets: list[dict[str, Any]] = []
    review_items: list[dict[str, Any]] = []
    model_specs = (
        (
            "cellsam",
            "primary",
            "CellSAM general",
            config.gated_models["cellsam"].adapter,
            config.gated_models["cellsam"].license,
        ),
        (
            "sam2",
            "alternative",
            "SAM 2.1 small",
            config.models["sam2"].adapter,
            config.models["sam2"].license,
        ),
        (
            "baseline",
            "baseline",
            "H&E threshold",
            "box-prompt-hematoxylin-otsu-central-component-v1",
            "AGPL-3.0-or-later",
        ),
    )
    for record in review_records:
        sample_id = str(record["sample_id"])
        annotation, image = _load_record(record, items)
        bounds = _crop_bounds(annotation, image.shape[:2])
        sample_root = assets_root / sample_id
        sample_root.mkdir(parents=True, exist_ok=True)
        source_path = sample_root / "source.png"
        _render_workbench_source(image, annotation, bounds, config.workbench.image_size).save(
            source_path
        )
        source_asset_id = f"source:{sample_id}"
        assets.append(_asset_record(source_asset_id, "source", source_path, root))
        reference_asset_id: str | None = None
        if annotation.annotation_type == "polyline":
            reference_path = sample_root / "reference.png"
            _render_workbench_reference(annotation, bounds, config.workbench.image_size).save(
                reference_path
            )
            reference_asset_id = f"reference:{sample_id}"
            assets.append(_asset_record(reference_asset_id, "reference", reference_path, root))
        proposals: list[dict[str, Any]] = []
        for key, role, name, revision, license_name in model_specs:
            proposal_path = sample_root / f"{key}.png"
            _render_workbench_mask(masks[key][sample_id], bounds, config.workbench.image_size).save(
                proposal_path
            )
            asset_id = f"proposal:{sample_id}:{key}"
            proposal_id = f"{sample_id}:{key}"
            assets.append(_asset_record(asset_id, "proposal", proposal_path, root))
            proposals.append(
                {
                    "id": proposal_id,
                    "asset_id": asset_id,
                    "role": role,
                    "model_name": name,
                    "model_revision": revision,
                    "model_license": license_name,
                    "source_box_clipped": True,
                }
            )
        review_items.append(
            {
                "id": sample_id,
                "source_asset_id": source_asset_id,
                "reference_asset_id": reference_asset_id,
                "proposals": proposals,
                "context": {
                    "dataset_id": items[str(record["item_id"])].source_dataset_id,
                    "source_item_id": record["item_id"],
                    "source_annotation_id": f"{record['item_id']}:{record['annotation_index']}",
                    "split": record["split"],
                    "site_id": record["site_id"],
                    "class_name": record["class_name"],
                    "bbox_xyxy": [
                        annotation.xmin,
                        annotation.ymin,
                        annotation.xmax,
                        annotation.ymax,
                    ],
                    "coordinate_space": "source_pixel_xyxy_inclusive",
                },
            }
        )
    cohort = load_cohort()
    bundle = {
        "schema_version": "1.0.0",
        "batch_id": config.workbench.batch_id,
        "created_at": config.workbench.created_at.isoformat().replace("+00:00", "Z"),
        "provenance": {
            "producer": "pathologize-cell-analysis-benchmark/nucls-annotation-adapter",
            "producer_version": "1.0.0",
            "producer_revision": _producer_revision(params),
            "dataset_id": cohort.items[0].source_dataset_id,
            "dataset_revision": cohort.product_id,
            "derivation": (
                "Review-only crops and box-clipped proposals derived from pinned NuCLS records. "
                "Source annotations remain unchanged."
            ),
        },
        "assets": assets,
        "items": review_items,
    }
    bundle_path = root / "bundle.json"
    bundle_path.write_text(json.dumps(bundle, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return bundle_path


def compare_foundation_models(options: ComparisonOptions) -> dict[str, Any]:
    config = load_comparison_config(options.params)
    records = _records(options.pilot_output, config)
    items = _cohort_items()
    adapters: tuple[Literal["medsam", "sam2"], ...] = ("medsam", "sam2")
    results = {
        adapter: _run_model(adapter, config.models[adapter], records, items, options.device)
        for adapter in adapters
    }
    cellsam = _run_cellsam(
        config.gated_models["cellsam"],
        options.cellsam_weights.resolve(),
        records,
        items,
        options.device,
    )
    baseline = _baseline_masks(records, items)
    report: dict[str, Any] = {
        "schema_version": "1.0.0",
        "run_kind": "smoke_only_no_scientific_claim",
        "records": len(records),
        "models": {},
        "baseline": _metrics(records, baseline, items, config.random_seed),
    }
    all_masks = {"baseline": baseline}
    for adapter, result in results.items():
        pin = config.models[adapter]
        if result.wall_seconds > config.limits.wall_seconds_per_model:
            raise RuntimeError(f"{adapter} exceeded the smoke wall-time limit")
        if result.peak_vram_bytes > config.limits.maximum_peak_vram_bytes:
            raise RuntimeError(f"{adapter} exceeded the smoke peak-VRAM limit")
        report["models"][adapter] = {
            "adapter": pin.adapter,
            "repository": pin.repository,
            "revision": pin.revision,
            "weights": _verify_cached_weights(pin),
            "wall_seconds": result.wall_seconds,
            "peak_vram_bytes": result.peak_vram_bytes,
            "metrics": _metrics(records, result.masks, items, config.random_seed),
        }
        all_masks[adapter] = result.masks
    pin = config.gated_models["cellsam"]
    if cellsam.wall_seconds > config.limits.wall_seconds_per_model:
        raise RuntimeError("cellsam exceeded the smoke wall-time limit")
    if cellsam.peak_vram_bytes > config.limits.maximum_peak_vram_bytes:
        raise RuntimeError("cellsam exceeded the smoke peak-VRAM limit")
    report["models"]["cellsam"] = {
        "adapter": pin.adapter,
        "repository": pin.repository,
        "revision": pin.revision,
        "license": pin.license,
        "weights": {
            "path": options.cellsam_weights.resolve().as_posix(),
            "bytes": pin.member_bytes,
            "sha256": pin.member_sha256,
        },
        "wall_seconds": cellsam.wall_seconds,
        "peak_vram_bytes": cellsam.peak_vram_bytes,
        "metrics": _metrics(records, cellsam.masks, items, config.random_seed),
    }
    all_masks["cellsam"] = cellsam.masks
    output = options.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report["workbench_bundle"] = _write_workbench_bundle(
        config,
        options.params,
        options.pilot_output,
        all_masks,
        items,
        output,
    ).as_posix()
    (output / "smoke-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    _render_sheet(records, all_masks, items, output / "smoke-comparison.png")
    return report
