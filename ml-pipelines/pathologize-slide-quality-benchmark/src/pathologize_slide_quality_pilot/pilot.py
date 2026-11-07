from __future__ import annotations

import hashlib
import json
import math
import resource
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import openslide
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, model_validator

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CORPUS_PATH = PROJECT_ROOT / "public-pilot/corpus.json"
PREDECLARATION_PATH = PROJECT_ROOT / "public-pilot/predeclaration.json"
OUTPUT_ROOT = PROJECT_ROOT / "public-pilot/results"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceAsset(StrictModel):
    relative_path: str
    source_url: str
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    publisher_md5: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    publisher_id: str


class CorpusSlide(StrictModel):
    slide_id: str
    patient_id: str
    case_id: str
    project_id: str
    scanner_id: str | None
    scanner_manufacturer: str
    scanner_model: str
    objective_power: float = Field(gt=0)
    micrometres_per_pixel: float = Field(gt=0)
    source: SourceAsset
    annotation: SourceAsset
    truth_reject: bool
    annotation_counts: dict[str, int]


class Corpus(StrictModel):
    schema_version: str
    corpus_id: str
    registry_base_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    registry_subset_id: str
    registry_index_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    registry_collection_manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    registry_subset_manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    registry_asset_manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_index_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_root: str
    slides: list[CorpusSlide] = Field(min_length=1)
    exclusions: list[dict[str, Any]]
    failed_acquisitions: list[dict[str, Any]]
    provenance: dict[str, Any]

    @model_validator(mode="after")
    def require_unique_identities(self) -> Corpus:
        for attribute in ("slide_id", "patient_id"):
            values = [getattr(slide, attribute) for slide in self.slides]
            if len(values) != len(set(values)):
                raise ValueError(f"corpus {attribute} values must be unique")
        return self


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return value


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(value, sort_keys=True) + "\n" for value in values)
    path.write_text(body, encoding="utf-8")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _process_io() -> dict[str, int]:
    path = Path("/proc/self/io")
    if not path.exists():
        return {}
    values: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, value = line.split(":", maxsplit=1)
        values[key] = int(value.strip())
    return values


def _output_bytes() -> int:
    names = (
        "failures.json",
        "features.jsonl",
        "metrics.json",
        "per-slide.jsonl",
        "spatial-evidence.jsonl",
    )
    return sum((OUTPUT_ROOT / name).stat().st_size for name in names)


def _verify_corpus_assets(corpus: Corpus, source_root: Path) -> int:
    verified_bytes = 0
    for slide in corpus.slides:
        for asset in (slide.source, slide.annotation):
            path = source_root / asset.relative_path
            if path.stat().st_size != asset.bytes or _sha256(path) != asset.sha256:
                raise ValueError(f"source asset differs from corpus manifest: {path}")
            verified_bytes += asset.bytes
    return verified_bytes


def _typed_annotation(
    annotation: np.ndarray, palette: dict[str, list[int]], maximum_distance: float
) -> tuple[np.ndarray, dict[str, int]]:
    best_distance = np.full(annotation.shape[:2], np.inf, dtype=np.float32)
    best_label = np.zeros(annotation.shape[:2], dtype=np.uint8)
    counts: dict[str, int] = {}
    pixels = annotation.astype(np.int16)
    for label, (name, colour) in enumerate(palette.items(), start=1):
        difference = pixels - np.asarray(colour, dtype=np.int16)
        distance = np.sum(difference.astype(np.int32) ** 2, axis=2)
        closer = distance < best_distance
        best_distance[closer] = distance[closer]
        best_label[closer] = label
        counts[name] = 0
    matched = best_distance <= maximum_distance**2
    best_label[~matched] = 0
    for label, name in enumerate(palette, start=1):
        counts[name] = int(np.count_nonzero(best_label == label))
    return best_label, counts


