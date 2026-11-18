from __future__ import annotations

import csv
import importlib
import json
import time
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pytest
import torch
import yaml
from data_artifacts.files import read_yaml, sha256_file
from nucleus_analysis_dataset import CohortEvidence
from PIL import Image
from pydantic import ValidationError
from ultralytics_extensions.checkpoints import resume_evidence
from ultralytics_extensions.labels import (
    bbox_to_yolo,
    polygon_to_yolo,
    yolo_to_bbox,
    yolo_to_polygon,
)
from ultralytics_extensions.recovery import (
    TrainingTaskState,
    load_training_task_state,
    write_training_task_state,
)

import pathologize_cell_analysis.learned_baseline.conversion as conversion_module
import pathologize_cell_analysis.learned_baseline.task_training as task_training_module
from pathologize_cell_analysis.contracts import (
    LearnedBaselineConfig,
    SpatialPrediction,
)
from pathologize_cell_analysis.data import Annotation, SplitItem
from pathologize_cell_analysis.learned_baseline.config import (
    LAYOUT_DIRECTORY,
    WEIGHTS_DIRECTORY,
    load_config,
)
from pathologize_cell_analysis.learned_baseline.conversion import (
    acquire_model_artifacts,
    convert_annotations,
    prepare_training_layout,
)
from pathologize_cell_analysis.learned_baseline.detection_calibration import (
    CalibrationPredictionRecord,
    DetectionCalibrationConfig,
    _filter_records,
    _require_complete_records,
    _write_markdown_report,
    load_calibration_config,
    paired_slide_bootstrap,
)
from pathologize_cell_analysis.learned_baseline.evaluation import (
    as_predicted_nucleus,
    evaluate_records,
    training_curve_summary,
)
from pathologize_cell_analysis.learned_baseline.prediction import (
    normalize_pathologize_result,
    prediction_arguments,
)
from pathologize_cell_analysis.learned_baseline.reporting import _report_markdown
from pathologize_cell_analysis.learned_baseline.task_training import (
    _prepare_task_retry,
    _validate_completed_task_state,
    train_task,
    transfer_backbone_neck_from_checkpoint,
)
from pathologize_cell_analysis.learned_baseline.training import (
    _clean_failed_training_output,
    _clear_ultralytics_caches,
    _clear_ultralytics_runtime_config,
)
from pathologize_cell_analysis.learned_baseline.training_policy import (
    seed_training_monitor,
    training_arguments,
)


def _fixture() -> dict[str, Any]:
    path = Path(__file__).parents[1] / "fixtures/ultralytics-conversion.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _params_document() -> dict[str, Any]:
    path = Path(__file__).parents[1] / "params/nucls-learned.yaml"
    document = read_yaml(path)
    assert isinstance(document, dict)
    return document


def _calibration_params_document() -> dict[str, Any]:
    path = Path(__file__).parents[1] / "params/nucls-detection-calibration.yaml"
    document = read_yaml(path)
    assert isinstance(document, dict)
    return document


def _write_params(root: Path, document: dict[str, Any]) -> Path:
    path = root / "params/nucls-learned.yaml"
    path.parent.mkdir(parents=True)
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return path


def _annotations(rows: list[dict[str, Any]]) -> list[Annotation]:
    return [
        Annotation(
            class_name=row["class_name"],
            annotation_type=row["annotation_type"],
            xmin=row["xmin"],
            ymin=row["ymin"],
            xmax=row["xmax"],
            ymax=row["ymax"],
            coordinates_x=tuple(row["coordinates_x"]),
            coordinates_y=tuple(row["coordinates_y"]),
        )
        for row in rows
    ]


def test_golden_ultralytics_conversion() -> None:
    fixture = _fixture()
    image_size = fixture["image_width"], fixture["image_height"]
    annotations = _annotations(fixture["annotations"])
    observed_exclusions: dict[str, dict[str, int]] = {}
    for task, expected_key in (
        ("detect", "expected_detection_labels"),
        ("segment", "expected_segmentation_labels"),
    ):
        result = convert_annotations(
            annotations,
            image_size,
            fixture["ontology_labels"],
            task,
        )
        assert list(result.labels) == fixture[expected_key]
        reasons: dict[str, int] = {}
        for exclusion in result.exclusions:
            reasons[exclusion.reason] = reasons.get(exclusion.reason, 0) + 1
        observed_exclusions[task] = reasons
    assert observed_exclusions == fixture["expected_exclusions"]


