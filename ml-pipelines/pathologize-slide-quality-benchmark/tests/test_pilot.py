from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, ClassVar

import numpy as np
import openslide
import pytest
from PIL import Image

import pathologize_slide_quality_pilot.pilot as pilot


def _asset(path: str, content: bytes) -> dict[str, Any]:
    return {
        "relative_path": path,
        "source_url": f"https://public.example.test/{path}",
        "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "publisher_md5": None,
        "publisher_id": path,
    }


def _declaration(expected_slides: int = 2) -> dict[str, Any]:
    return {
        "experiment_id": "test-pilot",
        "cohort": {"expected_slides": expected_slides},
        "resource_caps": {
            "network_download_bytes": 10000,
            "peak_local_disk_bytes": 10000,
            "wall_seconds": 60,
            "cpu_seconds": 60,
            "gpu_seconds": 0,
            "peak_vram_bytes": 0,
        },
        "candidate": {
            "target_magnification": 2.5,
            "tile_pixels": 4,
            "minimum_tissue_fraction": 0.2,
            "blur": {
                "maximum_mean_gradient": 0.018,
                "maximum_median_ratio": 0.45,
                "minimum_burden": 0.1,
            },
            "pen": {"minimum_tile_fraction": 0.002},
            "dark": {"minimum_tile_fraction": 0.12},
        },
        "labels": {
            "classes": ["out_of_focus", "air_bubble", "fold", "penmark"],
            "palette_rgb": {
                "out_of_focus": [255, 0, 0],
                "air_bubble": [255, 255, 0],
                "fold": [0, 255, 0],
                "penmark": [255, 165, 0],
            },
            "maximum_rgb_distance": 60,
        },
        "output_semantics": {
            "task": "artifact_presence_detection_with_spatial_signals",
            "usability_assessment": "not_assessed",
            "usability_reason": "No downstream use case was declared.",
        },
        "stopping_rules": {
            "minimum_scanner_groups": 2,
            "scanner_slice_minimum_n": 4,
            "maximum_scanner_accuracy_drop": 0.15,
            "stop_on_missing_stable_scanner_id": False,
        },
        "rights_boundary": {"allowed_public_artifacts": ["numeric evidence"]},
    }


def _slide(index: int, source: bytes, annotation: bytes) -> dict[str, Any]:
    return {
        "slide_id": f"slide-{index}",
        "patient_id": f"patient-{index}",
        "case_id": f"case-{index}",
        "project_id": "TCGA-TEST",
        "scanner_id": f"scanner-{index}",
        "scanner_manufacturer": "Leica Biosystems",
        "scanner_model": "Aperio ScanScope",
        "objective_power": 40,
        "micrometres_per_pixel": 0.25,
        "source": _asset(f"slides/{index}.svs", source),
        "annotation": _asset(f"annotations/{index}.png", annotation),
        "truth_artifact_present": False,
        "annotation_counts": {
            "out_of_focus": 0,
            "air_bubble": 0,
            "fold": 0,
            "penmark": 0,
        },
    }


def test_typed_annotation_and_tile_features() -> None:
    annotation = np.zeros((2, 2, 3), dtype=np.uint8)
    annotation[0, 0] = (255, 0, 0)
    annotation[1, 1] = (0, 255, 0)
    typed, counts = pilot._typed_annotation(
        annotation,
        {"out_of_focus": [255, 0, 0], "fold": [0, 255, 0]},
        60,
    )

    assert counts == {"out_of_focus": 1, "fold": 1}
    assert typed.tolist() == [[1, 0], [0, 2]]
    blank = pilot._tile_features(Image.new("RGB", (2, 2), "white"))
    assert blank["tissue_fraction"] == 0
    tissue = pilot._tile_features(Image.new("RGB", (2, 2), (120, 40, 80)))
    assert tissue["tissue_fraction"] == 1
    assert tissue["dark_fraction"] == 0


def test_metrics_mcnemar_and_scanner_slices() -> None:
    rows = [
        {
            "scanner_id": "a",
            "truth_artifact_present": True,
            "predicted_artifact_present": True,
        },
        {
            "scanner_id": "a",
            "truth_artifact_present": False,
            "predicted_artifact_present": False,
        },
        {
            "scanner_id": "b",
            "truth_artifact_present": True,
            "predicted_artifact_present": False,
        },
        {
            "scanner_id": "b",
            "truth_artifact_present": False,
            "predicted_artifact_present": False,
        },
        {
            "scanner_id": None,
            "truth_artifact_present": True,
            "predicted_artifact_present": True,
        },
    ]

    metrics = pilot._classification_metrics(rows)
    assert metrics["accuracy"] == 0.8
    assert pilot._mcnemar([True, True, True], [False, False, False])["one_sided_exact_p"] == 0.125
    slices = pilot._scanner_slices(rows, _declaration(4))
    assert [item["scanner_id"] for item in slices] == ["a", "b"]
    assert not any(item["eligible_for_collapse_gate"] for item in slices)