def _level_for_magnification(slide: openslide.OpenSlide, target: float) -> int:
    objective = float(slide.properties[openslide.PROPERTY_NAME_OBJECTIVE_POWER])
    return min(
        range(slide.level_count),
        key=lambda level: abs(objective / slide.level_downsamples[level] - target),
    )


def _tile_features(image: Image.Image) -> dict[str, float]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    hsv = np.asarray(image.convert("HSV"), dtype=np.float32) / 255.0
    hue, saturation, value = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    tissue = ((saturation > 0.08) & (value < 0.96)) | (value < 0.70)
    tissue_count = int(np.count_nonzero(tissue))
    if not tissue_count:
        return {
            "tissue_fraction": 0.0,
            "mean_gradient": 0.0,
            "dark_fraction": 0.0,
            "pen_fraction": 0.0,
        }
    grey = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    horizontal = tissue[:, 1:] & tissue[:, :-1]
    vertical = tissue[1:, :] & tissue[:-1, :]
    gradients: list[np.ndarray] = []
    if np.any(horizontal):
        gradients.append(np.abs(grey[:, 1:] - grey[:, :-1])[horizontal])
    if np.any(vertical):
        gradients.append(np.abs(grey[1:, :] - grey[:-1, :])[vertical])
    mean_gradient = float(np.mean(np.concatenate(gradients))) if gradients else 0.0
    dark = tissue & (value < 0.35)
    pen = tissue & (hue >= 0.45) & (hue <= 0.75) & (saturation > 0.45) & (value < 0.85)
    return {
        "tissue_fraction": tissue_count / tissue.size,
        "mean_gradient": mean_gradient,
        "dark_fraction": int(np.count_nonzero(dark)) / tissue_count,
        "pen_fraction": int(np.count_nonzero(pen)) / tissue_count,
    }


def _annotation_counts_for_tile(
    typed: np.ndarray,
    tile: tuple[int, int, int, int],
    level_dimensions: tuple[int, int],
    labels: list[str],
) -> dict[str, int]:
    x, y, width, height = tile
    level_width, level_height = level_dimensions
    annotation_height, annotation_width = typed.shape
    left = math.floor(x * annotation_width / level_width)
    top = math.floor(y * annotation_height / level_height)
    right = math.ceil((x + width) * annotation_width / level_width)
    bottom = math.ceil((y + height) * annotation_height / level_height)
    region = typed[top:bottom, left:right]
    return {
        name: int(np.count_nonzero(region == label)) for label, name in enumerate(labels, start=1)
    }


def _require_manifest_labels(
    slide: CorpusSlide, annotation_counts: dict[str, int], truth_reject: bool
) -> None:
    if annotation_counts != slide.annotation_counts or truth_reject != slide.truth_reject:
        raise ValueError(f"annotation labels differ from corpus manifest: {slide.slide_id}")


