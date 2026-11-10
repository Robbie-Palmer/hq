from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
import torch
import yaml
from data_artifacts.files import read_yaml, sha256_file, write_json

import pathologize_cell_analysis.double_descent.analysis as analysis_module
import pathologize_cell_analysis.double_descent.evaluation as evaluation_module
import pathologize_cell_analysis.double_descent.reporting as reporting_module
import pathologize_cell_analysis.double_descent.test_evaluation as test_evaluation_module
import pathologize_cell_analysis.double_descent.training as training_module
from pathologize_cell_analysis.cli import SeedOptions
from pathologize_cell_analysis.contracts import DoubleDescentConfig, SpatialPredictionRecord
from pathologize_cell_analysis.double_descent.analysis import (
    _f1,
    _interpolation_epoch,
    _rolling,
    analyze_pattern,
    bootstrap_interval,
)
from pathologize_cell_analysis.double_descent.config import (
    PARAMS_FILE,
    load_config,
    seed_evaluation,
    seed_output,
)
from pathologize_cell_analysis.double_descent.evaluation import (
    _completed_epoch,
    _prediction_arguments,
    _validation_metrics,
)
from pathologize_cell_analysis.double_descent.reporting import (
    _report_markdown,
    _test_slices,
    metric_summary,
)
from pathologize_cell_analysis.double_descent.test_evaluation import _box_metrics
from pathologize_cell_analysis.double_descent.training import (
    SafetyMonitor,
    _finite_scalar,
    _prior_state,
    _validate_resources,
    checkpoint_index,
    monitor_training_batch,
    monitor_training_epoch,
    stop_at_deadline,
    training_arguments,
)


def _config() -> DoubleDescentConfig:
    return load_config()


def _write_params(tmp_path: Path, mutate: Any) -> Path:
    document = read_yaml(PARAMS_FILE)
    assert isinstance(document, dict)
    mutate(document)
    path = tmp_path / "params.yaml"
    path.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8")
    return path


def test_predeclaration_matches_merged_baseline() -> None:
    config = _config()
    assert config.training.epochs == 120
    assert config.training.patience == 0
    assert config.seeds == [20261107, 20261109, 20261111]
    assert training_arguments(config, 20261107)["save_period"] == 1
    assert training_arguments(config, 20261107)["seed"] == 20261107
    assert _prediction_arguments(config)["conf"] == 0.05
    assert _prediction_arguments(config)["batch"] == 8
    assert seed_output(7).as_posix().endswith("training/7")
    assert seed_evaluation(7).as_posix().endswith("curves/7")
    assert training_module._peak_rss_bytes() > 0
    assert evaluation_module._peak_rss_bytes() > 0
    assert test_evaluation_module._peak_rss_bytes() > 0


def test_predeclaration_requires_an_object(tmp_path: Path) -> None:
    path = tmp_path / "params.yaml"
    path.write_text("- not-an-object\n", encoding="utf-8")
    with pytest.raises(TypeError, match="must be a YAML object"):
        load_config(path)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda value: value["package"].update(version="8.4.201"), "package pin"),
        (lambda value: value["model"].update(architecture="YOLO26s"), "detector pin"),
        (
            lambda value: value["inference"].update(confidence_threshold=0.1),
            "inference settings",
        ),
        (
            lambda value: value.update(localization_tolerance_pixels=10.0),
            "localization tolerance",
        ),
        (
            lambda value: value.update(maximum_border_clip_pixels=1.0),
            "conversion tolerance",
        ),
        (
            lambda value: value["training"].update(weight_decay=0.001),
            "more than horizon",
        ),
        (
            lambda value: value["analysis"].update(
                baseline_horizon_epochs=value["analysis"]["sustained_epochs"] - 1
            ),
            "at least one smoothing window",
        ),
    ],
)
def test_predeclaration_rejects_changes_beyond_horizon(
    tmp_path: Path, mutate: Any, message: str
) -> None:
    params_path = _write_params(tmp_path, mutate)
    with pytest.raises(ValueError, match=message):
        load_config(params_path)


def test_prediction_record_supports_curve_splits() -> None:
    record = SpatialPredictionRecord(
        schema_version="1.0.0",
        task="detect",
        item_id="item",
        slide_id="slide",
        patient_id="patient",
        site_id="site",
        split="validation",
        image_width=10,
        image_height=10,
        predictions=[],
    )
    assert record.split == "validation"


