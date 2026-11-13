from __future__ import annotations

import json
import tarfile
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal

import numpy as np
import pytest
from data_artifacts.files import sha256_file
from PIL import Image, ImageDraw

import pathologize_cell_analysis.annotation_foundation_models as foundation
import pathologize_cell_analysis.annotation_pilot as pilot
from pathologize_cell_analysis.annotation_foundation_models import ModelResult
from pathologize_cell_analysis.annotation_pilot import PilotOptions
from pathologize_cell_analysis.data import Annotation


def _annotation(
    kind: Literal["point", "polyline", "rectangle"] = "polyline", offset: int = 0
) -> Annotation:
    return Annotation(
        "tumor_any",
        kind,
        10 + offset,
        9 + offset,
        28 + offset,
        30 + offset,
        (10 + offset, 28 + offset, 28 + offset, 10 + offset),
        (9 + offset, 9 + offset, 30 + offset, 30 + offset),
    )


def _image() -> np.ndarray[Any, np.dtype[np.uint8]]:
    image = Image.new("RGB", (64, 64), "white")
    ImageDraw.Draw(image).ellipse((11, 10, 27, 29), fill=(65, 35, 85))
    return np.asarray(image)


def _item(item_id: str, split: str, annotation_path: str) -> SimpleNamespace:
    return SimpleNamespace(
        item_id=item_id,
        split=split,
        site_id="SITE-A" if split == "train" else "SITE-B",
        annotation_path=annotation_path,
        image_path=f"images/{item_id}.png",
        source_dataset_id="nucls-corrected-single-rater-20220301",
    )


def test_annotation_pilot_writes_revisable_review_batch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    train = _item("train-item", "train", "annotations/train.csv")
    validation = _item("validation-item", "validation", "annotations/validation.csv")
    annotations = {
        "train.csv": [_annotation(), _annotation("rectangle", 12)],
        "validation.csv": [_annotation()],
    }
    cohort = SimpleNamespace(items=[train, validation])
    monkeypatch.setattr(pilot, "load_cohort", lambda: cohort)
    monkeypatch.setattr(
        pilot,
        "load_annotations",
        lambda path: annotations[Path(path).name],
    )
    monkeypatch.setattr(pilot, "load_rgb", lambda _path: _image())

    result = pilot.run_annotation_pilot(
        PilotOptions(
            output=tmp_path / "pilot",
            maximum_polygon_evaluations=4,
            review_items=3,
            random_seed=17,
        )
    )

    assert result["source_annotations_modified"] is False
    assert result["evaluation"]["validation"]["count"] == 1
    assert result["review_batch"]["count"] == 3
    assert (tmp_path / "pilot/review-batch.png").is_file()
    feedback = json.loads((tmp_path / "pilot/feedback-template.json").read_text())
    assert {decision["object_decision"] for decision in feedback["decisions"]} == {"not_reviewed"}


def test_workbench_bundle_keeps_assets_pinned_and_source_geometry_unchanged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = foundation.load_comparison_config(
        Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"
    )
    record = {
        "sample_id": "sample-1",
        "item_id": "train-item",
        "annotation_index": 0,
        "split": "train",
        "site_id": "SITE-A",
        "class_name": "tumor_any",
    }
    pilot_output = tmp_path / "pilot"
    pilot_output.mkdir()
    (pilot_output / "pilot-report.json").write_text(
        json.dumps({"review_batch": {"records": [record]}}), encoding="utf-8"
    )
    item = _item("train-item", "train", "annotations/train.csv")
    monkeypatch.setattr(
        foundation,
        "_load_record",
        lambda _record, _items: (_annotation(), _image()),
    )
    monkeypatch.setattr(
        foundation,
        "load_cohort",
        lambda: SimpleNamespace(product_id="product-revision", items=[item]),
    )
    assert foundation._cohort_items() == {"train-item": item}
    mask = np.zeros((64, 64), dtype=np.bool_)
    mask[10:30, 11:28] = True
    masks = {name: {"sample-1": mask} for name in ("baseline", "sam2", "cellsam")}
    params = Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"

    path = foundation._write_workbench_bundle(
        config,
        params,
        pilot_output,
        masks,
        {item.item_id: item},
        tmp_path / "comparison",
    )

    bundle = json.loads(path.read_text())
    assert bundle["provenance"]["dataset_revision"] == "product-revision"
    assert len(bundle["provenance"]["producer_revision"]) == 64
    assert bundle["items"][0]["context"]["coordinate_space"] == ("source_pixel_xyxy_inclusive")
    assert {proposal["role"] for proposal in bundle["items"][0]["proposals"]} == {
        "primary",
        "alternative",
        "baseline",
    }
    assert all(len(asset["sha256"]) == 64 for asset in bundle["assets"])