def _extract_slide(
    slide_spec: CorpusSlide,
    source_root: Path,
    declaration: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], int]:
    slide_path = source_root / slide_spec.source.relative_path
    annotation_path = source_root / slide_spec.annotation.relative_path
    for asset, path in ((slide_spec.source, slide_path), (slide_spec.annotation, annotation_path)):
        if path.stat().st_size != asset.bytes or _sha256(path) != asset.sha256:
            raise ValueError(f"source asset differs from corpus manifest: {path}")

    label_spec = declaration["labels"]
    annotation_rgb = np.asarray(Image.open(annotation_path).convert("RGB"))
    typed, annotation_counts = _typed_annotation(
        annotation_rgb,
        label_spec["palette_rgb"],
        float(label_spec["maximum_rgb_distance"]),
    )
    truth_reject = sum(annotation_counts.values()) > 0
    _require_manifest_labels(slide_spec, annotation_counts, truth_reject)

    candidate = declaration["candidate"]
    tile_pixels = int(candidate["tile_pixels"])
    spatial: list[dict[str, Any]] = []
    with openslide.OpenSlide(slide_path) as slide:
        scanner_id = slide.properties.get("aperio.ScanScope ID")
        if scanner_id != slide_spec.scanner_id:
            raise ValueError(f"scanner identity differs for {slide_spec.slide_id}: {scanner_id!r}")
        level = _level_for_magnification(slide, float(candidate["target_magnification"]))
        level_width, level_height = slide.level_dimensions[level]
        downsample = slide.level_downsamples[level]
        pixels_read = 0
        for y in range(0, level_height, tile_pixels):
            for x in range(0, level_width, tile_pixels):
                width = min(tile_pixels, level_width - x)
                height = min(tile_pixels, level_height - y)
                image = slide.read_region(
                    (round(x * downsample), round(y * downsample)), level, (width, height)
                ).convert("RGB")
                features = _tile_features(image)
                pixels_read += width * height
                counts = _annotation_counts_for_tile(
                    typed,
                    (x, y, width, height),
                    (level_width, level_height),
                    list(label_spec["palette_rgb"]),
                )
                spatial.append(
                    {
                        "slide_id": slide_spec.slide_id,
                        "scanner_id": slide_spec.scanner_id,
                        "level": level,
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                        **features,
                        "annotation_counts": counts,
                    }
                )

    minimum_tissue = float(candidate["minimum_tissue_fraction"])
    tissue_tiles = [tile for tile in spatial if tile["tissue_fraction"] >= minimum_tissue]
    if not tissue_tiles:
        raise ValueError(f"no eligible tissue tiles for {slide_spec.slide_id}")
    median_gradient = float(np.median([tile["mean_gradient"] for tile in tissue_tiles]))
    blur = candidate["blur"]
    blur_tiles = [
        tile
        for tile in tissue_tiles
        if tile["mean_gradient"] <= float(blur["maximum_mean_gradient"])
        and tile["mean_gradient"] <= median_gradient * float(blur["maximum_median_ratio"])
    ]
    blur_burden = len(blur_tiles) / len(tissue_tiles)
    maximum_pen = max(tile["pen_fraction"] for tile in tissue_tiles)
    maximum_dark = max(tile["dark_fraction"] for tile in tissue_tiles)
    reject_reasons = []
    if blur_burden >= float(blur["minimum_burden"]):
        reject_reasons.append("regional_blur")
    if maximum_pen >= float(candidate["pen"]["minimum_tile_fraction"]):
        reject_reasons.append("blue_or_teal_pen")
    if maximum_dark >= float(candidate["dark"]["minimum_tile_fraction"]):
        reject_reasons.append("dark_fold_or_foreign_material")
    prediction = bool(reject_reasons)
    score = min(
        1.0,
        max(
            blur_burden / float(blur["minimum_burden"]),
            maximum_pen / float(candidate["pen"]["minimum_tile_fraction"]),
            maximum_dark / float(candidate["dark"]["minimum_tile_fraction"]),
        ),
    )
    features = {
        "slide_id": slide_spec.slide_id,
        "patient_id": slide_spec.patient_id,
        "scanner_id": slide_spec.scanner_id,
        "eligible_tiles": len(tissue_tiles),
        "median_gradient": median_gradient,
        "blur_burden": blur_burden,
        "maximum_pen_fraction": maximum_pen,
        "maximum_dark_fraction": maximum_dark,
        "quality_risk_score": score,
    }
    result = {
        **features,
        "truth_reject": truth_reject,
        "prediction_reject": prediction,
        "correct": prediction == truth_reject,
        "reject_reasons": reject_reasons,
        "annotation_counts": annotation_counts,
    }
    return features, result, spatial, pixels_read