def test_coordinate_round_trips_preserve_source_pixels() -> None:
    image_size = (100, 80)
    bbox = (10.0, 20.0, 30.0, 40.0)
    normalized_bbox = bbox_to_yolo(bbox, image_size)
    assert yolo_to_bbox(normalized_bbox, image_size) == pytest.approx(bbox, abs=1e-9)
    polygon = ((10.0, 20.0), (30.0, 20.0), (30.0, 40.0), (10.0, 40.0))
    normalized_polygon = polygon_to_yolo(polygon, image_size)
    observed_polygon = yolo_to_polygon(normalized_polygon, image_size)
    for observed, expected in zip(observed_polygon, polygon, strict=True):
        assert observed == pytest.approx(expected, abs=1e-9)


def test_conversion_rejects_fabricated_geometry() -> None:
    with pytest.raises(ValueError, match="positive area"):
        bbox_to_yolo((10.0, 10.0, 10.0, 10.0), (100, 100))
    with pytest.raises(ValueError, match="three unique points"):
        polygon_to_yolo(((1.0, 1.0), (2.0, 2.0), (1.0, 1.0)), (100, 100))


def test_conversion_records_bounded_source_border_clipping() -> None:
    annotation = Annotation(
        class_name="tumor_any",
        annotation_type="polyline",
        xmin=80,
        ymin=60,
        xmax=102,
        ymax=82,
        coordinates_x=(80, 102, 102, 80, 80),
        coordinates_y=(60, 60, 82, 82, 60),
    )
    detection = convert_annotations(
        [annotation], (100, 80), _fixture()["ontology_labels"], "detect", 2.0
    )
    segmentation = convert_annotations(
        [annotation], (100, 80), _fixture()["ontology_labels"], "segment", 2.0
    )
    assert not detection.exclusions
    assert not segmentation.exclusions
    assert detection.adjustments[0].reason == "clipped_to_image_bounds"
    assert segmentation.adjustments[0].reason == "clipped_to_image_bounds"
    rejected = convert_annotations(
        [annotation], (99, 79), _fixture()["ontology_labels"], "detect", 2.0
    )
    assert rejected.exclusions[0].reason == "invalid_source_box"


def test_parameter_config_is_strict_and_complete() -> None:
    document = _params_document()
    experiment = LearnedBaselineConfig.model_validate(document)
    assert set(experiment.models) == {"detect", "segment"}
    assert experiment.limits.aggregate_gpu_seconds == 86400
    assert experiment.training.segment_initialization == "detect_checkpoint_backbone_neck"
    document["models"].pop("segment")
    with pytest.raises(ValidationError):
        LearnedBaselineConfig.model_validate(document)