def test_extract_slide_uses_fixed_features_and_spatial_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = b"not-a-real-svs"
    annotation_path = tmp_path / "annotations/1.png"
    annotation_path.parent.mkdir(parents=True)
    annotation_image = Image.new("RGB", (4, 4), "black")
    annotation_image.putpixel((0, 0), (255, 0, 0))
    annotation_image.save(annotation_path)
    annotation = annotation_path.read_bytes()
    slide_path = tmp_path / "slides/1.svs"
    slide_path.parent.mkdir(parents=True)
    slide_path.write_bytes(source)

    class FakeSlide:
        properties: ClassVar[dict[str, str]] = {
            "aperio.ScanScope ID": "scanner-1",
            openslide.PROPERTY_NAME_OBJECTIVE_POWER: "40",
        }
        level_count = 1
        level_downsamples = (1.0,)
        level_dimensions = ((4, 4),)

        def __init__(self, _path: Path) -> None:
            pass

        def __enter__(self) -> FakeSlide:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read_region(
            self, _location: tuple[int, int], _level: int, size: tuple[int, int]
        ) -> Image.Image:
            return Image.new("RGB", size, (180, 90, 130))

    monkeypatch.setattr(pilot.openslide, "OpenSlide", FakeSlide)
    slide_payload = _slide(1, source, annotation)
    slide_payload["truth_artifact_present"] = True
    slide_payload["annotation_counts"]["out_of_focus"] = 1
    slide = pilot.CorpusSlide.model_validate(slide_payload)

    features, result, spatial, pixels_read = pilot._extract_slide(slide, tmp_path, _declaration(1))

    assert features["eligible_tiles"] == 1
    assert result["truth_artifact_present"] is True
    assert result["predicted_artifact_present"] is True
    assert result["detected_signals"] == ["regional_blur_signal"]
    assert result["usability_assessment"] == "not_assessed"
    assert spatial[0]["annotation_counts"]["out_of_focus"] == 1
    assert spatial[0]["detected_signals"] == ["low_gradient_blur_signal"]
    assert spatial[0]["usability_assessment"] == "not_assessed"
    assert pixels_read == 16


