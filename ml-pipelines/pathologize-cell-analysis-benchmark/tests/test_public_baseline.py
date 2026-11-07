from __future__ import annotations

import csv
import hashlib
import io
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from data_artifacts.files import read_jsonl, write_json
from PIL import Image, ImageDraw
from pydantic import ValidationError

from pathologize_cell_analysis.contracts import DatasetManifest, Experiment
from pathologize_cell_analysis.data import (
    Annotation,
    acquire_dataset,
    build_cohort,
    load_annotations,
)
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


def _digest(value: bytes, algorithm: str) -> str:
    return hashlib.new(algorithm, value).hexdigest()


def _zip_bytes(name: str, content: bytes) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(name, content)
    return target.getvalue()


def _source_manifest(archives: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    if archives is None:
        archives = [
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
        ]
    return {
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
        "archives": archives,
        "classification_field": "super_classification",
        "classification_labels": CLASSES,
        "unmappable_categories": {
            "AMBIGUOUS": "source ambiguity",
            "other_nucleus": "no biological super-class",
        },
    }


def _write_split(path: Path, rows: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.writer(target)
        writer.writerow(["", "slide_name", "hospital", "type", "fold"])
        for index, (slide, site) in enumerate(rows):
            writer.writerow([index, slide, site, "test", 1])


def _item_name(slide: str) -> str:
    return f"{slide}_id-fixture_left-0_top-0_bottom-96_right-96"


def _write_item(root: Path, slide: str) -> None:
    item = _item_name(slide)
    image = Image.new("RGB", (96, 96), "white")
    draw = ImageDraw.Draw(image)
    boxes = [(10, 10, 30, 30), (38, 10, 58, 30), (66, 10, 86, 30)]
    colors = [(80, 40, 90), (50, 30, 80), (100, 40, 100)]
    for box, color in zip(boxes, colors, strict=True):
        draw.ellipse(box, fill=color)
    image_path = root / "rgb" / f"{item}.png"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(image_path)
    annotation_path = root / "annotations" / f"{item}.csv"
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


def _experiment() -> dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "experiment_id": "nucls-public-baseline-v1",
        "dataset_manifest": "sources/nucls-corrected-single-rater.json",
        "data_directory": "data/nucls-corrected-single-rater",
        "output_directory": "outputs/public/nucls-public-baseline-v1",
        "random_seed": 7,
        "test_fold": 1,
        "validation_fold": 2,
        "localization_tolerance_pixels": 15.0,
        "minimum_nucleus_pixels": 8,
        "watershed_minimum_distance_pixels": 4,
        "classification_minimum_gain": 0.01,
        "per_run_wall_seconds": 60,
        "aggregate_accelerator_seconds": 86400,
        "accelerator": "none",
    }


def test_acquisition_verifies_and_extracts(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    contents = {
        "rgb": _zip_bytes("rgb/item.png", b"png"),
        "annotations": _zip_bytes("csv/item.csv", b"header\n"),
        "splits": _zip_bytes("train_test_splits/fold_1_test.csv", b"header\n"),
    }
    archives = []
    for name, prefix, suffix in (
        ("rgb", "rgb", ".png"),
        ("annotations", "csv", ".csv"),
        ("splits", "train_test_splits", ".csv"),
    ):
        value = contents[name]
        archives.append(
            {
                "name": name,
                "url": f"https://example.test/{name}.zip",
                "bytes": len(value),
                "md5": _digest(value, "md5"),
                "sha256": _digest(value, "sha256"),
                "member_prefix": f"{prefix}/",
                "member_suffix": suffix,
            }
        )
    manifest_path = tmp_path / "source.json"
    write_json(manifest_path, _source_manifest(archives))

    def fake_urlopen(request: Any, timeout: int) -> io.BytesIO:
        assert timeout == 60
        name = Path(request.full_url).stem
        return io.BytesIO(contents[name])

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    evidence = acquire_dataset(manifest_path, tmp_path / "data")
    assert len(evidence.archives) == 3
    assert (tmp_path / "data/rgb/item.png").read_bytes() == b"png"
    assert (tmp_path / "data/acquisition.json").is_file()
    with pytest.raises(FileExistsError):
        acquire_dataset(manifest_path, tmp_path / "data")


def test_contracts_reject_incomplete_sources_and_equal_folds() -> None:
    source = _source_manifest()
    source["archives"] = source["archives"][:2]
    with pytest.raises(ValidationError):
        DatasetManifest.model_validate(source)
    experiment = _experiment()
    experiment["validation_fold"] = 1
    with pytest.raises(ValidationError):
        Experiment.model_validate(experiment)


def test_point_annotation_is_localization_only(tmp_path: Path) -> None:
    path = tmp_path / "point.csv"
    path.write_text(
        ",raw_classification,main_classification,super_classification,type,xmin,ymin,"
        "xmax,ymax,coords_x,coords_y\n"
        '0,tumor,tumor_nonMitotic,tumor_any,point,5,6,5,6,"5,5","6,6"\n',
        encoding="utf-8",
    )
    annotation = load_annotations(path)[0]
    assert annotation.annotation_type == "point"
    assert annotation.center == (5.0, 6.0)
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
    assert segmentation.localized_count == 0


def test_localization_maximizes_matches_within_tolerance() -> None:
    truth = [
        Annotation(
            class_name="tumor_any",
            annotation_type="point",
            xmin=center,
            ymin=0,
            xmax=center,
            ymax=0,
            coordinates_x=(center,),
            coordinates_y=(0,),
        )
        for center in (0, 10)
    ]
    predictions = [
        PredictedNucleus(
            instance_id=index,
            center_x=center,
            center_y=row,
            xmin=0,
            ymin=0,
            xmax=1,
            ymax=1,
            flat_pixels=np.asarray([0], dtype=np.int64),
        )
        for index, (center, row) in enumerate(((1, 0), (0, 9)), start=1)
    ]
    assert sorted(match_localizations(truth, predictions, tolerance_pixels=10.0)) == [
        (0, 1),
        (1, 0),
    ]


def test_cohort_run_and_report(tmp_path: Path) -> None:
    project = tmp_path
    source_path = project / "sources/nucls-corrected-single-rater.json"
    experiment_path = project / "experiments/nucls-public-baseline.json"
    data_root = project / "data/nucls-corrected-single-rater"
    source = _source_manifest()
    write_json(source_path, source)
    write_json(experiment_path, _experiment())
    write_json(
        data_root / "acquisition.json",
        {
            "schema_version": "1.0.0",
            "dataset_id": source["dataset_id"],
            "archives": [
                {
                    "name": archive["name"],
                    "url": archive["url"],
                    "bytes": archive["bytes"],
                    "md5": archive["md5"],
                    "sha256": archive["sha256"],
                    "extracted_files": 1,
                }
                for archive in source["archives"]
            ],
        },
    )
    train_slide = "TCGA-TR-0001-DX1"
    validation_slide = "TCGA-VA-0002-DX1"
    test_slide = "TCGA-TE-0003-DX1"
    for slide in (train_slide, validation_slide, test_slide):
        _write_item(data_root, slide)
    split_root = data_root / "splits"
    _write_split(split_root / "fold_1_train.csv", [(train_slide, "TR"), (validation_slide, "VA")])
    _write_split(split_root / "fold_1_test.csv", [(test_slide, "TE")])
    _write_split(split_root / "fold_2_test.csv", [(validation_slide, "VA")])
    cohort = build_cohort(data_root, 1, 2)
    assert cohort.patient_intersections["train_test"] == []
    assert cohort.site_intersections["train_test"] == []
    assert cohort.item_counts == {"train": 1, "validation": 1, "test": 1}
    annotations = load_annotations(data_root / cohort.items[0].annotation_path)
    assert annotations[0].center == (20.0, 20.0)
    result = run(experiment_path)
    assert result["baseline"]["resources"]["gpu_seconds"] == 0
    assert result["candidate"]["classification"]["evaluated_instances"] > 0
    assert result["localization"]["truth_by_annotation_type"] == {
        "polyline": 3,
        "rectangle": 1,
    }
    assert result["instance_segmentation"]["eligible_polygon_instances"] == 3
    assert set(result["morphology_site_slices"]) == {"TE"}
    assert "localization" not in result["baseline"]
    assert "instance_segmentation" not in result["candidate"]
    prediction_path = project / _experiment()["output_directory"]
    predictions = prediction_path / "morphology-logistic-v1/predictions.jsonl"
    assert predictions.is_file()
    first_prediction = read_jsonl(predictions)[0]
    assert len(first_prediction["field_sha256"]) == 64
    assert {"item_id", "slide_id", "patient_id", "site_id"}.isdisjoint(first_prediction)
    report_result = report(
        experiment_path,
        project / "reports/result.json",
        project / "reports/result.md",
    )
    assert report_result["recommendation"] in {"promote_candidate", "reject_candidate"}
    markdown = (project / "reports/result.md").read_text(encoding="utf-8")
    assert "## Resources" in markdown
    assert all(len(line) <= 120 for line in markdown.splitlines())


def test_cohort_rejects_raw_test_train_slide_overlap(tmp_path: Path) -> None:
    split_root = tmp_path / "splits"
    overlapping_slide = "TCGA-OV-0001-DX1"
    _write_split(split_root / "fold_1_train.csv", [(overlapping_slide, "OV")])
    _write_split(split_root / "fold_1_test.csv", [(overlapping_slide, "OV")])
    _write_split(split_root / "fold_2_test.csv", [])

    with pytest.raises(ValueError, match="test fold overlaps"):
        build_cohort(tmp_path, 1, 2)


def test_segmentation_and_localization_matching() -> None:
    image = np.full((64, 64, 3), 255, dtype=np.uint8)
    image[20:40, 20:40] = (70, 30, 80)
    predictions = segment_nuclei(image, minimum_pixels=8, minimum_distance=4)
    assert predictions
    predicted = PredictedNucleus(
        instance_id=1,
        center_x=10.0,
        center_y=10.0,
        xmin=5,
        ymin=5,
        xmax=15,
        ymax=15,
        flat_pixels=np.asarray([1, 2, 3], dtype=np.int64),
    )
    annotation_path = Path(__file__).parent / "missing.csv"
    assert not annotation_path.exists()
    from pathologize_cell_analysis.data import Annotation

    annotation = Annotation(
        class_name="tumor_any",
        annotation_type="rectangle",
        xmin=5,
        ymin=5,
        xmax=15,
        ymax=15,
        coordinates_x=(5, 15, 15, 5),
        coordinates_y=(5, 5, 15, 15),
    )
    assert match_localizations([annotation], [predicted], 1.0) == [(0, 0)]
    assert match_localizations([], [predicted], 1.0) == []