def test_segment_initialization_transfers_shared_weights_and_retains_head(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeSourceModel:
        def float(self) -> FakeSourceModel:
            return self

        def state_dict(self) -> dict[str, torch.Tensor]:
            return {
                "model.0.weight": torch.tensor([7.0]),
                "model.1.weight": torch.tensor([8.0]),
                "model.2.weight": torch.tensor([9.0]),
            }

    class FakeTargetModel:
        def __init__(self) -> None:
            self.model = [object(), object(), object()]
            self.values = {
                "model.0.weight": torch.tensor([1.0]),
                "model.1.weight": torch.tensor([2.0]),
                "model.2.weight": torch.tensor([3.0]),
                "model.2.mask": torch.tensor([4.0]),
            }

        def state_dict(self) -> dict[str, torch.Tensor]:
            return self.values

        def load_state_dict(self, values: dict[str, torch.Tensor], *, strict: bool) -> None:
            assert strict is False
            self.values.update(values)

    class FakeYolo:
        def __init__(self) -> None:
            self.model = FakeTargetModel()

    checkpoint = tmp_path / "detect.pt"
    checkpoint.write_bytes(b"pinned detection checkpoint")
    monkeypatch.setattr(
        task_training_module,
        "load_safe_checkpoint",
        lambda _torch, _path: {"model": FakeSourceModel()},
    )
    target = FakeYolo()
    evidence = transfer_backbone_neck_from_checkpoint(target, torch, checkpoint)
    assert target.model.values["model.0.weight"].item() == 7.0
    assert target.model.values["model.1.weight"].item() == 8.0
    assert target.model.values["model.2.weight"].item() == 3.0
    assert target.model.values["model.2.mask"].item() == 4.0
    assert evidence["excluded_head_prefix"] == "model.2."
    assert evidence["transferred_tensor_count"] == 2
    assert evidence["retained_head_tensor_count"] == 2


def test_detection_calibration_grid_is_predeclared_and_ordered(tmp_path: Path) -> None:
    document = _calibration_params_document()
    calibration = DetectionCalibrationConfig.model_validate(document)
    assert load_calibration_config() == calibration
    assert calibration.selection_split == "validation"
    assert calibration.confidence_thresholds[0] == calibration.baseline_confidence_threshold
    assert calibration.baseline_nms_iou_threshold in calibration.nms_iou_thresholds
    document["confidence_thresholds"] = [0.1, 0.05]
    with pytest.raises(ValidationError, match="strictly increasing"):
        DetectionCalibrationConfig.model_validate(document)
    document = _calibration_params_document()
    document["baseline_confidence_threshold"] = 0.1
    mismatched = tmp_path / "mismatched.yaml"
    mismatched.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    with pytest.raises(ValueError, match="differs from the merged baseline"):
        load_calibration_config(mismatched)


def test_detection_calibration_components_import_without_cycles() -> None:
    package = "pathologize_cell_analysis.learned_baseline.detection_calibration"
    for component in ("evaluation", "inference", "validation"):
        module = importlib.import_module(f"{package}_{component}")
        assert module.__name__.endswith(component)


def test_interrupted_training_resume_evidence_and_monitor(tmp_path: Path) -> None:
    task_output = tmp_path / "detect"
    weights = task_output / "weights"
    weights.mkdir(parents=True)
    (weights / "last.pt").write_bytes(b"checkpoint")
    (task_output / "results.csv").write_text(
        "epoch,time,metrics/mAP50-95(B),val/box_loss,val/cls_loss\n"
        "1,12.5,0.1,2.0,1.0\n"
        "2,23.0,0.2,1.5,0.8\n",
        encoding="utf-8",
    )
    resume = resume_evidence(task_output)
    assert resume is not None
    assert resume.completed_epochs == 2
    assert resume.elapsed_seconds_upper_bound == 23.0
    monitor = seed_training_monitor(
        [
            {
                "metrics/mAP50-95(B)": 0.1,
                "val/box_loss": 2.0,
                "val/cls_loss": 1.0,
            },
            {
                "metrics/mAP50-95(B)": 0.2,
                "val/box_loss": 1.5,
                "val/cls_loss": 0.8,
            },
        ]
    )
    assert monitor.best_map50_95 == 0.2
    assert monitor.best_validation_loss == 2.3
    assert monitor.stop_reason is None


def test_failed_training_cleanup_preserves_resumable_output(tmp_path: Path) -> None:
    empty_output = tmp_path / "empty"
    empty_output.mkdir()
    _clean_failed_training_output(empty_output, output_root_existed=False)
    assert not empty_output.exists()

    recoverable_output = tmp_path / "recoverable"
    recoverable_output.mkdir()
    (recoverable_output / "detect-state.json").write_text("{}", encoding="utf-8")
    _clean_failed_training_output(recoverable_output, output_root_existed=False)
    assert recoverable_output.is_dir()

    resumable_output = tmp_path / "resumable"
    checkpoint = resumable_output / "detect" / "weights" / "last.pt"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"checkpoint")
    _clean_failed_training_output(resumable_output, output_root_existed=False)
    assert checkpoint.is_file()

    preexisting_output = tmp_path / "preexisting"
    preexisting_output.mkdir()
    _clean_failed_training_output(preexisting_output, output_root_existed=True)
    assert preexisting_output.is_dir()


