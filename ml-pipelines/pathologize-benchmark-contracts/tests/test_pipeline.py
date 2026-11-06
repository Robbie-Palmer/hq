from __future__ import annotations

from pathlib import Path

import pytest
from data_artifacts.files import load_model, read_json, write_json
from ml_evaluation.contracts import ResourceUsage
from ml_evaluation.gates import evaluate_gates

from pathologize_benchmark_contracts import cli
from pathologize_benchmark_contracts.contracts import (
    AggregateScorecard,
    ExperimentManifest,
    FixtureManifest,
    QualityPrediction,
    Scorecard,
    Workstream,
)
from pathologize_benchmark_contracts.metrics import evaluate_predictions
from pathologize_benchmark_contracts.pipeline import (
    evaluate_experiment,
    load_experiments,
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
        scorecard.baseline.resources.accelerator_seconds == 0 for scorecard in aggregate.scorecards
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
        assert scorecard.baseline.resources.samples == 2
        assert scorecard.baseline.resources.observed_wall_seconds is None


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
    )
    with pytest.raises(ValueError, match="mask length"):
        evaluate_predictions(manifest, [item], [prediction], reproduced_root)


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


def test_cli_dispatch_and_error_codes(monkeypatch: pytest.MonkeyPatch) -> None:
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
    assert cli.main(["import-registry", "missing"]) == 2


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
                pixels_read=baseline_resources.pixels_read,
                accelerator_seconds=baseline_resources.accelerator_seconds,
                observed_wall_seconds=None,
                observed_cpu_seconds=None,
                observed_peak_rss_bytes=None,
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

    assert next(
        gate for gate in gates if gate.gate == "candidate-improvement:tile_selection_f1"
    ).passed
    assert not next(
        gate for gate in gates if gate.gate == "candidate-resource:prediction_bytes"
    ).passed
