from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from data_artifacts.files import load_model, read_json, read_jsonl, write_json
from ml_evaluation.contracts import ResourceUsage
from ml_evaluation.gates import evaluate_gates
from pydantic import ValidationError

from pathologize_benchmark_contracts import cli, pipeline
from pathologize_benchmark_contracts.contracts import (
    AggregateScorecard,
    ExperimentManifest,
    FixtureItem,
    FixtureManifest,
    QualityPrediction,
    Scorecard,
    Split,
    TilingPrediction,
    Workstream,
)
from pathologize_benchmark_contracts.metrics import evaluate_predictions
from pathologize_benchmark_contracts.pipeline import (
    evaluate_experiment,
    generate,
    load_experiments,
    run_adapters,
    validate_contracts,
    verify,
    write_schemas,
)


def test_full_pipeline_builds_typed_hill_climbable_scorecards(
    reproduced_benchmark_root: Path,
) -> None:
    aggregate = load_model(
        reproduced_benchmark_root / "outputs/scorecard/benchmark.json", AggregateScorecard
    )
    assert aggregate.benchmark_id.startswith("benchmark:sha256:")
    assert len(aggregate.scorecards) == 1
    assert {scorecard.recommendation for scorecard in aggregate.scorecards} == {"baseline_only"}
    assert all(scorecard.synthetic_evidence_only for scorecard in aggregate.scorecards)
    assert all(scorecard.clinical_validity is False for scorecard in aggregate.scorecards)
    assert all(gate.passed for scorecard in aggregate.scorecards for gate in scorecard.gates)
    assert all(
        scorecard.baseline.resources.accelerator_wall_seconds == 0
        for scorecard in aggregate.scorecards
    )

    metrics = read_json(reproduced_benchmark_root / "outputs/scorecard/metrics.json")
    experiment_id = aggregate.scorecards[0].experiment_id
    manifest = load_experiments(reproduced_benchmark_root)[0]
    assert set(metrics[experiment_id]) == {objective.metric for objective in manifest.objectives}
    primary = next(objective for objective in manifest.objectives if objective.role == "primary")
    assert primary.baseline_floor is not None
    assert metrics[experiment_id][primary.metric] >= primary.baseline_floor
    verify(reproduced_benchmark_root)


def test_scorecard_metrics_match_declared_objectives(reproduced_root: Path) -> None:
    for manifest in load_experiments(reproduced_root):
        scorecard = load_model(
            reproduced_root / f"outputs/scorecards/{manifest.experiment_id}.json",
            Scorecard,
        )
        assert {metric.metric for metric in scorecard.baseline.metrics} == {
            objective.metric for objective in manifest.objectives
        }
        assert scorecard.baseline.resources.samples == 3
        assert scorecard.baseline.resources.wall_seconds > 0
        assert scorecard.baseline.resources.cpu_seconds > 0
        assert scorecard.baseline.resources.peak_rss_bytes > 0


def test_nvml_monitor_records_current_process_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    handle = object()
    monkeypatch.setattr(pipeline, "nvmlInit", lambda: calls.append("init"))
    monkeypatch.setattr(pipeline, "nvmlShutdown", lambda: calls.append("shutdown"))
    monkeypatch.setattr(pipeline, "nvmlDeviceGetCount", lambda: 1)
    monkeypatch.setattr(pipeline, "nvmlDeviceGetHandleByIndex", lambda _index: handle)
    monkeypatch.setattr(
        pipeline,
        "nvmlDeviceGetComputeRunningProcesses",
        lambda _handle: [
            SimpleNamespace(pid=os.getpid(), usedGpuMemory=32 * 1024 * 1024),
            SimpleNamespace(pid=os.getpid() + 1, usedGpuMemory=64 * 1024 * 1024),
        ],
    )

    monitor = pipeline._NvmlProcessMonitor(poll_seconds=60)
    monitor.start()
    monitor.stop()

    assert monitor.available
    assert monitor.sampled
    assert monitor.peak_bytes == 32 * 1024 * 1024
    assert monitor.error_message is None
    assert calls == ["init", "shutdown"]