def test_run_and_verify_write_a_stopped_negative_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = b"source"
    annotation = b"annotation"
    declaration_path = tmp_path / "predeclaration.json"
    corpus_path = tmp_path / "corpus.json"
    output_root = tmp_path / "results"
    declaration_path.write_text(json.dumps(_declaration()), encoding="utf-8")
    corpus = {
        "schema_version": "1.0.0",
        "corpus_id": "test-corpus",
        "registry_base_revision": "0" * 40,
        "registry_subset_id": "test-subset",
        "registry_index_sha256": "0" * 64,
        "registry_collection_manifest_sha256": "1" * 64,
        "registry_subset_manifest_sha256": "2" * 64,
        "registry_asset_manifest_sha256": "3" * 64,
        "source_index_sha256": "4" * 64,
        "source_root": "raw",
        "slides": [_slide(1, source, annotation), _slide(2, source, annotation)],
        "exclusions": [],
        "failed_acquisitions": [],
        "provenance": {"source": "test"},
    }
    corpus_path.write_text(json.dumps(corpus), encoding="utf-8")

    def fake_extract(
        slide: pilot.CorpusSlide, _root: Path, _declaration: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], int]:
        truth = slide.slide_id == "slide-1"
        features = {
            "slide_id": slide.slide_id,
            "patient_id": slide.patient_id,
            "scanner_id": slide.scanner_id,
            "eligible_tiles": 1,
            "median_gradient": 0.1,
            "blur_burden": 0.0,
            "maximum_pen_fraction": 0.0,
            "maximum_dark_fraction": 0.0,
            "artifact_signal_score": float(truth),
        }
        result = {
            **features,
            "truth_artifact_present": truth,
            "predicted_artifact_present": truth,
            "artifact_presence_correct": True,
            "detected_signals": ["test"] if truth else [],
            "usability_assessment": "not_assessed",
            "annotation_counts": {
                "out_of_focus": int(truth),
                "air_bubble": 0,
                "fold": 0,
                "penmark": 0,
            },
        }
        return features, result, [{"slide_id": slide.slide_id}], 1

    monkeypatch.setattr(pilot, "PREDECLARATION_PATH", declaration_path)
    monkeypatch.setattr(pilot, "CORPUS_PATH", corpus_path)
    monkeypatch.setattr(pilot, "OUTPUT_ROOT", output_root)
    monkeypatch.setattr(pilot, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(pilot, "_extract_slide", fake_extract)

    pilot.run()
    pilot.verify()

    report = json.loads((output_root / "report.json").read_text(encoding="utf-8"))
    assert report["decision"] == "stop"
    assert len(report["stop_reasons"]) == 2
    assert report["metrics"]["accuracy"] == 1
    assert report["learned_candidate_decision"]["evaluated"] is False
    assert report["usability_assessment"]["status"] == "not_assessed"
    assert set(report["constant_baselines"]) == {"constant_absent", "constant_present"}


def test_run_keeps_missing_scanner_identity_in_primary_evaluation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = b"source"
    annotation = b"annotation"
    declaration_path = tmp_path / "predeclaration.json"
    corpus_path = tmp_path / "corpus.json"
    output_root = tmp_path / "results"
    declaration_path.write_text(json.dumps(_declaration()), encoding="utf-8")
    slides = [_slide(1, source, annotation), _slide(2, source, annotation)]
    slides[0]["scanner_id"] = None
    slides[0]["scanner_model"] = "Leica SCN400"
    slides[0]["truth_artifact_present"] = True
    slides[0]["annotation_counts"]["fold"] = 1
    corpus = {
        "schema_version": "1.0.0",
        "corpus_id": "test-corpus",
        "registry_base_revision": "0" * 40,
        "registry_subset_id": "test-subset",
        "registry_index_sha256": "0" * 64,
        "registry_collection_manifest_sha256": "1" * 64,
        "registry_subset_manifest_sha256": "2" * 64,
        "registry_asset_manifest_sha256": "3" * 64,
        "source_index_sha256": "4" * 64,
        "source_root": "raw",
        "slides": slides,
        "exclusions": [],
        "failed_acquisitions": [],
        "provenance": {"source": "test"},
    }
    corpus_path.write_text(json.dumps(corpus), encoding="utf-8")
    for index in (1, 2):
        source_path = tmp_path / f"raw/slides/{index}.svs"
        annotation_path = tmp_path / f"raw/annotations/{index}.png"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        annotation_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_bytes(source)
        annotation_path.write_bytes(annotation)
    monkeypatch.setattr(pilot, "PREDECLARATION_PATH", declaration_path)
    monkeypatch.setattr(pilot, "CORPUS_PATH", corpus_path)
    monkeypatch.setattr(pilot, "OUTPUT_ROOT", output_root)
    monkeypatch.setattr(pilot, "PROJECT_ROOT", tmp_path)

    evaluated: list[str] = []

    def fake_extract(
        slide: pilot.CorpusSlide, _root: Path, _declaration: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], int]:
        evaluated.append(slide.slide_id)
        features = {
            "slide_id": slide.slide_id,
            "patient_id": slide.patient_id,
            "scanner_id": slide.scanner_id,
            "eligible_tiles": 1,
            "median_gradient": 0.1,
            "blur_burden": float(slide.truth_artifact_present),
            "maximum_pen_fraction": 0.0,
            "maximum_dark_fraction": 0.0,
            "artifact_signal_score": float(slide.truth_artifact_present),
        }
        result = {
            **features,
            "truth_artifact_present": slide.truth_artifact_present,
            "predicted_artifact_present": slide.truth_artifact_present,
            "artifact_presence_correct": True,
            "detected_signals": (["regional_blur_signal"] if slide.truth_artifact_present else []),
            "usability_assessment": "not_assessed",
            "annotation_counts": slide.annotation_counts,
        }
        return features, result, [{"slide_id": slide.slide_id}], 1

    monkeypatch.setattr(pilot, "_extract_slide", fake_extract)

    pilot.run()
    pilot.verify()

    report = json.loads((output_root / "report.json").read_text(encoding="utf-8"))
    assert evaluated == ["slide-1", "slide-2"]
    assert report["decision"] == "stop"
    assert report["metrics"]["slides"] == 2
    assert report["scanner_identity_audit"]["missing"][0]["patient_id"] == "patient-1"
    assert report["scanner_identity_audit"]["missing_identity_slides"] == 1
    assert [item["scanner_id"] for item in report["scanner_held_out_slices"]] == ["scanner-2"]
    assert all("scanner ID" not in reason for reason in report["stop_reasons"])
    assert (output_root / "spatial-evidence.jsonl").read_text(encoding="utf-8")