def _classification_metrics(rows: list[dict[str, Any]]) -> dict[str, float | int]:
    true_positive = sum(row["truth_reject"] and row["prediction_reject"] for row in rows)
    true_negative = sum(not row["truth_reject"] and not row["prediction_reject"] for row in rows)
    false_positive = sum(not row["truth_reject"] and row["prediction_reject"] for row in rows)
    false_negative = sum(row["truth_reject"] and not row["prediction_reject"] for row in rows)
    sensitivity_denominator = true_positive + false_negative
    specificity_denominator = true_negative + false_positive
    sensitivity = true_positive / sensitivity_denominator if sensitivity_denominator else 1.0
    specificity = true_negative / specificity_denominator if specificity_denominator else 1.0
    return {
        "slides": len(rows),
        "true_positive": true_positive,
        "true_negative": true_negative,
        "false_positive": false_positive,
        "false_negative": false_negative,
        "accuracy": (true_positive + true_negative) / len(rows),
        "sensitivity": sensitivity,
        "specificity": specificity,
        "balanced_accuracy": (sensitivity + specificity) / 2,
    }


def _mcnemar(candidate: list[bool], baseline: list[bool]) -> dict[str, float | int]:
    candidate_only = sum(c and not b for c, b in zip(candidate, baseline, strict=True))
    baseline_only = sum(b and not c for c, b in zip(candidate, baseline, strict=True))
    discordant = candidate_only + baseline_only
    if not discordant or candidate_only <= baseline_only:
        probability = 1.0
    else:
        probability = (
            sum(math.comb(discordant, value) for value in range(candidate_only, discordant + 1))
            / 2**discordant
        )
    return {
        "candidate_only_correct": candidate_only,
        "baseline_only_correct": baseline_only,
        "discordant": discordant,
        "one_sided_exact_p": probability,
    }


def _scanner_slices(
    rows: list[dict[str, Any]], declaration: dict[str, Any]
) -> list[dict[str, Any]]:
    stopping = declaration["stopping_rules"]
    slices: list[dict[str, Any]] = []
    for scanner_id in sorted({row["scanner_id"] for row in rows}):
        selected = [row for row in rows if row["scanner_id"] == scanner_id]
        metrics = _classification_metrics(selected)
        positives = sum(row["truth_reject"] for row in selected)
        negatives = len(selected) - positives
        eligible = (
            len(selected) >= int(stopping["scanner_slice_minimum_n"])
            and bool(positives)
            and bool(negatives)
        )
        slices.append(
            {
                "scanner_id": scanner_id,
                "positives": positives,
                "negatives": negatives,
                "best_constant_accuracy": max(positives, negatives) / len(selected),
                "eligible_for_collapse_gate": eligible,
                **metrics,
            }
        )
    return slices


