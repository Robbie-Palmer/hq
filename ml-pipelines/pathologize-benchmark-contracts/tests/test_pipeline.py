from __future__ import annotations

from pathlib import Path

import pytest
from data_artifacts.files import (
    load_model,
    read_json,
    read_jsonl,
    read_yaml,
    resolve_under,
    write_json,
)
from ml_evaluation.contracts import FailureReport, ResourceUsage, RunRecord
from ml_evaluation.gates import evaluate_gates
from pydantic import ValidationError

from pathologize_benchmark_contracts import cli, pipeline
from pathologize_benchmark_contracts.contracts import (
    BenchmarkIndex,
    ComparisonScorecard,
    EvaluationResult,
    ExperimentManifest,
    FixtureItem,
    FixtureManifest,
    QualityPrediction,
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
    index = load_model(reproduced_benchmark_root / "outputs/benchmark/index.json", BenchmarkIndex)
    assert index.benchmark_id.startswith("benchmark:sha256:")
    assert len(index.scorecards) == 1
    reference = index.scorecards[0]
    scorecard = load_model(
        resolve_under(reproduced_benchmark_root, reference.artifact.path), ComparisonScorecard
    )
    assert scorecard.recommendation == "baseline_only"
    assert scorecard.synthetic_evidence_only
    assert scorecard.clinical_validity is False
    assert all(gate.passed for gate in scorecard.gates)

    manifest = load_experiments(reproduced_benchmark_root)[0]
    run = load_model(
        reproduced_benchmark_root
        / f"outputs/runs/{manifest.experiment_id}/{manifest.baseline.adapter_id}/run-record.json",
        RunRecord,
    )
    resources = load_model(
        resolve_under(reproduced_benchmark_root, run.resources.path), ResourceUsage
    )
    assert resources.accelerator_seconds == 0
    metrics = read_json(
        reproduced_benchmark_root / f"outputs/evaluations/{manifest.experiment_id}/metrics.json"
    )
    baseline_metrics = metrics[manifest.baseline.adapter_id]
    assert set(baseline_metrics) == {objective.metric for objective in manifest.objectives}
    primary = next(objective for objective in manifest.objectives if objective.role == "primary")
    assert primary.baseline_floor is not None
    assert baseline_metrics[primary.metric] >= primary.baseline_floor
    verify(reproduced_benchmark_root)


def test_evaluations_and_runs_keep_separate_evidence(reproduced_root: Path) -> None:
    for manifest in load_experiments(reproduced_root):
        evaluation = load_model(
            reproduced_root
            / f"outputs/evaluations/{manifest.experiment_id}/{manifest.baseline.adapter_id}.json",
            EvaluationResult,
        )
        run = load_model(
            reproduced_root
            / "outputs/runs"
            / manifest.experiment_id
            / manifest.baseline.adapter_id
            / "run-record.json",
            RunRecord,
        )
        resources = load_model(resolve_under(reproduced_root, run.resources.path), ResourceUsage)
        assert {metric.metric for metric in evaluation.metrics} == {
            objective.metric for objective in manifest.objectives
        }
        assert evaluation.predictions == run.predictions
        assert resources.samples == 3
        assert resources.pixels_read > 0
        assert resources.accelerator_seconds == 0
        assert resources.observed_wall_seconds is None
        assert resources.observed_cpu_seconds is None
        assert resources.observed_peak_rss_bytes is None


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

    with pytest.raises(ValueError, match="predictions changed"):
        pipeline._run_adapter(configured_root, manifest, manifest.baseline, items)

    failures = read_json(
        configured_root
        / "outputs/runs/whole-slide-quality-contract-v1/deterministic-color-v1/failures.json"
    )
    assert failures == {
        "schema_version": "1.0.0",
        "failures": [
            {
                "error_type": "NonDeterministicPredictions",
                "item_id": "evaluation-cohort",
                "message": "adapter predictions changed after resetting the experiment seed",
            }
        ],
    }


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
    assert failures["failures"][0]["item_id"] == test_item.item_id
    assert failures["failures"][0]["error_type"] == "ValueError"


def test_evaluation_rejects_recorded_adapter_failures(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    failure_path = (
        reproduced_root
        / f"outputs/runs/{manifest.experiment_id}/{manifest.baseline.adapter_id}/failures.json"
    )
    write_json(
        failure_path,
        FailureReport(
            schema_version="1.0.0",
            failures=[
                {
                    "item_id": "evaluation-cohort",
                    "error_type": "SyntheticFailure",
                    "message": "stale predictions must not be scored",
                }
            ],
        ),
    )

    with pytest.raises(ValueError, match="recorded failure"):
        evaluate_experiment(manifest.experiment_id, reproduced_root)


def test_verify_detects_scorecard_tampering(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    path = reproduced_root / f"outputs/scorecards/{manifest.experiment_id}.json"
    value = read_json(path)
    value["recommendation"] = "reject_candidate"
    write_json(path, value)
    with pytest.raises(ValueError, match="artifact SHA-256 mismatch"):
        verify(reproduced_root)


def test_schema_drift_check_fails_closed(configured_root: Path) -> None:
    write_schemas(root=configured_root)
    path = configured_root / "schemas/comparison-scorecard.schema.json"
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
        ComparisonScorecard.model_validate(value)


def test_dvc_dag_keeps_workstreams_independent(configured_root: Path) -> None:
    dag = (configured_root / "dvc.yaml").read_text(encoding="utf-8")
    assert "evaluate_slide_quality" in dag
    assert "evaluate_tiling_magnification" not in dag
    assert "evaluate_cell_analysis" not in dag
    assert "compare_slide_quality" in dag
    assert "write_benchmark_index" in dag
    assert "outputs/evaluations/whole-slide-quality-contract-v1/metrics.json" in dag


def test_dvc_dag_tracks_artifact_boundaries(configured_root: Path) -> None:
    stages = read_yaml(configured_root / "dvc.yaml")["stages"]
    evaluation_dependencies = stages["evaluate_slide_quality"]["deps"]
    assert any(path.endswith("predictions.jsonl") for path in evaluation_dependencies)
    assert any(path.endswith("failures.json") for path in evaluation_dependencies)
    assert not any(path.endswith("resources.json") for path in evaluation_dependencies)
    assert not any(path.endswith("run-record.json") for path in evaluation_dependencies)

    comparison_dependencies = stages["compare_slide_quality"]["deps"]
    assert any(path.endswith("deterministic-color-v1.json") for path in comparison_dependencies)
    assert any(path.endswith("run-record.json") for path in comparison_dependencies)

    index_dependencies = stages["write_benchmark_index"]["deps"]
    assert any(path.startswith("outputs/scorecards/") for path in index_dependencies)
    assert not any(path.startswith("outputs/runs/") for path in index_dependencies)
    assert not any(path.startswith("outputs/evaluations/") for path in index_dependencies)


def test_re_evaluation_is_content_stable(reproduced_root: Path) -> None:
    manifest = load_experiments(reproduced_root)[0]
    path = (
        reproduced_root
        / f"outputs/evaluations/{manifest.experiment_id}/{manifest.baseline.adapter_id}.json"
    )
    before = path.read_bytes()
    evaluate_experiment(manifest.experiment_id, reproduced_root)
    assert path.read_bytes() == before


def test_candidate_must_improve_without_breaking_resource_budget(
    reproduced_tiling_root: Path,
) -> None:
    manifest = load_experiments(reproduced_tiling_root)[0]
    evaluation = load_model(
        reproduced_tiling_root
        / f"outputs/evaluations/{manifest.experiment_id}/{manifest.baseline.adapter_id}.json",
        EvaluationResult,
    )
    run = load_model(
        reproduced_tiling_root
        / f"outputs/runs/{manifest.experiment_id}/{manifest.baseline.adapter_id}/run-record.json",
        RunRecord,
    )
    baseline_resources = load_model(
        resolve_under(reproduced_tiling_root, run.resources.path), ResourceUsage
    )
    candidate_resources = baseline_resources.model_copy(
        update={
            "prediction_bytes": manifest.resource_budget.max_prediction_bytes + 1,
        }
    )
    gates = evaluate_gates(
        manifest.objectives,
        manifest.resource_budget,
        evaluation.metrics,
        baseline_resources,
        evaluation.metrics,
        candidate_resources,
    )

    assert not next(
        gate for gate in gates if gate.gate == "candidate-improvement:tile_selection_f1"
    ).passed
    assert not next(
        gate for gate in gates if gate.gate == "candidate-resource:prediction_bytes"
    ).passed