def test_completed_training_state_validates_checkpoint_hashes(tmp_path: Path) -> None:
    best = tmp_path / "training/detect/weights/best.pt"
    last = tmp_path / "training/detect/weights/last.pt"
    best.parent.mkdir(parents=True)
    best.write_bytes(b"best")
    last.write_bytes(b"last")
    checkpoint = {
        "best": best.relative_to(tmp_path).as_posix(),
        "best_sha256": sha256_file(best),
        "last": last.relative_to(tmp_path).as_posix(),
        "last_sha256": sha256_file(last),
    }
    resource = {"gpu_seconds": 2.0}
    state = TrainingTaskState(
        status="complete",
        consumed_gpu_seconds_upper_bound=2.0,
        wall_seconds=2.5,
        cpu_seconds=1.0,
        peak_rss_bytes=10,
        peak_vram_bytes=20,
        resource=resource,
        checkpoint=checkpoint,
    )
    assert _validate_completed_task_state(tmp_path, "detect", state) == (resource, checkpoint)
    last.write_bytes(b"changed")
    with pytest.raises(ValueError, match="checkpoint evidence differs"):
        _validate_completed_task_state(tmp_path, "detect", state)


def test_precheckpoint_failure_is_cleaned_and_gpu_time_is_carried(tmp_path: Path) -> None:
    task_output = tmp_path / "detect"
    task_output.mkdir()
    (task_output / "results.csv").write_text("epoch,time\n1,7.5\n", encoding="utf-8")
    state = TrainingTaskState(
        status="failed",
        consumed_gpu_seconds_upper_bound=7.5,
        wall_seconds=7.5,
        cpu_seconds=1.0,
        peak_rss_bytes=10,
        peak_vram_bytes=20,
    )
    resume, consumed_seconds, unrecorded_seconds = _prepare_task_retry(task_output, state)
    assert resume is None
    assert consumed_seconds == 7.5
    assert unrecorded_seconds == 0
    assert not task_output.exists()


def test_running_attempt_uses_wall_clock_for_abrupt_failure_accounting(tmp_path: Path) -> None:
    state = TrainingTaskState(
        status="running",
        consumed_gpu_seconds_upper_bound=6.0,
        wall_seconds=6.0,
        cpu_seconds=1.0,
        peak_rss_bytes=10,
        peak_vram_bytes=20,
        attempt_base_gpu_seconds_upper_bound=5.0,
        attempt_started_at_unix_seconds=100.0,
    )
    resume, consumed_seconds, unrecorded_seconds = _prepare_task_retry(
        tmp_path / "detect", state, now_unix_seconds=110.0
    )
    assert resume is None
    assert consumed_seconds == 15.0
    assert unrecorded_seconds == 9.0