def _write_scanner_identity_stop(
    corpus: Corpus,
    declaration: dict[str, Any],
    started_wall: float,
    started_cpu: float,
    started_io: dict[str, int],
    verified_bytes: int,
) -> None:
    missing = [slide for slide in corpus.slides if slide.scanner_id is None]
    per_slide = [
        {
            "slide_id": slide.slide_id,
            "patient_id": slide.patient_id,
            "scanner_id": slide.scanner_id,
            "scanner_model": slide.scanner_model,
            "truth_reject": slide.truth_reject,
            "annotation_counts": slide.annotation_counts,
            "evaluation_status": "not_run_scanner_identity_preflight_stop",
        }
        for slide in corpus.slides
    ]
    metrics = {
        "status": "not_run_scanner_identity_preflight_stop",
        "slides": len(corpus.slides),
        "evaluated_slides": 0,
        "accuracy": None,
        "sensitivity": None,
        "specificity": None,
        "balanced_accuracy": None,
    }
    _write_jsonl(OUTPUT_ROOT / "features.jsonl", [])
    _write_jsonl(OUTPUT_ROOT / "per-slide.jsonl", per_slide)
    _write_jsonl(OUTPUT_ROOT / "spatial-evidence.jsonl", [])
    _write_json(OUTPUT_ROOT / "failures.json", {"failures": []})
    _write_json(OUTPUT_ROOT / "metrics.json", metrics)

    ended_io = _process_io()
    wall_seconds = time.perf_counter() - started_wall
    cpu_seconds = time.process_time() - started_cpu
    input_bytes = sum(slide.source.bytes + slide.annotation.bytes for slide in corpus.slides)
    output_bytes = _output_bytes()
    largest_asset_bytes = max(
        max(slide.source.bytes, slide.annotation.bytes) for slide in corpus.slides
    )
    peak_disk_upper_bound = input_bytes * 2 + largest_asset_bytes + output_bytes
    caps = declaration["resource_caps"]
    stop_reasons = [f"stable native scanner ID is absent for {len(missing)} fixed-cohort slide(s)"]
    if wall_seconds > caps["wall_seconds"]:
        stop_reasons.append("wall-time cap exceeded")
    if cpu_seconds > caps["cpu_seconds"]:
        stop_reasons.append("CPU-time cap exceeded")
    if input_bytes > caps["network_download_bytes"]:
        stop_reasons.append("declared download cap exceeded")
    if peak_disk_upper_bound > caps["peak_local_disk_bytes"]:
        stop_reasons.append("declared peak local disk cap exceeded")
    resources = {
        "schema_version": "1.0.0",
        "wall_seconds": wall_seconds,
        "cpu_seconds": cpu_seconds,
        "gpu_seconds": 0,
        "peak_vram_bytes": 0,
        "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "source_bytes_manifested": input_bytes,
        "source_bytes_verified_in_preflight": verified_bytes,
        "acquisition_network_bytes": input_bytes,
        "result_bytes_before_report": output_bytes,
        "peak_local_disk_bytes_upper_bound": peak_disk_upper_bound,
        "peak_local_disk_method": (
            "Conservative logical upper bound: materialized inputs plus a complete DVC cache, "
            "one largest-asset temporary copy, and result bytes."
        ),
        "pixels_read": 0,
        "process_read_bytes": ended_io.get("read_bytes", 0) - started_io.get("read_bytes", 0),
        "process_rchar": ended_io.get("rchar", 0) - started_io.get("rchar", 0),
        "spatial_records": 0,
    }
    _write_json(OUTPUT_ROOT / "resources.json", resources)
    positive_slides = sum(slide.truth_reject for slide in corpus.slides)
    known_groups = Counter(
        slide.scanner_id for slide in corpus.slides if slide.scanner_id is not None
    )
    report = {
        "schema_version": "1.0.0",
        "experiment_id": declaration["experiment_id"],
        "corpus_id": corpus.corpus_id,
        "decision": "stop",
        "stop_stage": "scanner_identity_preflight",
        "stop_reasons": stop_reasons,
        "clinical_validity_claimed": False,
        "candidate": {
            **declaration["candidate"],
            "evaluation_status": "not_run_due_to_predeclared_stop_gate",
        },
        "calibration": {
            "applicable": False,
            "reason": "No candidate score or probability was evaluated after the preflight stop.",
        },
        "metrics": metrics,
        "constant_baselines": {
            "status": "descriptive_only_not_tested_against_candidate",
            "constant_accept_accuracy": (len(corpus.slides) - positive_slides) / len(corpus.slides),
            "constant_reject_accuracy": positive_slides / len(corpus.slides),
        },
        "scanner_identity_audit": {
            "known_native_groups": dict(sorted(known_groups.items())),
            "missing": [
                {
                    "slide_id": slide.slide_id,
                    "patient_id": slide.patient_id,
                    "scanner_model": slide.scanner_model,
                }
                for slide in missing
            ],
        },
        "scanner_held_out_slices": [],
        "spatial_evidence_status": "not_produced_due_to_predeclared_preflight_stop",
        "label_audit": {
            "positive_slides": positive_slides,
            "clean_negative_slides": len(corpus.slides) - positive_slides,
            "tissue_gate_used_for_slide_label": False,
            "content_conflation_gate": {
                "passed": True,
                "basis": (
                    "Truth is any released artifact-palette pixel before tissue filtering; "
                    "no feature aggregation was run."
                ),
            },
            "annotation_pixels_by_type": {
                name: sum(slide.annotation_counts[name] for slide in corpus.slides)
                for name in declaration["labels"]["classes"]
            },
        },
        "exclusions": corpus.exclusions,
        "failed_acquisitions": corpus.failed_acquisitions,
        "run_failures": [],
        "rights_boundary": declaration["rights_boundary"],
        "provenance": {
            **corpus.provenance,
            "registry_base_revision": corpus.registry_base_revision,
            "registry_subset_id": corpus.registry_subset_id,
            "registry_index_sha256": corpus.registry_index_sha256,
            "registry_collection_manifest_sha256": (corpus.registry_collection_manifest_sha256),
            "registry_subset_manifest_sha256": corpus.registry_subset_manifest_sha256,
            "registry_asset_manifest_sha256": corpus.registry_asset_manifest_sha256,
            "source_index_sha256": corpus.source_index_sha256,
            "corpus_manifest_sha256": _sha256(CORPUS_PATH),
            "predeclaration_sha256": _sha256(PREDECLARATION_PATH),
        },
        "resources": resources,
    }
    _write_json(OUTPUT_ROOT / "report.json", report)
    print(
        f"Public pilot stopped at scanner identity preflight: "
        f"missing={len(missing)}, slides={len(corpus.slides)}."
    )


