from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
import pytest
from data_artifacts.files import read_jsonl, write_json
from nucleus_analysis_dataset import CohortEvidence, SplitItem
from nucls_source_data.models import SourceManifest
from PIL import Image, ImageDraw

import pathologize_cell_analysis.experiment as public_experiment
from pathologize_cell_analysis.annotation_foundation_models import (
    _clip_to_box,
    _render_workbench_mask,
    _segment_cellsam_box,
    load_comparison_config,
)
from pathologize_cell_analysis.annotation_pilot import propose_box_mask
from pathologize_cell_analysis.data import Annotation, load_annotations
from pathologize_cell_analysis.experiment import report, run
from pathologize_cell_analysis.instance_segmentation import (
    InstanceSegmentationRecords,
    update_segmentation_records,
)
from pathologize_cell_analysis.localization import (
    LocalizationRecords,
    match_localizations,
    update_localization_records,
)
from pathologize_cell_analysis.methods import PredictedNucleus, segment_nuclei

CLASSES = ["nonTIL_stromal", "sTIL", "tumor_any"]


def test_box_prompt_mask_selects_the_central_nucleus() -> None:
    image = Image.new("RGB", (64, 64), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((20, 18, 44, 46), fill=(65, 35, 85))
    draw.ellipse((5, 5, 12, 12), fill=(45, 25, 70))

    proposal = propose_box_mask(np.asarray(image), (16, 14, 48, 50))

    assert proposal.pixel_count > 300
    assert proposal.candidate_components == 1
    assert proposal.mask[18, 16]
    assert not proposal.mask[0, 0]


def test_box_prompt_mask_never_extends_past_the_clipped_source_box() -> None:
    image = Image.new("RGB", (32, 32), (80, 40, 90))

    proposal = propose_box_mask(np.asarray(image), (-4, -3, 10, 12))

    assert proposal.bbox == (0, 0, 11, 13)
    assert proposal.mask.shape == (13, 11)


def test_foundation_mask_is_clipped_to_the_source_box() -> None:
    mask = np.ones((12, 14), dtype=np.bool_)
    annotation = Annotation(
        "tumor_any",
        "rectangle",
        3,
        2,
        8,
        7,
        (3, 8, 8, 3),
        (2, 2, 7, 7),
    )

    clipped = _clip_to_box(mask, annotation)

    assert np.count_nonzero(clipped) == 36
    assert clipped[2, 3]
    assert clipped[7, 8]
    assert not clipped[1, 3]
    assert not clipped[2, 9]


def test_workbench_mask_is_a_transparent_aligned_overlay() -> None:
    mask = np.zeros((20, 20), dtype=np.bool_)
    mask[5:15, 6:14] = True

    overlay = _render_workbench_mask(mask, (2, 3, 18, 19), 64)
    values = np.asarray(overlay)

    assert overlay.mode == "RGBA"
    assert overlay.size == (64, 64)
    assert np.count_nonzero(values[:, :, 3]) > 0
    assert values[0, 0, 3] == 0


def test_cellsam_no_prediction_becomes_an_empty_proposal() -> None:
    class EmptyModel:
        def eval(self) -> EmptyModel:
            return self

        def to(self, _device: str) -> EmptyModel:
            return self

        def predict(self, *_args: object, **_kwargs: object) -> tuple[None, None, None, None]:
            return None, None, None, None

    image = np.full((32, 32, 3), 127, dtype=np.uint8)

    mask = _segment_cellsam_box(image, EmptyModel(), [[5.0, 5.0, 20.0, 20.0]], "cpu")

    assert mask.shape == (32, 32)
    assert not np.any(mask)


def test_annotation_foundation_model_pins_validate() -> None:
    project = Path(__file__).parents[1]

    config = load_comparison_config(project / "params/nucls-annotation-pilot.yaml")

    assert config.models["sam2"].weights_bytes == 184_305_280
    assert config.gated_models["cellsam"].repository == "vanvalenlab/cellsam"
    assert config.gated_models["cellsam"].license == "Modified-Apache-2.0-NonCommercial"
    assert config.gated_models["cellsam"].member_bytes == 1_158_786_941
    assert config.gated_models["cellsam"].member_sha256 == (
        "e3e3b5ab41cd35fa80d7442fa83f0c092ddffabe2468c016590b9dfc1b5ddd3e"
    )
    assert config.workbench.batch_id == "nucls-box-mask-pilot-20261110"


def _source_manifest() -> SourceManifest:
    return SourceManifest.model_validate(
        {
            "schema_version": "1.0.0",
            "dataset_id": "nucls-corrected-single-rater-20220301",
            "title": "NuCLS corrected single-rater dataset",
            "doi": "10.5524/102207",
            "paper_doi": "10.1093/gigascience/giac037",
            "license": {
                "spdx_id": "CC0-1.0",
                "url": "https://creativecommons.org/publicdomain/zero/1.0/",
                "evidence_url": "https://sites.google.com/view/nucls/single-rater",
            },
            "publisher": "GigaScience Database",
            "publisher_record": "https://gigadb.org/dataset/102207",
            "archives": [
                {
                    "name": name,
                    "url": f"https://example.test/{name}.zip",
                    "bytes": 1,
                    "md5": "0" * 32,
                    "sha256": "0" * 64,
                    "member_prefix": f"{prefix}/",
                    "member_suffix": suffix,
                }
                for name, prefix, suffix in (
                    ("rgb", "rgb", ".png"),
                    ("annotations", "csv", ".csv"),
                    ("splits", "train_test_splits", ".csv"),
                )
            ],
            "classification_fields": [
                "raw_classification",
                "main_classification",
                "super_classification",
            ],
            "classification_field": "super_classification",
            "classification_labels": CLASSES,
            "unmappable_categories": {
                "AMBIGUOUS": "source ambiguity",
                "other_nucleus": "no biological super-class",
            },
        }
    )


def _item_name(slide: str) -> str:
    return f"{slide}_id-fixture_left-0_top-0_bottom-96_right-96"


def _write_item(root: Path, slide: str) -> SplitItem:
    item = _item_name(slide)
    image = Image.new("RGB", (96, 96), "white")
    draw = ImageDraw.Draw(image)
    boxes = [(10, 10, 30, 30), (38, 10, 58, 30), (66, 10, 86, 30)]
    colors = [(80, 40, 90), (50, 30, 80), (100, 40, 100)]
    for box, color in zip(boxes, colors, strict=True):
        draw.ellipse(box, fill=color)
    image_path = root / "data/native/rgb" / f"{item}.png"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(image_path)
    annotation_path = root / "data/native/annotations" / f"{item}.csv"
    annotation_path.parent.mkdir(parents=True, exist_ok=True)
    with annotation_path.open("w", encoding="utf-8", newline="") as target:
        fieldnames = [
            "",
            "raw_classification",
            "main_classification",
            "super_classification",
            "type",
            "xmin",
            "ymin",
            "xmax",
            "ymax",
            "coords_x",
            "coords_y",
        ]
        writer = csv.DictWriter(target, fieldnames=fieldnames)
        writer.writeheader()
        for index, (box, label) in enumerate(zip(boxes, CLASSES, strict=True)):
            xmin, ymin, xmax, ymax = box
            writer.writerow(
                {
                    "": index,
                    "raw_classification": label,
                    "main_classification": label,
                    "super_classification": label,
                    "type": "polyline",
                    "xmin": xmin,
                    "ymin": ymin,
                    "xmax": xmax,
                    "ymax": ymax,
                    "coords_x": f"{xmin},{xmax},{xmax},{xmin},{xmin}",
                    "coords_y": f"{ymin},{ymin},{ymax},{ymax},{ymin}",
                }
            )
        writer.writerow(
            {
                "": 3,
                "raw_classification": "unlabeled",
                "main_classification": "AMBIGUOUS",
                "super_classification": "AMBIGUOUS",
                "type": "rectangle",
                "xmin": 10,
                "ymin": 60,
                "xmax": 20,
                "ymax": 70,
                "coords_x": "10,20,20,10",
                "coords_y": "60,60,70,70",
            }
        )
    return SplitItem(
        product_id="pathologize-nucleus-analysis-nucls-public",
        source_dataset_id="nucls-corrected-single-rater-20220301",
        item_id=item,
        slide_id=slide,
        patient_id="-".join(slide.split("-")[:3]),
        site_id=slide.split("-")[1],
        split="train",
        image_path=image_path.relative_to(root).as_posix(),
        annotation_path=annotation_path.relative_to(root).as_posix(),
        source_roles={"1": "train", "2": "train"},
        source_labels_present=[*CLASSES, "AMBIGUOUS"],
        target_labels_present=[*CLASSES, "AMBIGUOUS"],
        annotation_count=4,
        adapter_id="nucls-corrected-single-rater-to-nucleus-analysis",
    )


def _cohort(items: list[SplitItem]) -> CohortEvidence:
    return CohortEvidence(
        schema_version="1.0.0",
        product_id="pathologize-nucleus-analysis-nucls-public",
        leakage_unit="patient_id",
        secondary_leakage_unit="slide_id",
        source_statement="fixture",
        items=items,
        item_counts={
            split: sum(item.split == split for item in items)
            for split in ("train", "validation", "test")
        },
        patient_counts={"train": 1, "validation": 1, "test": 1},
        slide_counts={"train": 1, "validation": 1, "test": 1},
        site_counts={"TE": 1},
        patient_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        slide_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        site_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        held_out_test_sites=["TE"],
    )


def test_point_annotation_is_localization_only(tmp_path: Path) -> None:
    path = tmp_path / "point.csv"
    path.write_text(
        ",raw_classification,main_classification,super_classification,type,xmin,ymin,"
        "xmax,ymax,coords_x,coords_y\n"
        '0,tumor,tumor_nonMitotic,tumor_any,point,5,6,5,6,"5,5","6,6"\n',
        encoding="utf-8",
    )
    annotation = load_annotations(path)[0]
    prediction = PredictedNucleus(
        instance_id=1,
        center_x=5.0,
        center_y=6.0,
        xmin=5,
        ymin=6,
        xmax=5,
        ymax=6,
        flat_pixels=np.asarray([5 + 6 * 16], dtype=np.int64),
    )
    matches = match_localizations([annotation], [prediction], tolerance_pixels=1.0)
    localization = LocalizationRecords()
    update_localization_records(localization, [annotation], [prediction], matches)
    assert localization.match_count == 1
    segmentation = InstanceSegmentationRecords()
    update_segmentation_records(segmentation, [annotation], [prediction], matches, (16, 16))
    assert segmentation.eligible_count == 0


def test_localization_maximizes_matches_within_tolerance() -> None:
    truth = [
        Annotation("tumor_any", "point", center, 0, center, 0, (center,), (0,))
        for center in (0, 10)
    ]
    predictions = [
        PredictedNucleus(index, center, row, 0, 0, 1, 1, np.asarray([0], dtype=np.int64))
        for index, (center, row) in enumerate(((1, 0), (0, 9)), start=1)
    ]
    assert sorted(match_localizations(truth, predictions, tolerance_pixels=10.0)) == [
        (0, 1),
        (1, 0),
    ]


def test_product_backed_run_and_report(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    project = tmp_path / "project"
    params_path = project / "params/nucls-public.yaml"
    params_path.parent.mkdir(parents=True)
    params_path.write_text(
        "schema_version: 1.0.0\nrandom_seed: 7\nlocalization_tolerance_pixels: 15.0\n"
        "minimum_nucleus_pixels: 8\nwatershed_minimum_distance_pixels: 4\n"
        "classification_minimum_gain: 0.01\nper_run_wall_seconds: 60\n"
        "aggregate_accelerator_seconds: 86400\naccelerator: none\n",
        encoding="utf-8",
    )
    source_root = tmp_path / "source-product"
    items = [
        _write_item(source_root, "TCGA-TR-0001-DX1").model_copy(
            update={"split": "train", "site_id": "TR"}
        ),
        _write_item(source_root, "TCGA-VA-0002-DX1").model_copy(
            update={"split": "validation", "site_id": "VA"}
        ),
        _write_item(source_root, "TCGA-TE-0003-DX1").model_copy(
            update={"split": "test", "site_id": "TE"}
        ),
    ]
    write_json(source_root / "data/native/acquisition.json", {"fixture": True})
    product_cohort = _cohort(items)
    cohort_path = tmp_path / "product/outputs/cohort.json"
    write_json(cohort_path, product_cohort)
    monkeypatch.setattr(public_experiment, "DATASET_ROOT", source_root)
    monkeypatch.setattr(public_experiment, "PRODUCT_DIR", cohort_path.parents[1])
    monkeypatch.setattr(public_experiment, "load_manifest", _source_manifest)
    monkeypatch.setattr(public_experiment, "load_cohort", lambda: product_cohort)

    result = run(params_path)

    assert result["baseline"]["resources"]["gpu_seconds"] == 0
    assert result["candidate"]["classification"]["evaluated_instances"] > 0
    assert result["instance_segmentation"]["eligible_polygon_instances"] == 3
    predictions = project / "outputs/public-baseline/morphology-logistic-v1/predictions.jsonl"
    first_prediction = read_jsonl(predictions)[0]
    assert len(first_prediction["field_sha256"]) == 64
    assert {"item_id", "slide_id", "patient_id", "site_id"}.isdisjoint(first_prediction)
    report_result = report(
        params_path,
        project / "reports/result.json",
        project / "reports/result.md",
    )
    assert report_result["recommendation"] in {"promote_candidate", "reject_candidate"}
    markdown = (project / "reports/result.md").read_text(encoding="utf-8")
    assert "## Resources" in markdown
    assert all(len(line) <= 120 for line in markdown.splitlines())


def test_segmentation_and_localization_matching() -> None:
    image = np.full((64, 64, 3), 255, dtype=np.uint8)
    image[20:40, 20:40] = (70, 30, 80)
    assert segment_nuclei(image, minimum_pixels=8, minimum_distance=4)
    predicted = PredictedNucleus(1, 10.0, 10.0, 5, 5, 15, 15, np.asarray([1, 2, 3], dtype=np.int64))
    annotation = Annotation("tumor_any", "rectangle", 5, 5, 15, 15, (5, 15, 15, 5), (5, 5, 15, 15))
    assert match_localizations([annotation], [predicted], 1.0) == [(0, 0)]
    assert match_localizations([], [predicted], 1.0) == []