def test_finalized_checkpoint_reruns_validation_before_completion(tmp_path: Path) -> None:
    experiment = load_config()
    pin = experiment.models["detect"]
    model_root = tmp_path / WEIGHTS_DIRECTORY
    weights = model_root / pin.weights
    definition = model_root / Path(pin.definition).name
    weights.parent.mkdir(parents=True)
    weights.write_bytes(b"starting weights")
    definition.write_bytes(b"model definition")
    experiment = experiment.model_copy(
        update={
            "models": {
                **experiment.models,
                "detect": pin.model_copy(
                    update={
                        "weights_sha256": sha256_file(weights),
                        "definition_sha256": sha256_file(definition),
                    }
                ),
            }
        }
    )
    layout_root = tmp_path / LAYOUT_DIRECTORY
    layout_root.mkdir(parents=True)
    (layout_root / "manifest.json").write_text("{}\n", encoding="utf-8")

    training_root = tmp_path / "training"
    task_output = training_root / "detect"
    checkpoint_root = task_output / "weights"
    checkpoint_root.mkdir(parents=True)
    (checkpoint_root / "best.pt").write_bytes(b"best")
    torch.save({"epoch": -1}, checkpoint_root / "last.pt")
    (task_output / "results.csv").write_text(
        "epoch,time,metrics/mAP50-95(B),val/box_loss\n1,1.0,0.1,2.0\n",
        encoding="utf-8",
    )
    write_training_task_state(
        training_root / "detect-state.json",
        TrainingTaskState(
            status="running",
            consumed_gpu_seconds_upper_bound=1.0,
            wall_seconds=1.0,
            cpu_seconds=0.5,
            peak_rss_bytes=10,
            peak_vram_bytes=20,
            attempt_base_gpu_seconds_upper_bound=0.0,
            attempt_started_at_unix_seconds=time.time(),
            stop_reason="persistent_validation_regression",
        ),
    )

    validation_calls: list[dict[str, object]] = []

    class FakeModel:
        def val(self, **arguments: object) -> None:
            validation_calls.append(arguments)

    class FailingModel:
        def val(self, **_arguments: object) -> None:
            raise RuntimeError("validation interrupted")

    class FakeEvent:
        def record(self) -> None:
            pass

        def elapsed_time(self, _other: object) -> float:
            return 2_000.0

    class FakeCuda:
        def reset_peak_memory_stats(self) -> None:
            pass

        def Event(self, *, enable_timing: bool) -> FakeEvent:  # noqa: N802
            assert enable_timing
            return FakeEvent()

        def max_memory_allocated(self) -> int:
            return 1024

        def synchronize(self) -> None:
            pass

    fake_cuda = FakeCuda()

    def failing_model_factory(*_args: object, **_kwargs: object) -> FailingModel:
        return FailingModel()

    with pytest.raises(RuntimeError, match="validation interrupted"):
        train_task(
            experiment,
            tmp_path,
            training_root,
            "detect",
            torch,
            fake_cuda,
            failing_model_factory,
        )
    interrupted_state = load_training_task_state(training_root / "detect-state.json")
    assert interrupted_state is not None
    assert interrupted_state.status == "failed"
    assert interrupted_state.stop_reason == "persistent_validation_regression"

    result = train_task(
        experiment,
        tmp_path,
        training_root,
        "detect",
        torch,
        FakeCuda(),
        lambda *_args, **_kwargs: FakeModel(),
    )
    assert validation_calls[0]["split"] == "val"
    assert result.gpu_seconds > 2.0
    completed_state = load_training_task_state(training_root / "detect-state.json")
    assert completed_state is not None
    assert completed_state.status == "complete"
    assert completed_state.stop_reason == "persistent_validation_regression"
    assert result.checkpoint["recovered_final_validation"] is True
    assert result.checkpoint["stop_reason"] == "persistent_validation_regression"