def run() -> None:  # noqa: C901 - the run gate keeps acquisition, evaluation, and stop evidence.
    started_wall = time.perf_counter()
    started_cpu = time.process_time()
    started_io = _process_io()
    declaration = _read_json(PREDECLARATION_PATH)
    corpus = Corpus.model_validate(_read_json(CORPUS_PATH))
    if len(corpus.slides) != declaration["cohort"]["expected_slides"]:
        raise ValueError("corpus size differs from the predeclaration")
    source_root = (PROJECT_ROOT / corpus.source_root).resolve()
    if any(slide.scanner_id is None for slide in corpus.slides):
        verified_bytes = _verify_corpus_assets(corpus, source_root)
        _write_scanner_identity_stop(
            corpus,
            declaration,
            started_wall,
            started_cpu,
            started_io,
            verified_bytes,
        )
        return
    features: list[dict[str, Any]] = []
    per_slide: list[dict[str, Any]] = []
    spatial: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    pixels_read = 0
    for slide in corpus.slides:
        try:
            slide_features, result, slide_spatial, slide_pixels = _extract_slide(
                slide, source_root, declaration
            )
            features.append(slide_features)
            per_slide.append(result)
            spatial.extend(slide_spatial)
            pixels_read += slide_pixels
        except Exception as error:
            failures.append(
                {
                    "slide_id": slide.slide_id,
                    "error_type": type(error).__name__,
                    "message": str(error),
                }
            )
    if failures:
        _write_json(OUTPUT_ROOT / "failures.json", {"failures": failures})
        raise ValueError(f"public pilot recorded {len(failures)} slide failure(s)")

    metrics = _classification_metrics(per_slide)
    candidate_correct = [bool(row["correct"]) for row in per_slide]
    accept_correct = [not bool(row["truth_reject"]) for row in per_slide]
    reject_correct = [bool(row["truth_reject"]) for row in per_slide]
    constant_accept_accuracy = sum(accept_correct) / len(accept_correct)
    constant_reject_accuracy = sum(reject_correct) / len(reject_correct)
    comparisons = {
        "constant_accept": {
            "accuracy": constant_accept_accuracy,
            **_mcnemar(candidate_correct, accept_correct),
        },
        "constant_reject": {
            "accuracy": constant_reject_accuracy,
            **_mcnemar(candidate_correct, reject_correct),
        },
    }
    scanner_slices = _scanner_slices(per_slide, declaration)
    stop_reasons: list[str] = []
    if not any(not row["truth_reject"] for row in per_slide):
        stop_reasons.append("clean negatives are absent")
    if len(scanner_slices) < int(declaration["stopping_rules"]["minimum_scanner_groups"]):
        stop_reasons.append("fewer than two stable scanner groups are present")
    for name, comparison in comparisons.items():
        if comparison["one_sided_exact_p"] >= 0.05:
            stop_reasons.append(f"deterministic candidate does not reject {name}")
    maximum_drop = float(declaration["stopping_rules"]["maximum_scanner_accuracy_drop"])
    stop_reasons.extend(
        f"scanner-held-out collapse on {scanner_slice['scanner_id']}"
        for scanner_slice in scanner_slices
        if scanner_slice["eligible_for_collapse_gate"]
        and scanner_slice["accuracy"] < scanner_slice["best_constant_accuracy"]
        and metrics["accuracy"] - scanner_slice["accuracy"] > maximum_drop
    )

    _write_jsonl(OUTPUT_ROOT / "features.jsonl", features)
    _write_jsonl(OUTPUT_ROOT / "per-slide.jsonl", per_slide)
    _write_jsonl(OUTPUT_ROOT / "spatial-evidence.jsonl", spatial)
    _write_json(OUTPUT_ROOT / "failures.json", {"failures": []})
    _write_json(OUTPUT_ROOT / "metrics.json", metrics)

    ended_io = _process_io()
    wall_seconds = time.perf_counter() - started_wall
    cpu_seconds = time.process_time() - started_cpu
    input_bytes = sum(slide.source.bytes + slide.annotation.bytes for slide in corpus.slides)
    output_bytes = _output_bytes()
    largest_asset_bytes = max(
        max(slide.source.bytes, slide.annotation.bytes) for slide in corpus.slides
    )
    peak_disk_upper_bound = input_bytes * 2 + largest_asset_bytes + output_bytes
    resources = {
        "schema_version": "1.0.0",
        "wall_seconds": wall_seconds,
        "cpu_seconds": cpu_seconds,
        "gpu_seconds": 0,
        "peak_vram_bytes": 0,
        "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
        "source_bytes_verified": input_bytes,
        "acquisition_network_bytes": input_bytes,
        "result_bytes_before_report": output_bytes,
        "peak_local_disk_bytes_upper_bound": peak_disk_upper_bound,
        "peak_local_disk_method": (
            "Conservative logical upper bound: materialized inputs plus a complete DVC cache, "
            "one largest-asset temporary copy, and result bytes."
        ),
        "pixels_read": pixels_read,
        "process_read_bytes": ended_io.get("read_bytes", 0) - started_io.get("read_bytes", 0),
        "process_rchar": ended_io.get("rchar", 0) - started_io.get("rchar", 0),
        "spatial_records": len(spatial),
    }
    caps = declaration["resource_caps"]
    if wall_seconds > caps["wall_seconds"]:
        stop_reasons.append("wall-time cap exceeded")
    if cpu_seconds > caps["cpu_seconds"]:
        stop_reasons.append("CPU-time cap exceeded")
    if input_bytes > caps["network_download_bytes"]:
        stop_reasons.append("declared download cap exceeded")
    if peak_disk_upper_bound > caps["peak_local_disk_bytes"]:
        stop_reasons.append("declared peak local disk cap exceeded")
    _write_json(OUTPUT_ROOT / "resources.json", resources)
    report = {
        "schema_version": "1.0.0",
        "experiment_id": declaration["experiment_id"],
        "corpus_id": corpus.corpus_id,
        "decision": "stop" if stop_reasons else "continue",
        "stop_reasons": sorted(set(stop_reasons)),
        "clinical_validity_claimed": False,
        "candidate": declaration["candidate"],
        "calibration": {
            "applicable": False,
            "reason": "The deterministic quality risk is a threshold ratio, not a probability.",
        },
        "metrics": metrics,
        "constant_baselines": comparisons,
        "scanner_held_out_slices": scanner_slices,
        "label_audit": {
            "positive_slides": sum(row["truth_reject"] for row in per_slide),
            "clean_negative_slides": sum(not row["truth_reject"] for row in per_slide),
            "tissue_gate_used_for_slide_label": False,
            "content_conflation_gate": {
                "passed": True,
                "basis": (
                    "Truth is any released artifact-palette pixel before tissue filtering; "
                    "tissue eligibility affects feature aggregation only."
                ),
            },
            "annotation_pixels_by_type": dict(
                Counter(
                    {
                        name: sum(row["annotation_counts"][name] for row in per_slide)
                        for name in declaration["labels"]["classes"]
                    }
                )
            ),
        },
        "exclusions": corpus.exclusions,
        "failed_acquisitions": corpus.failed_acquisitions,
        "run_failures": [],
        "rights_boundary": declaration["rights_boundary"],
        "provenance": {
            **corpus.provenance,
            "registry_base_revision": corpus.registry_base_revision,
            "registry_subset_id": corpus.registry_subset_id,
            "registry_index_sha256": corpus.registry_index_sha256,
            "registry_collection_manifest_sha256": (corpus.registry_collection_manifest_sha256),
            "registry_subset_manifest_sha256": corpus.registry_subset_manifest_sha256,
            "registry_asset_manifest_sha256": corpus.registry_asset_manifest_sha256,
            "source_index_sha256": corpus.source_index_sha256,
            "corpus_manifest_sha256": _sha256(CORPUS_PATH),
            "predeclaration_sha256": _sha256(PREDECLARATION_PATH),
        },
        "resources": resources,
    }
    _write_json(OUTPUT_ROOT / "report.json", report)
    print(
        f"Public pilot {report['decision']}: accuracy={metrics['accuracy']:.3f}, "
        f"slides={metrics['slides']}, stop_reasons={len(report['stop_reasons'])}."
    )