def test_curve_prediction_chunks_the_frozen_split(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item_ids = [f"item-{index}" for index in range(10)]
    items = {item_id: SimpleNamespace() for item_id in item_ids}
    calls: list[list[str]] = []

    class Model:
        def predict(self, *, source: list[str], **_: object) -> list[SimpleNamespace]:
            calls.append(source)
            return [SimpleNamespace(path=path) for path in source]

    monkeypatch.setattr(
        evaluation_module,
        "normalize_pathologize_result",
        lambda result, *_: (SimpleNamespace(item_id=Path(result.path).stem), []),
    )
    records, rejections = evaluation_module._predict_split(
        Model(), "train", cast(Any, items), [], _config()
    )
    assert [len(call) for call in calls] == [8, 2]
    assert {record.item_id for record in records} == set(item_ids)
    assert rejections == []


def test_completed_evidence_helpers_validate_cached_objects(tmp_path: Path) -> None:
    run_path = tmp_path / "run.json"
    curve_path = tmp_path / "curve.json"
    test_path = tmp_path / "test.json"
    assert training_module._completed_run(run_path, "params") is None
    assert evaluation_module._completed_curve(curve_path, "run") is None
    assert test_evaluation_module._completed_test(test_path) is None

    write_json(run_path, {"parameters_sha256": "params", "seed": 1})
    write_json(curve_path, {"run_sha256": "run", "seed": 1})
    write_json(test_path, {"seeds": {}})
    assert training_module._completed_run(run_path, "params") == {
        "parameters_sha256": "params",
        "seed": 1,
    }
    assert evaluation_module._completed_curve(curve_path, "run") == {
        "run_sha256": "run",
        "seed": 1,
    }
    assert test_evaluation_module._completed_test(test_path) == {"seeds": {}}

    with pytest.raises(ValueError, match="different parameters"):
        training_module._completed_run(run_path, "changed")
    with pytest.raises(ValueError, match="different training run"):
        evaluation_module._completed_curve(curve_path, "changed")

    write_json(run_path, ["invalid"])
    write_json(curve_path, ["invalid"])
    write_json(test_path, ["invalid"])
    with pytest.raises(TypeError, match="run evidence"):
        training_module._completed_run(run_path, "params")
    with pytest.raises(TypeError, match="curve evidence"):
        evaluation_module._completed_curve(curve_path, "run")
    with pytest.raises(TypeError, match="test evidence"):
        test_evaluation_module._completed_test(test_path)


def test_seed_options_require_a_strict_integer() -> None:
    assert SeedOptions.model_validate({"seed": 20261107}).seed == 20261107
    with pytest.raises(ValueError):
        SeedOptions.model_validate({"seed": "20261107"})
    with pytest.raises(ValueError):
        SeedOptions.model_validate({"seed": 20261107.0})


def test_double_descent_stages_declare_indirect_inputs() -> None:
    pipeline = read_yaml(PARAMS_FILE.parent.parent / "dvc.yaml")
    assert isinstance(pipeline, dict)
    stages = pipeline["stages"]
    shared_config = {
        "src/pathologize_cell_analysis/cli.py",
        "src/pathologize_cell_analysis/contracts.py",
        "src/pathologize_cell_analysis/learned_baseline/config.py",
        "params/nucls-learned.yaml",
    }
    ontology = "../../data-products/pathologize/nucleus-analysis/ontologies/source-preserving.json"
    for seed in (20261107, 20261109, 20261111):
        dependencies = set(stages[f"evaluate_nucls_double_descent_seed_{seed}"]["deps"])
        assert shared_config <= dependencies
        assert ontology in dependencies
    assert shared_config <= set(stages["analyze_nucls_double_descent"]["deps"])
    test_dependencies = set(stages["evaluate_nucls_double_descent_test"]["deps"])
    assert shared_config <= test_dependencies
    assert ontology in test_dependencies
    report_dependencies = set(stages["report_nucls_double_descent"]["deps"])
    assert shared_config <= report_dependencies
    assert {
        f"outputs/nucls-double-descent/curves/{seed}" for seed in (20261107, 20261109, 20261111)
    } <= report_dependencies


def test_curve_resource_guards_cover_every_limit() -> None:
    config = _config()
    evaluation_module._validate_evaluation_resources(config, 1.0, 1.0, 1.0, 1.0, 1)
    with pytest.raises(RuntimeError, match="GPU-time"):
        evaluation_module._validate_evaluation_resources(
            config, config.limits.per_seed_gpu_seconds, 1.0, 1.0, 1.0, 1
        )
    with pytest.raises(RuntimeError, match="wall-time"):
        evaluation_module._validate_evaluation_resources(
            config, 1.0, 1.0, config.limits.per_seed_wall_seconds, 1.0, 1
        )
    with pytest.raises(RuntimeError, match="peak VRAM"):
        evaluation_module._validate_evaluation_resources(
            config, 1.0, 1.0, 1.0, 1.0, config.limits.maximum_peak_vram_bytes + 1
        )


def test_fixed_endpoint_and_test_resource_guards() -> None:
    config = _config()
    checkpoint = {"epoch": config.training.epochs, "path": "endpoint.pt"}
    assert (
        test_evaluation_module._endpoint({"checkpoints": [checkpoint]}, 7, config.training.epochs)
        == checkpoint
    )
    with pytest.raises(ValueError, match="did not reach"):
        test_evaluation_module._endpoint({"checkpoints": []}, 7, config.training.epochs)

    test_evaluation_module._validate_test_resources(config, 1.0, 1)
    with pytest.raises(RuntimeError, match="GPU-time"):
        test_evaluation_module._validate_test_resources(
            config, config.limits.aggregate_gpu_seconds + 1, 1
        )
    with pytest.raises(RuntimeError, match="peak VRAM"):
        test_evaluation_module._validate_test_resources(
            config, 1.0, config.limits.maximum_peak_vram_bytes + 1
        )


def _trainer(training_loss: float, validation_loss: float, map50_95: float) -> Any:
    return SimpleNamespace(
        stop=False,
        loss=torch.tensor(training_loss),
        tloss=torch.tensor([training_loss]),
        metrics={"val/box_loss": validation_loss, "metrics/mAP50-95(B)": map50_95},
    )


def test_training_safety_monitors_non_finite_and_divergent_loss() -> None:
    config = _config()
    non_finite = _trainer(float("nan"), 1.0, 0.2)
    state = SafetyMonitor()
    monitor_training_batch(non_finite, state)
    assert non_finite.stop
    assert state.stop_reason == "non_finite_training_loss"

    state = SafetyMonitor()
    baseline = _trainer(1.0, 1.0, 0.2)
    monitor_training_epoch(baseline, state, config)
    for _ in range(config.safety.training_loss_epochs):
        divergent = _trainer(5.0, 1.0, 0.2)
        monitor_training_epoch(divergent, state, config)
    assert divergent.stop
    assert state.stop_reason == "persistent_training_divergence"


def test_training_safety_monitors_validation_regression_and_deadline() -> None:
    config = _config()
    state = SafetyMonitor()
    monitor_training_epoch(_trainer(1.0, 1.0, 0.5), state, config)
    for _ in range(config.safety.validation_regression_epochs):
        regressed = _trainer(1.0, 2.0, 0.4)
        monitor_training_epoch(regressed, state, config)
    assert regressed.stop
    assert state.stop_reason == "persistent_validation_regression"
    stop_at_deadline(regressed, state, 0.0)
    assert state.deadline_reached
    assert _finite_scalar(object()) is None


def test_training_state_and_resource_guards(tmp_path: Path) -> None:
    output = tmp_path / "run"
    output.mkdir()
    assert _prior_state(output) == {}
    write_json(output / "state.json", {"consumed_gpu_seconds_upper_bound": 12.0})
    assert _prior_state(output)["consumed_gpu_seconds_upper_bound"] == 12.0
    config = _config()
    _validate_resources(config, 1.0, 1)
    with pytest.raises(RuntimeError, match="GPU-time"):
        _validate_resources(config, config.limits.per_seed_gpu_seconds + 1, 1)
    with pytest.raises(RuntimeError, match="VRAM"):
        _validate_resources(config, 1.0, config.limits.maximum_peak_vram_bytes + 1)


def test_non_resumable_attempt_preserves_failed_gpu_charge(tmp_path: Path) -> None:
    output = tmp_path / "seed"
    output.mkdir()
    write_json(output / "state.json", {"consumed_gpu_seconds_upper_bound": 20.0})
    model, prior_seconds, resumed = training_module._resume_model(output, object(), object())
    assert model is None
    assert prior_seconds == 20.0
    assert resumed is False
    assert not output.exists()


def test_checkpoint_index_records_every_epoch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "seed"
    weights = output / "weights"
    weights.mkdir(parents=True)
    (output / "results.csv").write_text(
        "epoch,time,metrics/mAP50-95(B)\n1,1,0.1\n2,2,0.2\n3,3,0.3\n",
        encoding="utf-8",
    )
    for name in ("epoch0.pt", "epoch1.pt", "last.pt"):
        (weights / name).write_bytes(name.encode())
    epochs = {"epoch0.pt": 0, "epoch1.pt": 1, "last.pt": -1}
    monkeypatch.setattr(training_module, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(
        training_module,
        "checkpoint_epoch",
        lambda _torch, path: epochs[path.name],
    )
    result = checkpoint_index(output, object())
    assert [entry["epoch"] for entry in result] == [1, 2, 3]
    assert all(len(str(entry["sha256"])) == 64 for entry in result)


def _localization(error: float) -> dict[str, object]:
    matched = round((1 - error) * 100)
    return {
        "truth_points": 100,
        "predicted_points": 100,
        "matched_points": matched,
        "f1": matched / 100,
    }


def _epoch(epoch: int, train_error: float, validation_error: float) -> dict[str, Any]:
    return {
        "epoch": epoch,
        "train": {
            "task_error": train_error,
            "patient_clusters": {"patient": _localization(train_error)},
        },
        "validation": {
            "task_error": validation_error,
            "patient_clusters": {"patient": _localization(validation_error)},
        },
    }


def _analysis_config() -> DoubleDescentConfig:
    config = _config()
    return config.model_copy(
        update={
            "training": config.training.model_copy(update={"epochs": 6}),
            "analysis": config.analysis.model_copy(
                update={
                    "sustained_epochs": 2,
                    "baseline_horizon_epochs": 2,
                    "minimum_error_change": 0.1,
                    "bootstrap_replicates": 1000,
                }
            ),
        }
    )


def test_patient_bootstrap_and_pattern_analysis() -> None:
    config = _analysis_config()
    validation_errors = [0.4, 0.3, 0.5, 0.6, 0.4, 0.2]
    seed_epochs = {
        seed: [_epoch(index + 1, 0.0, error) for index, error in enumerate(validation_errors)]
        for seed in config.seeds
    }
    rows = [
        {"validation_error": error, "epoch": float(index + 1)}
        for index, error in enumerate(validation_errors)
    ]
    lower, upper = bootstrap_interval(seed_epochs, 0, "validation", config)
    assert lower == pytest.approx(0.4)
    assert upper == pytest.approx(0.4)
    result = analyze_pattern(rows, seed_epochs, config)
    assert result["observed"] is True
    assert result["conclusion"] == "epoch_wise_double_descent_observed"
    later_minimum = cast(dict[str, Any], result["later_minimum"])
    assert later_minimum["beats_first"] is True
    assert _f1(100, 100, 50) == 0.5
    assert _rolling([1.0, 2.0, 3.0], 2) == [1.5, 2.5]
    assert _interpolation_epoch([0.0, 0.0, 0.2], config) == 2


def test_pattern_analysis_accepts_failure_to_interpolate() -> None:
    config = _analysis_config()
    errors = [0.4, 0.3, 0.5, 0.6, 0.4, 0.2]
    seed_epochs = {
        seed: [_epoch(index + 1, 0.2, error) for index, error in enumerate(errors)]
        for seed in config.seeds
    }
    rows = [
        {"validation_error": error, "epoch": float(index + 1)} for index, error in enumerate(errors)
    ]
    result = analyze_pattern(rows, seed_epochs, config)
    assert result["observed"] is False
    assert result["conclusion"] == "negative_failure_to_interpolate"


def test_analysis_writes_complete_curve(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _analysis_config()
    validation_errors = [0.4, 0.3, 0.5, 0.6, 0.4, 0.2]
    curve_root = tmp_path / "curves"
    for seed in config.seeds:
        seed_root = curve_root / str(seed)
        entries = []
        for index, error in enumerate(validation_errors, start=1):
            evidence = _epoch(index, 0.0, error)
            evidence["ultralytics_validation"] = {"mAP50": 0.4, "mAP50_95": 0.2}
            path = seed_root / "epochs" / f"{index:03d}.json"
            write_json(path, evidence)
            entries.append(
                {
                    "epoch": index,
                    "path": f"epochs/{index:03d}.json",
                    "sha256": sha256_file(path),
                }
            )
        write_json(seed_root / "curve.json", {"epochs": entries})
    output = tmp_path / "outputs"
    monkeypatch.setattr(analysis_module, "load_config", lambda _path: config)
    monkeypatch.setattr(
        analysis_module,
        "seed_evaluation",
        lambda seed: curve_root / str(seed),
    )
    monkeypatch.setattr(analysis_module, "OUTPUT_ROOT", output)
    result = analysis_module.analyze("unused.yaml")
    curve = cast(dict[str, Any], result["curve"])
    pattern = cast(dict[str, Any], result["pattern"])
    assert curve["epochs"] == 6
    assert pattern["observed"] is True
    rows = (output / "analysis" / "curves.csv").read_text(encoding="utf-8").splitlines()
    assert len(rows) == 7
    assert (output / "analysis" / "evidence.json").is_file()
    first_seed_root = curve_root / str(config.seeds[0])
    curve_index = read_yaml(first_seed_root / "curve.json")
    assert isinstance(curve_index, dict)
    curve_index["epochs"][0]["sha256"] = "0" * 64
    write_json(first_seed_root / "curve.json", curve_index)
    with pytest.raises(ValueError, match="digest differs"):
        analysis_module._read_seed_epochs(config.seeds[0])


def test_cached_epoch_and_training_curve_lookup(tmp_path: Path) -> None:
    path = tmp_path / "epoch.json"
    assert _completed_epoch(path, "abc") is None
    write_json(path, {"checkpoint_sha256": "abc", "epoch": 1})
    assert _completed_epoch(path, "abc") == {"checkpoint_sha256": "abc", "epoch": 1}
    with pytest.raises(ValueError, match="different checkpoint"):
        _completed_epoch(path, "def")
    write_json(path, ["not-an-object"])
    with pytest.raises(TypeError, match="must be an object"):
        _completed_epoch(path, "abc")
    metrics = _validation_metrics(
        [
            {
                "epoch": 1.0,
                "metrics/mAP50(B)": 0.4,
                "metrics/mAP50-95(B)": 0.2,
                "train/box_loss": 1.0,
                "val/box_loss": 2.0,
            }
        ],
        1,
    )
    assert metrics == {
        "mAP50": 0.4,
        "mAP50_95": 0.2,
        "training_loss": 1.0,
        "validation_loss": 2.0,
    }


def _test_seed(f1: float) -> dict[str, Any]:
    localization = {"f1": f1}
    return {
        "pathologize": {
            "localization": localization,
            "per_class": {"tumor": {"localization": localization}},
            "site_slices": {"A1": {"localization": localization}},
        },
        "ultralytics": {"mAP50": 0.5, "mAP50_95": 0.25},
        "failures": [],
    }


def test_reporting_summary_and_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    config = _config()
    pattern = {
        "conclusion": "negative_failure_to_interpolate",
        "observed": False,
        "first_validation_minimum": {"epoch_window": [1, 3]},
        "later_peak": {"epoch_window": [50, 52]},
        "later_minimum": {"epoch_window": [118, 120]},
    }
    analysis = {
        "pattern": pattern,
        "curve": {"path": "outputs/curve.csv", "epochs": 120},
        "endpoint": {"validation_map50": 0.5, "validation_map50_95": 0.2},
        "best_validation_map50": 0.5,
        "best_validation_map50_95": 0.2,
    }
    test = {
        "selection_policy": "fixed_epoch_120_endpoint",
        "seeds": {
            str(seed): _test_seed(0.5 + index * 0.01) for index, seed in enumerate(config.seeds)
        },
        "resources": {"experiment_gpu_seconds": 100.0},
    }
    monkeypatch.setattr(reporting_module, "_curve_failure_count", lambda _seed: 0)
    monkeypatch.setattr(
        reporting_module,
        "_resources",
        lambda _config, _test: {
            "aggregate_gpu_seconds": 100.0,
            "aggregate_gpu_ceiling_seconds": 86400,
            "peak_vram_bytes": 1024**3,
        },
    )
    monkeypatch.setattr(
        reporting_module,
        "read_json",
        lambda _path: {"checkpoints": [1, 2, 3]},
    )
    monkeypatch.setattr(reporting_module, "sha256_file", lambda _path: "a" * 64)
    metrics = metric_summary(analysis, test, config)
    sealed_test = cast(dict[str, Any], metrics["sealed_test"])
    assert sealed_test["localization_f1_mean"] == pytest.approx(0.51)
    slices = _test_slices(list(test["seeds"].values()), "per_class")
    assert slices["tumor"]["localization_f1_min"] == 0.5
    markdown = _report_markdown(metrics, config)
    assert "negative_failure_to_interpolate" in markdown
    assert "fixed epoch-120 checkpoint" in markdown


def test_ultralytics_box_metric_adapter() -> None:
    observed = _box_metrics(SimpleNamespace(box=SimpleNamespace(map50=0.4, map=0.2)))
    assert observed == {"mAP50": 0.4, "mAP50_95": 0.2}