def test_nvml_monitor_maps_host_pid_from_namespace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handle = object()
    monkeypatch.setattr(pipeline.os, "getpid", lambda: 7)
    monkeypatch.setattr(
        pipeline.Path,
        "read_text",
        lambda _path, **_kwargs: "Name:\tpython\nNSpid:\t100 7\n",
    )
    monkeypatch.setattr(pipeline, "nvmlInit", lambda: None)
    monkeypatch.setattr(pipeline, "nvmlShutdown", lambda: None)
    monkeypatch.setattr(pipeline, "nvmlDeviceGetCount", lambda: 1)
    monkeypatch.setattr(pipeline, "nvmlDeviceGetHandleByIndex", lambda _index: handle)
    monkeypatch.setattr(
        pipeline,
        "nvmlDeviceGetComputeRunningProcesses",
        lambda _handle: [SimpleNamespace(pid=100, usedGpuMemory=16 * 1024 * 1024)],
    )

    monitor = pipeline._NvmlProcessMonitor(poll_seconds=60)
    monitor.start()
    monitor.stop()

    assert monitor.process_ids == {7, 100}
    assert monitor.peak_bytes == 16 * 1024 * 1024


def test_nvml_monitor_attributes_new_host_pid_to_isolated_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handle = object()
    samples = iter(
        [
            [],
            [SimpleNamespace(pid=9001, usedGpuMemory=24 * 1024 * 1024)],
        ]
    )
    monkeypatch.setattr(pipeline, "nvmlInit", lambda: None)
    monkeypatch.setattr(pipeline, "nvmlShutdown", lambda: None)
    monkeypatch.setattr(pipeline, "nvmlDeviceGetCount", lambda: 1)
    monkeypatch.setattr(pipeline, "nvmlDeviceGetHandleByIndex", lambda _index: handle)
    monkeypatch.setattr(
        pipeline,
        "nvmlDeviceGetComputeRunningProcesses",
        lambda _handle: next(samples),
    )

    monitor = pipeline._NvmlProcessMonitor(poll_seconds=60)
    monitor.start()
    monitor.stop()

    assert monitor.baseline_pids == set()
    assert monitor.attributed
    assert monitor.peak_bytes == 24 * 1024 * 1024


class _MonitorStub:
    def __init__(
        self,
        *,
        available: bool = True,
        sampled: bool = True,
        peak_bytes: int = 0,
        error_message: str | None = None,
        attributed: bool = True,
    ) -> None:
        self.available = available
        self.sampled = sampled
        self.peak_bytes = peak_bytes
        self.error_message = error_message
        self.attributed = attributed

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass


def _quality_run_inputs(root: Path) -> tuple[ExperimentManifest, FixtureManifest]:
    generate(root)
    return (
        load_model(root / "experiments/whole-slide-quality.json", ExperimentManifest),
        load_model(root / "data/synthetic/manifest.json", FixtureManifest),
    )