def verify() -> None:
    report = _read_json(OUTPUT_ROOT / "report.json")
    resources = _read_json(OUTPUT_ROOT / "resources.json")
    corpus = Corpus.model_validate(_read_json(CORPUS_PATH))
    declaration = _read_json(PREDECLARATION_PATH)
    if report["decision"] not in {"stop", "continue"}:
        raise ValueError("public-pilot decision is invalid")
    if report["metrics"]["slides"] != len(corpus.slides):
        raise ValueError("public-pilot slide count differs from the corpus")
    if report["provenance"]["corpus_manifest_sha256"] != _sha256(CORPUS_PATH):
        raise ValueError("public-pilot corpus provenance is stale")
    if report["provenance"]["predeclaration_sha256"] != _sha256(PREDECLARATION_PATH):
        raise ValueError("public-pilot predeclaration provenance is stale")
    if resources["gpu_seconds"] != declaration["resource_caps"]["gpu_seconds"]:
        raise ValueError("public-pilot used undeclared GPU time")
    if resources["peak_vram_bytes"] != declaration["resource_caps"]["peak_vram_bytes"]:
        raise ValueError("public-pilot used undeclared VRAM")
    expected_outputs = {
        "failures.json",
        "features.jsonl",
        "metrics.json",
        "per-slide.jsonl",
        "report.json",
        "resources.json",
        "spatial-evidence.jsonl",
    }
    missing = [name for name in expected_outputs if not (OUTPUT_ROOT / name).is_file()]
    if missing:
        raise ValueError(f"public-pilot outputs are missing: {', '.join(sorted(missing))}")
    accuracy = report["metrics"]["accuracy"]
    accuracy_text = "not evaluated" if accuracy is None else f"{accuracy:.3f} accuracy"
    print(f"Verified public pilot decision={report['decision']}: {accuracy_text}.")