def test_foundation_metrics_report_class_site_and_deterministic_uncertainty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    annotation = _annotation()
    image = _image()
    record = {
        "sample_id": "sample-1",
        "item_id": "train-item",
        "annotation_index": 0,
        "iou": 1.0,
        "class_name": "tumor_any",
        "site_id": "SITE-A",
    }
    monkeypatch.setattr(foundation, "_load_record", lambda _record, _items: (annotation, image))
    truth = foundation._truth_mask(annotation, image.shape[:2])

    result = foundation._metrics([record], {"sample-1": truth}, {}, 23)

    assert result["mean_iou"] == 1.0
    assert result["mean_iou_bootstrap_95_ci"] == [1.0, 1.0]
    assert result["per_class"]["tumor_any"]["count"] == 1
    assert result["per_site"]["SITE-A"]["mean_dice"] == 1.0
    empty = np.zeros((2, 2), dtype=np.bool_)
    assert foundation._overlap(empty, empty) == (0.0, 0.0)


def test_compare_orchestration_writes_smoke_report_without_scientific_claim(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = foundation.load_comparison_config(
        Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"
    )
    record = {"sample_id": "sample-1", "iou": 1.0}
    mask = np.ones((2, 2), dtype=np.bool_)
    model_result = ModelResult({"sample-1": mask}, 0.5, 1024)
    monkeypatch.setattr(foundation, "load_comparison_config", lambda _path: config)
    monkeypatch.setattr(foundation, "_records", lambda _path, _config: [record])
    monkeypatch.setattr(foundation, "_cohort_items", lambda: {})
    monkeypatch.setattr(foundation, "_run_model", lambda *_args: model_result)
    monkeypatch.setattr(foundation, "_run_cellsam", lambda *_args: model_result)
    monkeypatch.setattr(foundation, "_baseline_masks", lambda *_args: {"sample-1": mask})
    monkeypatch.setattr(
        foundation,
        "_metrics",
        lambda *_args: {"mean_iou": 1.0, "records": []},
    )
    monkeypatch.setattr(
        foundation,
        "_verify_cached_weights",
        lambda _pin: {"path": "cache", "sha256": "0" * 64, "bytes": 1},
    )
    bundle = tmp_path / "bundle.json"
    bundle.write_text("{}\n", encoding="utf-8")
    monkeypatch.setattr(foundation, "_write_workbench_bundle", lambda *_args: bundle)
    monkeypatch.setattr(foundation, "_render_sheet", lambda *_args: None)

    result = foundation.compare_foundation_models(
        foundation.ComparisonOptions(
            params=tmp_path / "params.yaml",
            pilot_output=tmp_path / "pilot",
            output=tmp_path / "comparison",
            cellsam_weights=tmp_path / "cellsam.pt",
        )
    )

    assert result["run_kind"] == "smoke_only_no_scientific_claim"
    assert result["workbench_bundle"] == bundle.as_posix()
    assert (tmp_path / "comparison/smoke-report.json").is_file()


def test_cellsam_acquisition_verifies_archive_and_extracted_member(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    member = tmp_path / "cellsam_general.pt"
    member.write_bytes(b"pinned-model-weights")
    archive = tmp_path / "cellsam.tar.gz"
    with tarfile.open(archive, "w:gz") as target:
        target.add(member, arcname="models/cellsam_general.pt")
    config = foundation.load_comparison_config(
        Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"
    )
    original = config.gated_models["cellsam"]
    pin = original.model_copy(
        update={
            "weights_bytes": archive.stat().st_size,
            "weights_sha256": sha256_file(archive),
            "archive_member": "models/cellsam_general.pt",
            "member_bytes": member.stat().st_size,
            "member_sha256": sha256_file(member),
        }
    )
    config = config.model_copy(update={"gated_models": {"cellsam": pin}})
    monkeypatch.setattr(foundation, "load_comparison_config", lambda _path: config)
    monkeypatch.setattr(foundation, "hf_hub_download", lambda **_kwargs: archive.as_posix())
    monkeypatch.setenv("HF_TOKEN", "opaque-test-token")

    result = foundation.acquire_cellsam_weights(
        tmp_path / "params.yaml", tmp_path / "models/cellsam_general.pt"
    )

    assert result["sha256"] == sha256_file(archive)
    assert result["model"]["sha256"] == sha256_file(member)
    assert result["members"] == [
        {"path": "models/cellsam_general.pt", "bytes": member.stat().st_size}
    ]


class _Inputs(dict[str, Any]):
    def to(self, _device: str) -> _Inputs:
        return self


class _Processor:
    image_processor: Any

    def __init__(self) -> None:
        self.image_processor = self

    @classmethod
    def from_pretrained(cls, *_args: Any, **_kwargs: Any) -> _Processor:
        return cls()

    def __call__(self, **_kwargs: Any) -> _Inputs:
        return _Inputs(
            original_sizes=np.asarray([[32, 32]]),
            reshaped_input_sizes=np.asarray([[32, 32]]),
        )


class _Model:
    @classmethod
    def from_pretrained(cls, *_args: Any, **_kwargs: Any) -> _Model:
        return cls()

    def to(self, _device: str) -> _Model:
        return self

    def eval(self) -> _Model:
        return self

    def __call__(self, **_kwargs: Any) -> SimpleNamespace:
        return SimpleNamespace(pred_masks=np.ones((1, 1, 32, 32), dtype=np.float32))


def _patch_cuda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(foundation.torch.cuda, "empty_cache", lambda: None)
    monkeypatch.setattr(foundation.torch.cuda, "reset_peak_memory_stats", lambda: None)
    monkeypatch.setattr(foundation.torch.cuda, "synchronize", lambda: None)
    monkeypatch.setattr(foundation.torch.cuda, "max_memory_allocated", lambda: 2048)
    monkeypatch.setattr(foundation.torch, "autocast", lambda **_kwargs: nullcontext())


def test_pinned_foundation_runner_keeps_each_mask_inside_its_source_box(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = foundation.load_comparison_config(
        Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"
    )
    record = {"sample_id": "sample-1"}
    monkeypatch.setattr(foundation, "SamModel", _Model)
    monkeypatch.setattr(foundation, "SamProcessor", _Processor)
    monkeypatch.setattr(foundation, "_load_record", lambda *_args: (_annotation(), _image()))
    monkeypatch.setattr(
        foundation,
        "_postprocess_mask",
        lambda *_args: np.ones((64, 64), dtype=np.bool_),
    )
    _patch_cuda(monkeypatch)

    result = foundation._run_model("medsam", config.models["medsam"], [record], {}, "cuda:0")

    assert result.peak_vram_bytes == 2048
    assert np.count_nonzero(result.masks["sample-1"]) == 19 * 22


def test_pinned_cellsam_runner_verifies_weights_before_inference(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    weights = tmp_path / "cellsam.pt"
    weights.write_bytes(b"verified-weights")
    config = foundation.load_comparison_config(
        Path(__file__).parents[1] / "params/nucls-annotation-pilot.yaml"
    )
    pin = config.gated_models["cellsam"].model_copy(
        update={
            "member_bytes": weights.stat().st_size,
            "member_sha256": sha256_file(weights),
        }
    )
    model = _Model()
    monkeypatch.setattr(foundation, "get_local_model", lambda _path: model)
    monkeypatch.setattr(foundation, "_load_record", lambda *_args: (_annotation(), _image()))
    monkeypatch.setattr(
        foundation,
        "_segment_cellsam_box",
        lambda *_args: np.ones((64, 64), dtype=np.bool_),
    )
    _patch_cuda(monkeypatch)

    result = foundation._run_cellsam(pin, weights, [{"sample_id": "sample-1"}], {}, "cuda:0")

    assert result.peak_vram_bytes == 2048
    assert np.count_nonzero(result.masks["sample-1"]) == 19 * 22