def test_changed_repeated_predictions_write_failure(
    configured_root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest, fixture = _quality_run_inputs(configured_root)
    items = [item for item in fixture.items if item.split == Split.TEST]
    delegate = pipeline.load_adapter(manifest.baseline, configured_root)

    class ChangingAdapter:
        adapter_id = delegate.adapter_id
        adapter_version = delegate.adapter_version

        def __init__(self) -> None:
            self.calls = 0

        def predict(
            self, run_manifest: ExperimentManifest, item: FixtureItem, root: Path
        ) -> QualityPrediction:
            prediction = delegate.predict(run_manifest, item, root)
            assert isinstance(prediction, QualityPrediction)
            self.calls += 1
            if self.calls <= len(items):
                return prediction
            labels = list(prediction.tissue_labels)
            labels[0] = 1 - labels[0]
            return prediction.model_copy(update={"tissue_labels": labels})

    monkeypatch.setattr(pipeline, "load_adapter", lambda _spec, _root: ChangingAdapter())
    monkeypatch.setattr(pipeline, "_NvmlProcessMonitor", _MonitorStub)

    with pytest.raises(ValueError, match="predictions changed"):
        pipeline._run_adapter(configured_root, manifest, manifest.baseline, items)

    failures = read_json(
        configured_root
        / "outputs/runs/whole-slide-quality-contract-v1/deterministic-color-v1/failures.json"
    )
    assert failures == [
        {
            "error_type": "NonDeterministicPredictions",
            "item_id": "evaluation-cohort",
            "message": "adapter predictions changed after resetting the experiment seed",
        }
    ]


@pytest.mark.parametrize(
    ("execution_device", "monitor", "error_type"),
    [
        ("cpu", _MonitorStub(peak_bytes=1), "UndeclaredAcceleratorUse"),
        (
            "accelerator",
            _MonitorStub(available=False, sampled=False, error_message="unavailable"),
            "AcceleratorTelemetryUnavailable",
        ),
        (
            "accelerator",
            _MonitorStub(sampled=False, error_message="sampling failed"),
            "AcceleratorTelemetryFailed",
        ),
        (
            "accelerator",
            _MonitorStub(attributed=False),
            "AcceleratorTelemetryFailed",
        ),
    ],
)
def test_accelerator_guardrails_write_failures(
    configured_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    execution_device: str,
    monitor: _MonitorStub,
    error_type: str,
) -> None:
    manifest, fixture = _quality_run_inputs(configured_root)
    items = [item for item in fixture.items if item.split == Split.TEST]
    adapter = pipeline.load_adapter(manifest.baseline, configured_root)
    spec = manifest.baseline.model_copy(update={"execution_device": execution_device})
    monkeypatch.setattr(pipeline, "load_adapter", lambda _spec, _root: adapter)
    monkeypatch.setattr(pipeline, "_NvmlProcessMonitor", lambda: monitor)

    with pytest.raises(ValueError):
        pipeline._run_adapter(configured_root, manifest, spec, items)

    failures = read_json(
        configured_root
        / f"outputs/runs/{manifest.experiment_id}/{spec.adapter_id}/failures.json"
    )
    assert failures[0]["error_type"] == error_type


def test_prediction_count_mismatch_fails_closed(reproduced_root: Path) -> None:
    manifest = load_model(
        reproduced_root / "experiments/whole-slide-quality.json", ExperimentManifest
    )
    fixture = load_model(reproduced_root / "data/synthetic/manifest.json", FixtureManifest)
    with pytest.raises(ValueError, match="prediction count"):
        evaluate_predictions(manifest, [fixture.items[0]], [], reproduced_root)


def test_quality_mask_length_mismatch_fails_closed(reproduced_root: Path) -> None:
    manifest = load_model(
        reproduced_root / "experiments/whole-slide-quality.json", ExperimentManifest
    )
    fixture = read_json(reproduced_root / "data/synthetic/manifest.json")
    item_value = next(item for item in fixture["items"] if item["split"] == "test")
    from pathologize_benchmark_contracts.contracts import FixtureItem

    item = FixtureItem.model_validate(item_value)
    prediction = QualityPrediction(
        workstream=Workstream.SLIDE_QUALITY,
        item_id=item.item_id,
        width=item.width,
        height=item.height,
        tissue_labels=[1],
        artifact_labels=[0],
        reject_slide=False,
        reject_probability=0,
    )
    with pytest.raises(ValueError, match="mask length"):
        evaluate_predictions(manifest, [item], [prediction], reproduced_root)


def test_slide_rejection_fixture_contains_a_negative_case(reproduced_root: Path) -> None:
    manifest = load_model(
        reproduced_root / "experiments/whole-slide-quality.json", ExperimentManifest
    )
    fixture = load_model(reproduced_root / "data/synthetic/manifest.json", FixtureManifest)
    items = [item for item in fixture.items if item.split == Split.TEST]
    prediction_path = (
        reproduced_root
        / "outputs/runs/whole-slide-quality-contract-v1"
        / "deterministic-color-v1/predictions.jsonl"
    )
    predictions = [QualityPrediction.model_validate(value) for value in read_jsonl(prediction_path)]
    always_reject = [
        prediction.model_copy(update={"reject_slide": True, "reject_probability": 1.0})
        for prediction in predictions
    ]

    assert {item.variant for item in items} == {"clean", "fold_like", "mark_like"}
    assert (
        evaluate_predictions(manifest, items, always_reject, reproduced_root)[
            "slide_rejection_accuracy"
        ]
        < 1
    )


def test_tiling_scale_error_uses_item_metadata(reproduced_tiling_root: Path) -> None:
    manifest = load_model(
        reproduced_tiling_root / "experiments/tiling-magnification.json", ExperimentManifest
    )
    fixture = load_model(reproduced_tiling_root / "data/synthetic/manifest.json", FixtureManifest)
    items = [
        item.model_copy(update={"microns_per_pixel_x": 1.0, "microns_per_pixel_y": 1.0})
        for item in fixture.items
        if item.split == Split.TEST
    ]
    prediction_path = (
        reproduced_tiling_root
        / "outputs/runs/tiling-magnification-contract-v1"
        / "deterministic-color-v1/predictions.jsonl"
    )
    predictions = [TilingPrediction.model_validate(value) for value in read_jsonl(prediction_path)]

    assert (
        evaluate_predictions(manifest, items, predictions, reproduced_tiling_root)[
            "magnification_relative_error"
        ]
        == 0.5
    )


def test_adapter_failure_writes_machine_readable_context(configured_root: Path) -> None:
    generate(configured_root)
    fixture = load_model(configured_root / "data/synthetic/manifest.json", FixtureManifest)
    test_item = next(item for item in fixture.items if item.split == Split.TEST)
    (configured_root / test_item.image_path).write_text("not a PNM", encoding="ascii")

    with pytest.raises(ValueError, match="unsupported PNM"):
        run_adapters(configured_root)

    failures = read_json(
        configured_root
        / "outputs/runs/whole-slide-quality-contract-v1/deterministic-color-v1/failures.json"
    )
    assert failures[0]["item_id"] == test_item.item_id
    assert failures[0]["error_type"] == "ValueError"


def test_evaluation_rejects_recorded_adapter_failures(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    failure_path = (
        reproduced_root
        / f"outputs/runs/{manifest.experiment_id}/{manifest.baseline.adapter_id}/failures.json"
    )
    write_json(
        failure_path,
        [
            {
                "item_id": "evaluation-cohort",
                "error_type": "SyntheticFailure",
                "message": "stale predictions must not be scored",
            }
        ],
    )

    with pytest.raises(ValueError, match="recorded failure"):
        evaluate_experiment(manifest.experiment_id, reproduced_root)


def test_verify_detects_scorecard_tampering(reproduced_root: Path) -> None:
    path = reproduced_root / "outputs/scorecard/benchmark.json"
    value = read_json(path)
    value["scorecards"][0]["baseline"]["metrics"][0]["value"] = 0.0
    write_json(path, value)
    with pytest.raises(ValueError, match="scorecard ID mismatch"):
        verify(reproduced_root)


def test_schema_drift_check_fails_closed(configured_root: Path) -> None:
    write_schemas(root=configured_root)
    path = configured_root / "schemas/scorecard.schema.json"
    write_json(path, {})
    with pytest.raises(ValueError, match="JSON Schema drift"):
        write_schemas(check=True, root=configured_root)


def test_contract_report_has_no_raw_data_copy(reproduced_root: Path) -> None:
    report = validate_contracts(reproduced_root, write_report=False)
    assert report["raw_data_copied"] is False
    assert report["clinical_validity"] is False
    assert {entry["kind"] for entry in report["experiments"]} == {"synthetic_fixture"}


def test_unknown_experiment_and_wrong_registry_import_fail(configured_root: Path) -> None:
    from pathologize_benchmark_contracts.pipeline import import_registry

    with pytest.raises(ValueError, match="unknown experiment"):
        evaluate_experiment("missing", configured_root)
    with pytest.raises(ValueError, match="unknown experiment"):
        import_registry("missing", configured_root)
    with pytest.raises(TypeError, match="registry import"):
        import_registry("whole-slide-quality-contract-v1", configured_root)


def test_params_yaml_accepts_comments(configured_root: Path) -> None:
    path = configured_root / "params.yaml"
    path.write_text("# benchmark configuration\n" + path.read_text(encoding="utf-8"))
    assert load_experiments(configured_root)[0].experiment_id == "whole-slide-quality-contract-v1"


def test_cli_dispatch_and_error_codes(
    monkeypatch: pytest.MonkeyPatch,
    configured_root: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(cli, "verify", lambda: calls.append("verify"))
    monkeypatch.setattr(
        cli,
        "write_schemas",
        lambda *, check: calls.append(f"schemas:{check}"),
    )

    assert cli.main(["verify"]) == 0
    assert cli.main(["schemas", "--check"]) == 0
    assert calls == ["verify", "schemas:True"]
    monkeypatch.chdir(configured_root)
    assert cli.main(["import-registry", "missing"]) == 2
    assert "unknown experiment: missing" in capsys.readouterr().out


def test_scorecard_rejects_mislabelled_synthetic_evidence(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    value = read_json(reproduced_root / f"outputs/scorecards/{manifest.experiment_id}.json")
    value["synthetic_evidence_only"] = False
    with pytest.raises(ValidationError, match="synthetic evidence only"):
        Scorecard.model_validate(value)


def test_dvc_dag_keeps_workstreams_independent(configured_root: Path) -> None:
    dag = (configured_root / "dvc.yaml").read_text(encoding="utf-8")
    assert "evaluate_slide_quality" in dag
    assert "evaluate_tiling_magnification" not in dag
    assert "evaluate_cell_analysis" not in dag
    assert "write_scorecard" in dag
    assert "outputs/scorecard/metrics.json" in dag


def test_re_evaluation_is_content_stable(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    path = reproduced_root / f"outputs/scorecards/{manifest.experiment_id}.json"
    before = path.read_bytes()
    evaluate_experiment(manifest.experiment_id, reproduced_root)
    assert path.read_bytes() == before


def test_candidate_must_improve_without_breaking_resource_budget(
    reproduced_tiling_root: Path,
) -> None:
    manifest = load_experiments(reproduced_tiling_root)[0]
    scorecard = load_model(
        reproduced_tiling_root / f"outputs/scorecards/{manifest.experiment_id}.json",
        Scorecard,
    )
    candidate_adapter = manifest.baseline.model_copy(update={"adapter_id": "candidate-adapter-v1"})
    baseline_resources = scorecard.baseline.resources
    candidate = scorecard.baseline.model_copy(
        update={
            "adapter": candidate_adapter,
            "resources": ResourceUsage(
                samples=baseline_resources.samples,
                input_bytes=baseline_resources.input_bytes,
                prediction_bytes=manifest.resource_budget.max_prediction_bytes + 1,
                input_pixels=baseline_resources.input_pixels,
                wall_seconds=baseline_resources.wall_seconds,
                cpu_seconds=baseline_resources.cpu_seconds,
                peak_rss_bytes=baseline_resources.peak_rss_bytes,
                accelerator_wall_seconds=baseline_resources.accelerator_wall_seconds,
                peak_accelerator_memory_bytes=(baseline_resources.peak_accelerator_memory_bytes),
            ),
        }
    )
    candidate_manifest = manifest.model_copy(update={"candidate": candidate_adapter})
    gates = evaluate_gates(
        candidate_manifest.objectives,
        candidate_manifest.resource_budget,
        scorecard.baseline,
        candidate,
    )

    assert not next(
        gate for gate in gates if gate.gate == "candidate-improvement:tile_selection_f1"
    ).passed
    assert not next(
        gate for gate in gates if gate.gate == "candidate-resource:prediction_bytes"
    ).passed