def _write_split(path: Path, rows: list[tuple[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.writer(target)
        writer.writerow(["", "slide_name", "hospital", "type", "fold"])
        for index, (slide, site) in enumerate(rows):
            writer.writerow([index, slide, site, "test", 1])


def _write_annotation(path: Path, *, empty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as target:
        fields = [
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
        writer = csv.DictWriter(target, fieldnames=fields)
        writer.writeheader()
        if not empty:
            writer.writerow(
                {
                    "": 0,
                    "raw_classification": "tumor",
                    "main_classification": "tumor_nonMitotic",
                    "super_classification": "tumor_any",
                    "type": "polyline",
                    "xmin": 10,
                    "ymin": 20,
                    "xmax": 30,
                    "ymax": 40,
                    "coords_x": "10,30,30,10,10",
                    "coords_y": "20,20,40,40,20",
                }
            )


def _write_item(root: Path, slide: str, *, empty: bool = False) -> str:
    item_id = f"{slide}_id-fixture_left-0_top-0_bottom-80_right-100"
    image_path = root / "rgb" / f"{item_id}.png"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (100, 80), "white").save(image_path)
    _write_annotation(root / "annotations" / f"{item_id}.csv", empty=empty)
    return item_id


def test_confidence_filter_and_paired_slide_bootstrap_are_deterministic(
    tmp_path: Path,
) -> None:
    items: dict[str, SplitItem] = {}
    baseline_records: list[CalibrationPredictionRecord] = []
    candidate_records: list[CalibrationPredictionRecord] = []
    for index in range(2):
        slide = f"TCGA-VA-000{index}-DX1"
        item_id = _write_item(tmp_path, slide)
        item = SplitItem(
            product_id="pathologize-nucleus-analysis-nucls-public",
            source_dataset_id="nucls-corrected-single-rater-20220301",
            item_id=item_id,
            slide_id=slide,
            patient_id="-".join(slide.split("-")[:3]),
            site_id="VA",
            split="validation",
            image_path=f"rgb/{item_id}.png",
            annotation_path=f"annotations/{item_id}.csv",
            source_roles={"1": "train"},
            source_labels_present=["tumor_any"],
            target_labels_present=["tumor_any"],
            annotation_count=1,
            adapter_id="nucls-corrected-single-rater-to-nucleus-analysis",
        )
        items[item_id] = item
        common = {
            "schema_version": "1.0.0",
            "task": "detect",
            "item_id": item_id,
            "slide_id": slide,
            "patient_id": item.patient_id,
            "site_id": item.site_id,
            "split": "validation",
            "image_width": 100,
            "image_height": 80,
        }
        baseline_records.append(CalibrationPredictionRecord(**common, predictions=[]))
        candidate_records.append(
            CalibrationPredictionRecord(
                **common,
                predictions=[
                    SpatialPrediction(
                        instance_id=1,
                        class_name="tumor_any",
                        confidence=0.25,
                        bbox_xyxy_pixels=(10.0, 20.0, 30.0, 40.0),
                        polygon_xy_pixels=None,
                    )
                ],
            )
        )
    assert all(not record.predictions for record in _filter_records(candidate_records, 0.3))
    retained = _filter_records(candidate_records, 0.25)
    assert all(len(record.predictions) == 1 for record in retained)
    _require_complete_records(retained, items, "validation")
    with pytest.raises(ValueError, match="do not cover every frozen validation item"):
        _require_complete_records(retained[:1], items, "validation")
    observed = paired_slide_bootstrap(
        baseline_records,
        retained,
        items,
        tmp_path,
        resamples=1000,
        seed=20261109,
        tolerance_pixels=1.0,
    )
    assert observed["delta_intervals"]["f1"] == {"lower": 1.0, "upper": 1.0}


def test_calibration_report_writer_rejects_path_escape(tmp_path: Path) -> None:
    reports = tmp_path / "reports"
    reports.mkdir()
    destination = reports / "calibration.md"
    _write_markdown_report("evidence\n", destination, reports)
    assert destination.read_text(encoding="utf-8") == "evidence\n"
    with pytest.raises(ValueError, match="inside the reports directory"):
        _write_markdown_report("escape\n", tmp_path / "escape.md", reports)


def test_prepare_layout_preserves_splits_ontology_and_empty_images(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = _params_document()
    params_path = _write_params(tmp_path, document)
    data_root = tmp_path / "source-product"
    train_slide = "TCGA-TR-0001-DX1"
    validation_slide = "TCGA-VA-0002-DX1"
    test_slide = "TCGA-TE-0003-DX1"
    train_item = _write_item(data_root, train_slide)
    validation_item = _write_item(data_root, validation_slide)
    test_item = _write_item(data_root, test_slide, empty=True)
    labels = _fixture()["ontology_labels"]

    def record(
        item_id: str,
        slide: str,
        site: str,
        split: Literal["train", "validation", "test"],
        count: int,
    ) -> SplitItem:
        return SplitItem(
            product_id="pathologize-nucleus-analysis-nucls-public",
            source_dataset_id="nucls-corrected-single-rater-20220301",
            item_id=item_id,
            slide_id=slide,
            patient_id="-".join(slide.split("-")[:3]),
            site_id=site,
            split=split,
            image_path=f"rgb/{item_id}.png",
            annotation_path=f"annotations/{item_id}.csv",
            source_roles={"1": "test" if split == "test" else "train"},
            source_labels_present=[] if count == 0 else ["tumor_any"],
            target_labels_present=[] if count == 0 else ["tumor_any"],
            annotation_count=count,
            adapter_id="nucls-corrected-single-rater-to-nucleus-analysis",
        )

    items = [
        record(train_item, train_slide, "TR", "train", 1),
        record(validation_item, validation_slide, "VA", "validation", 1),
        record(test_item, test_slide, "TE", "test", 0),
    ]
    product_cohort = CohortEvidence(
        schema_version="1.0.0",
        product_id="pathologize-nucleus-analysis-nucls-public",
        leakage_unit="patient_id",
        secondary_leakage_unit="slide_id",
        source_statement="fixture",
        items=items,
        item_counts={"train": 1, "validation": 1, "test": 1},
        patient_counts={"train": 1, "validation": 1, "test": 1},
        slide_counts={"train": 1, "validation": 1, "test": 1},
        site_counts={"TE": 1},
        patient_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        slide_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        site_intersections={"train_validation": [], "train_test": [], "validation_test": []},
        held_out_test_sites=["TE"],
    )
    monkeypatch.setattr(conversion_module, "data_root", lambda: data_root)
    monkeypatch.setattr(conversion_module, "cohort", lambda: product_cohort)
    monkeypatch.setattr(conversion_module, "ontology_labels", lambda: labels)

    result: Any = prepare_training_layout(params_path)
    assert result["source_ontology"] == labels
    assert result["split"]["patient_intersections"]["train_test"] == []
    layout = tmp_path / LAYOUT_DIRECTORY
    assert (layout / f"detect/labels/test/{test_item}.txt").read_text(encoding="utf-8") == ""
    assert (layout / f"segment/labels/test/{test_item}.txt").read_text(encoding="utf-8") == ""
    assert "train: images/train" in (layout / "detect.yaml").read_text(encoding="utf-8")
    with pytest.raises(FileExistsError):
        prepare_training_layout(params_path)


def test_acquire_model_artifacts_writes_provenance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    document = _params_document()
    params_path = _write_params(tmp_path, document)

    def fake_download(url: str, output: Path, size: int | None, digest: str) -> None:
        del url, size, digest
        output.write_bytes(output.name.encode())

    monkeypatch.setattr(
        "pathologize_cell_analysis.learned_baseline.conversion._download_pinned_file",
        fake_download,
    )
    result: Any = acquire_model_artifacts(params_path)
    assert len(result["artifacts"]) == 4
    assert result["package"]["version"] == "8.4.202"
    with pytest.raises(FileExistsError):
        acquire_model_artifacts(params_path)


def test_native_prediction_normalization_and_pathologize_evaluation(tmp_path: Path) -> None:
    class Boxes:
        xyxy = torch.tensor([[10.0, 20.0, 30.0, 40.0]])
        conf = torch.tensor([0.9])
        cls = torch.tensor([2.0])

    class Masks:
        def __init__(self) -> None:
            self.xy = [np.asarray([[10.0, 20.0], [30.0, 20.0], [30.0, 40.0], [10.0, 40.0]])]

    class Result:
        orig_shape = (80, 100)
        boxes = Boxes()
        masks = Masks()

    item = SplitItem(
        product_id="pathologize-nucleus-analysis-nucls-public",
        source_dataset_id="nucls-corrected-single-rater-20220301",
        item_id="item",
        slide_id="TCGA-TE-0003-DX1",
        patient_id="TCGA-TE-0003",
        site_id="TE",
        split="test",
        image_path="rgb/item.png",
        annotation_path="annotations/item.csv",
        source_roles={"1": "test", "2": "train"},
        source_labels_present=["tumor_any"],
        target_labels_present=["tumor_any"],
        annotation_count=1,
        adapter_id="nucls-corrected-single-rater-to-nucleus-analysis",
    )
    _write_annotation(tmp_path / item.annotation_path)
    record, rejections = normalize_pathologize_result(
        Result(), item, "segment", _fixture()["ontology_labels"]
    )
    assert not rejections
    assert record.predictions[0].polygon_xy_pixels is not None
    predicted = as_predicted_nucleus(record.predictions[0], (80, 100))
    assert predicted.flat_pixels.size > 0
    evidence: Any = evaluate_records(
        "segment",
        [record],
        {item.item_id: item},
        tmp_path,
        _fixture()["ontology_labels"],
        1.0,
    )
    assert evidence["localization"]["f1"] == 1.0
    assert evidence["instance_segmentation"]["mean_instance_iou"] == 1.0
    assert evidence["held_out_site_slices"]["TE"]["localization"]["f1"] == 1.0


def test_parameterized_runtime_arguments_and_report_helpers(tmp_path: Path) -> None:
    path = Path(__file__).parents[1] / "params/nucls-learned.yaml"
    experiment = load_config(path)
    train = training_arguments(experiment, tmp_path, "detect")
    predict = prediction_arguments(path, "segment")
    assert train["optimizer"] == "AdamW"
    assert train["seed"] == 20261107
    assert train["workers"] == 0
    assert train["plots"] is False
    assert predict["conf"] == 0.05
    assert predict["retina_masks"] is True
    cache = tmp_path / "labels.cache"
    cache.write_text("cache", encoding="utf-8")
    _clear_ultralytics_caches(tmp_path)
    assert not cache.exists()
    runtime_config = tmp_path / "ultralytics-config"
    runtime_config.mkdir()
    (runtime_config / "settings.json").write_text("{}", encoding="utf-8")
    _clear_ultralytics_runtime_config(tmp_path)
    assert not runtime_config.exists()

    curve: Any = training_curve_summary(
        [
            {
                "epoch": 1.0,
                "train/box_loss": 2.0,
                "val/box_loss": 3.0,
                "metrics/mAP50(B)": 0.1,
                "metrics/mAP50-95(B)": 0.05,
            },
            {
                "epoch": 2.0,
                "train/box_loss": 1.0,
                "val/box_loss": 2.0,
                "metrics/mAP50(B)": 0.2,
                "metrics/mAP50-95(B)": 0.1,
            },
        ],
        {"metrics/mAP50(B)": 0.2, "metrics/mAP50-95(B)": 0.1},
        2,
    )
    assert curve["best_checkpoint"]["epoch"] == 2
    assert curve["stopped_by"] == "epoch_ceiling"

    guard_stop: Any = training_curve_summary(
        [
            {
                "epoch": 1.0,
                "train/box_loss": 2.0,
                "val/box_loss": 3.0,
                "metrics/mAP50(B)": 0.1,
                "metrics/mAP50-95(B)": 0.05,
            }
        ],
        {"metrics/mAP50(B)": 0.1, "metrics/mAP50-95(B)": 0.05},
        2,
        stop_reason="persistent_validation_regression",
    )
    assert guard_stop["stopped_by"] == "persistent_validation_regression"
    assert guard_stop["convergence_assessment"] == "stopped_by_guard"

    wall_stop: Any = training_curve_summary(
        [
            {
                "epoch": 1.0,
                "train/box_loss": 2.0,
                "val/box_loss": 3.0,
                "metrics/mAP50(B)": 0.1,
                "metrics/mAP50-95(B)": 0.05,
            }
        ],
        {"metrics/mAP50(B)": 0.1, "metrics/mAP50-95(B)": 0.05},
        2,
        stopped_for_wall_time=True,
    )
    assert wall_stop["stopped_by"] == "wall_time_guard"
    assert wall_stop["convergence_assessment"] == "stopped_by_guard"

    patience_curve = training_curve_summary(
        [{"epoch": 1.0, "train/box_loss": 2.0, "val/box_loss": 3.0}],
        {},
        2,
    )
    assert patience_curve["stopped_by"] == "validation_patience"
    assert patience_curve["convergence_assessment"] == ("validation_plateau_supports_convergence")

    evidence: dict[str, Any] = {
        "tasks": {
            "detect": {
                "per_class": {
                    label: {"localization": {"f1": 0.5}} for label in _fixture()["ontology_labels"]
                },
                "held_out_site_slices": {"TE": {"localization": {"f1": 0.5}}},
            },
            "segment": {
                "per_class": {
                    label: {"instance_segmentation": {"mean_instance_iou": 0.4}}
                    for label in _fixture()["ontology_labels"]
                },
                "held_out_site_slices": {
                    "TE": {"instance_segmentation": {"mean_instance_iou": 0.4}}
                },
            },
        },
        "training_curves": {
            "detect": curve,
            "segment": {
                **curve,
                "metrics": {
                    "metrics/mAP50(M)": curve["metrics"]["metrics/mAP50(B)"],
                    "metrics/mAP50-95(M)": curve["metrics"]["metrics/mAP50-95(B)"],
                },
                "best_checkpoint": {
                    "epoch": 2,
                    "metrics": {"metrics/mAP50(M)": 0.2, "metrics/mAP50-95(M)": 0.1},
                },
            },
        },
        "comparison": {
            "transparent_baseline": {
                "localization_f1": 0.3,
                "conditional_instance_mean_iou": 0.2,
            },
            "learned_baseline": {
                "detection_localization_f1": 0.5,
                "conditional_instance_mean_iou": 0.4,
            },
        },
        "resources": {"aggregate_gpu_seconds": 10.0, "aggregate_gpu_ceiling_seconds": 86400},
        "failures": [],
    }
    markdown = _report_markdown(evidence, experiment)
    assert "YOLO26 nano" in markdown
    assert "10.0 seconds against the 86,400-second ceiling" in markdown
    assert all(len(line) <= 120 for line in markdown.splitlines())
