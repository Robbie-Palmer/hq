from __future__ import annotations

import random
from pathlib import Path
from typing import Any

from data_artifacts.files import (
    canonical_bytes,
    content_address,
    load_model,
    read_json,
    read_jsonl,
    read_yaml,
    resolve_under,
    sha256_file,
    write_json,
    write_jsonl,
)
from data_artifacts.schemas import write_schemas as write_schema_artifacts
from ml_evaluation.contracts import (
    AdapterSpec,
    ArtifactReference,
    FailureReport,
    MetricResult,
    ResourceUsage,
    RunFailure,
    RunRecord,
)
from ml_evaluation.gates import evaluate_gates, recommendation
from pydantic import BaseModel

from .adapters import load_adapter, reported_accelerator_seconds
from .artifacts import contract_root, project_root
from .contracts import (
    SCHEMA_MODELS,
    BenchmarkIndex,
    BenchmarkProject,
    ComparisonInput,
    ComparisonScorecard,
    EvaluationResult,
    ExperimentManifest,
    FixtureItem,
    FixtureManifest,
    LeakageUnit,
    NucleiPrediction,
    QualityPrediction,
    RegistryExport,
    RegistrySource,
    ScorecardReference,
    Split,
    SyntheticSource,
    TilingPrediction,
    Workstream,
)
from .metrics import evaluate_predictions
from .synthetic import generate_fixtures


def _configuration(root: Path) -> BenchmarkProject:
    return BenchmarkProject.model_validate(read_yaml(root / "params.yaml"))


def experiment_paths(root: Path) -> list[Path]:
    return [resolve_under(root, item) for item in _configuration(root).experiments]


def load_experiments(root: Path) -> list[ExperimentManifest]:
    configuration = _configuration(root)
    manifests = [load_model(path, ExperimentManifest) for path in experiment_paths(root)]
    ids = [manifest.experiment_id for manifest in manifests]
    if len(ids) != len(set(ids)):
        raise ValueError("experiment IDs must be unique")
    if any(manifest.workstream != configuration.workstream for manifest in manifests):
        raise ValueError("every experiment must match the benchmark project's workstream")
    return manifests


def _leakage_values(item: FixtureItem, unit: LeakageUnit) -> str:
    return str(getattr(item.leakage, unit.value))


def validate_leakage(items: list[FixtureItem], units: list[LeakageUnit]) -> None:
    for unit in units:
        seen: dict[str, Split] = {}
        for item in items:
            value = _leakage_values(item, unit)
            previous = seen.setdefault(value, item.split)
            if previous != item.split:
                raise ValueError(
                    f"leakage unit {unit.value}={value} appears in {previous} and {item.split}"
                )


def _load_fixture_source(root: Path, source: SyntheticSource) -> FixtureManifest:
    manifest = load_model(resolve_under(root, source.fixture_manifest), FixtureManifest)
    if manifest.dataset_id != source.dataset_id:
        raise ValueError("fixture dataset ID differs from the experiment source")
    return manifest


def _load_registry_source(root: Path, source: RegistrySource) -> RegistryExport:
    path = resolve_under(root, source.export_manifest)
    if sha256_file(path) != source.export_sha256:
        raise ValueError("registry export SHA-256 differs from the pinned experiment source")
    export = load_model(path, RegistryExport)
    if export.contract != source.contract:
        raise ValueError("registry export contract differs from the experiment source")
    if export.registry_revision != source.revision:
        raise ValueError("registry revision differs from the pinned experiment source")
    return export


def validate_contracts(root: Path | None = None, *, write_report: bool = True) -> dict[str, Any]:
    root = root or project_root()
    manifests = load_experiments(root)
    sources: list[dict[str, Any]] = []
    for manifest in manifests:
        if isinstance(manifest.data_source, SyntheticSource):
            fixture = _load_fixture_source(root, manifest.data_source)
            validate_leakage(fixture.items, manifest.split_policy.leakage_units)
            sources.append(
                {
                    "experiment_id": manifest.experiment_id,
                    "kind": manifest.data_source.kind,
                    "items": len(fixture.items),
                    "clinical_validity": fixture.clinical_validity,
                }
            )
        else:
            export = _load_registry_source(root, manifest.data_source)
            sources.append(
                {
                    "experiment_id": manifest.experiment_id,
                    "kind": manifest.data_source.kind,
                    "registry_revision": export.registry_revision,
                    "croissant_conforms_to": export.conforms_to,
                }
            )
    report = {
        "schema_version": "1.0.0",
        "experiments": sources,
        "raw_data_copied": False,
        "clinical_validity": False,
    }
    if write_report:
        write_json(root / "outputs/contracts/validation.json", report)
    return report


def import_registry(experiment_id: str, root: Path | None = None) -> None:
    root = root or project_root()
    manifest = next(
        (item for item in load_experiments(root) if item.experiment_id == experiment_id), None
    )
    if manifest is None:
        raise ValueError(f"unknown experiment: {experiment_id}")
    if not isinstance(manifest.data_source, RegistrySource):
        raise TypeError("registry import requires a pathologize_registry data source")
    export = _load_registry_source(root, manifest.data_source)
    output = {
        "contract": export.contract,
        "registry_uri": manifest.data_source.registry_uri,
        "registry_revision": export.registry_revision,
        "export_sha256": manifest.data_source.export_sha256,
        "raw_data_copied": False,
        "croissant_conforms_to": export.conforms_to,
        "dataset_name": export.name,
    }
    write_json(root / f"data/imported/{experiment_id}/registry-index.json", output)


def _evaluation_items(root: Path, manifest: ExperimentManifest) -> list[FixtureItem]:
    if not isinstance(manifest.data_source, SyntheticSource):
        raise TypeError("the built-in runner only consumes synthetic fixtures")
    fixture = _load_fixture_source(root, manifest.data_source)
    return [item for item in fixture.items if item.split == manifest.split_policy.evaluation_split]


def _run_directory(root: Path, experiment_id: str, adapter_id: str) -> Path:
    return root / "outputs/runs" / experiment_id / adapter_id


def _artifact_reference(root: Path, path: Path) -> ArtifactReference:
    return ArtifactReference(
        path=path.relative_to(root).as_posix(),
        sha256=sha256_file(path),
    )


def _validated_artifact(root: Path, reference: ArtifactReference) -> Path:
    path = resolve_under(root, reference.path)
    if sha256_file(path) != reference.sha256:
        raise ValueError(f"artifact SHA-256 mismatch for {reference.path}")
    return path


def _run_adapter(
    root: Path,
    manifest: ExperimentManifest,
    adapter_spec: AdapterSpec,
    items: list[FixtureItem],
) -> None:
    output = _run_directory(root, manifest.experiment_id, adapter_spec.adapter_id)
    failures: list[RunFailure] = []

    def write_failures(values: list[RunFailure]) -> None:
        write_json(
            output / "failures.json",
            FailureReport(schema_version="1.0.0", failures=values),
        )

    def predict() -> list[QualityPrediction | TilingPrediction | NucleiPrediction]:
        predictions: list[QualityPrediction | TilingPrediction | NucleiPrediction] = []
        random.seed(manifest.random_seed)
        for item in items:
            try:
                predictions.append(adapter.predict(manifest, item, root))
            except Exception as error:
                failures.append(
                    RunFailure(
                        item_id=item.item_id,
                        error_type=type(error).__name__,
                        message=str(error),
                    )
                )
                write_failures(failures)
                raise
        return predictions

    try:
        adapter = load_adapter(adapter_spec, root)
    except Exception as error:
        failure = RunFailure(
            item_id="evaluation-cohort",
            error_type=type(error).__name__,
            message=str(error),
        )
        write_failures([failure])
        raise
    predictions = predict()
    repeated_predictions = predict()
    serialized = [prediction.model_dump(mode="json") for prediction in predictions]
    repeated_serialized = [
        prediction.model_dump(mode="json") for prediction in repeated_predictions
    ]
    if canonical_bytes(serialized) != canonical_bytes(repeated_serialized):
        failure = RunFailure(
            item_id="evaluation-cohort",
            error_type="NonDeterministicPredictions",
            message="adapter predictions changed after resetting the experiment seed",
        )
        write_failures([failure])
        raise ValueError(failure.message)

    prediction_path = output / "predictions.jsonl"
    prediction_bytes = write_jsonl(prediction_path, predictions)
    write_failures(failures)
    input_paths = [resolve_under(root, item.image_path) for item in items]
    try:
        accelerator_seconds = reported_accelerator_seconds(adapter)
    except Exception as error:
        failure = RunFailure(
            item_id="evaluation-cohort",
            error_type=type(error).__name__,
            message=str(error),
        )
        write_failures([failure])
        raise
    resources = ResourceUsage(
        samples=len(items),
        input_bytes=sum(path.stat().st_size for path in input_paths),
        prediction_bytes=prediction_bytes,
        pixels_read=sum(item.width * item.height for item in items),
        accelerator_seconds=accelerator_seconds,
        observed_wall_seconds=None,
        observed_cpu_seconds=None,
        observed_peak_rss_bytes=None,
    )
    resources_path = output / "resources.json"
    failures_path = output / "failures.json"
    write_json(resources_path, resources)
    body = {
        "schema_version": "1.0.0",
        "experiment_id": manifest.experiment_id,
        "adapter": adapter_spec.model_dump(mode="json"),
        "predictions": _artifact_reference(root, prediction_path).model_dump(mode="json"),
        "resources": _artifact_reference(root, resources_path).model_dump(mode="json"),
        "failure_report": _artifact_reference(root, failures_path).model_dump(mode="json"),
    }
    record = RunRecord(run_id=content_address("run", body), **body)
    write_json(output / "run-record.json", record)


def run_adapters(root: Path | None = None) -> None:
    root = root or project_root()
    for manifest in load_experiments(root):
        items = _evaluation_items(root, manifest)
        _run_adapter(root, manifest, manifest.baseline, items)
        if manifest.candidate is not None:
            _run_adapter(root, manifest, manifest.candidate, items)


def _prediction_type(workstream: Workstream) -> type[BaseModel]:
    if workstream == Workstream.SLIDE_QUALITY:
        return QualityPrediction
    if workstream == Workstream.TILING_POLICY:
        return TilingPrediction
    return NucleiPrediction


def _experiment_manifest_path(root: Path, experiment_id: str) -> Path:
    for path in experiment_paths(root):
        if read_json(path).get("experiment_id") == experiment_id:
            return path
    raise ValueError(f"unknown experiment: {experiment_id}")


def _data_manifest_path(root: Path, manifest: ExperimentManifest) -> Path:
    if isinstance(manifest.data_source, SyntheticSource):
        return resolve_under(root, manifest.data_source.fixture_manifest)
    return resolve_under(root, manifest.data_source.export_manifest)


def _evaluation_path(root: Path, experiment_id: str, adapter_id: str) -> Path:
    return root / "outputs/evaluations" / experiment_id / f"{adapter_id}.json"


def _evaluate_adapter(
    root: Path,
    manifest: ExperimentManifest,
    spec: AdapterSpec,
    items: list[FixtureItem],
) -> EvaluationResult:
    directory = _run_directory(root, manifest.experiment_id, spec.adapter_id)
    failure_report = load_model(directory / "failures.json", FailureReport)
    if failure_report.failures:
        raise ValueError(f"adapter run contains {len(failure_report.failures)} recorded failure(s)")
    prediction_type = _prediction_type(manifest.workstream)
    prediction_path = directory / "predictions.jsonl"
    predictions = [prediction_type.model_validate(value) for value in read_jsonl(prediction_path)]
    typed_predictions = [
        prediction
        for prediction in predictions
        if isinstance(prediction, (QualityPrediction, TilingPrediction, NucleiPrediction))
    ]
    measured = evaluate_predictions(manifest, items, typed_predictions, root)
    objectives = {objective.metric: objective for objective in manifest.objectives}
    if set(measured) != set(objectives):
        raise ValueError(f"metric contract differs from evaluator for {manifest.experiment_id}")
    metrics = [
        MetricResult(
            metric=name,
            value=value,
            unit=objectives[name].unit,
            role=objectives[name].role,
            direction=objectives[name].direction,
        )
        for name, value in sorted(measured.items())
    ]
    body = {
        "schema_version": "1.0.0",
        "experiment_id": manifest.experiment_id,
        "workstream": manifest.workstream,
        "adapter_id": spec.adapter_id,
        "adapter_version": spec.version,
        "data_source_kind": manifest.data_source.kind,
        "experiment_manifest": _artifact_reference(
            root, _experiment_manifest_path(root, manifest.experiment_id)
        ).model_dump(mode="json"),
        "data_manifest": _artifact_reference(root, _data_manifest_path(root, manifest)).model_dump(
            mode="json"
        ),
        "predictions": _artifact_reference(root, prediction_path).model_dump(mode="json"),
        "metrics": [metric.model_dump(mode="json") for metric in metrics],
        "clinical_validity": False,
    }
    return EvaluationResult(evaluation_id=content_address("evaluation", body), **body)


def evaluate_experiment(experiment_id: str, root: Path | None = None) -> list[EvaluationResult]:
    root = root or project_root()
    manifest = next(
        (item for item in load_experiments(root) if item.experiment_id == experiment_id), None
    )
    if manifest is None:
        raise ValueError(f"unknown experiment: {experiment_id}")
    items = _evaluation_items(root, manifest)
    specs = [manifest.baseline]
    if manifest.candidate is not None:
        specs.append(manifest.candidate)
    evaluations = [_evaluate_adapter(root, manifest, spec, items) for spec in specs]
    for evaluation in evaluations:
        write_json(
            _evaluation_path(root, experiment_id, evaluation.adapter_id),
            evaluation,
        )
    write_json(
        root / "outputs/evaluations" / experiment_id / "metrics.json",
        {
            evaluation.adapter_id: {metric.metric: metric.value for metric in evaluation.metrics}
            for evaluation in evaluations
        },
    )
    return evaluations


def evaluate_only_experiment(root: Path | None = None) -> list[EvaluationResult]:
    root = root or project_root()
    manifests = load_experiments(root)
    if len(manifests) != 1:
        raise ValueError("eval-only requires exactly one configured experiment")
    return evaluate_experiment(manifests[0].experiment_id, root)


def _validate_content_id(model: BaseModel, field: str, prefix: str) -> None:
    body = model.model_dump(mode="json", exclude={field})
    if getattr(model, field) != content_address(prefix, body):
        raise ValueError(f"{prefix} ID mismatch")


def _comparison_input(
    root: Path,
    manifest: ExperimentManifest,
    spec: AdapterSpec,
) -> tuple[ComparisonInput, EvaluationResult, ResourceUsage]:
    evaluation = load_model(
        _evaluation_path(root, manifest.experiment_id, spec.adapter_id),
        EvaluationResult,
    )
    _validate_content_id(evaluation, "evaluation_id", "evaluation")
    run_directory = _run_directory(root, manifest.experiment_id, spec.adapter_id)
    run = load_model(run_directory / "run-record.json", RunRecord)
    _validate_content_id(run, "run_id", "run")
    if evaluation.adapter_id != run.adapter.adapter_id:
        raise ValueError("evaluation adapter differs from its run record")
    if evaluation.predictions != run.predictions:
        raise ValueError("evaluation predictions differ from its run record")
    resources = load_model(_validated_artifact(root, run.resources), ResourceUsage)
    reference = ComparisonInput(
        adapter_id=spec.adapter_id,
        run_id=run.run_id,
        evaluation_id=evaluation.evaluation_id,
    )
    return reference, evaluation, resources


def compare_experiment(experiment_id: str, root: Path | None = None) -> ComparisonScorecard:
    root = root or project_root()
    manifest = next(
        (item for item in load_experiments(root) if item.experiment_id == experiment_id), None
    )
    if manifest is None:
        raise ValueError(f"unknown experiment: {experiment_id}")
    baseline, baseline_evaluation, baseline_resources = _comparison_input(
        root, manifest, manifest.baseline
    )
    candidate_result = (
        _comparison_input(root, manifest, manifest.candidate)
        if manifest.candidate is not None
        else None
    )
    candidate = candidate_result[0] if candidate_result else None
    candidate_evaluation = candidate_result[1] if candidate_result else None
    candidate_resources = candidate_result[2] if candidate_result else None
    gates = evaluate_gates(
        manifest.objectives,
        manifest.resource_budget,
        baseline_evaluation.metrics,
        baseline_resources,
        candidate_evaluation.metrics if candidate_evaluation else None,
        candidate_resources,
    )
    body = {
        "schema_version": "1.0.0",
        "experiment_id": manifest.experiment_id,
        "workstream": manifest.workstream,
        "data_source_kind": manifest.data_source.kind,
        "synthetic_evidence_only": isinstance(manifest.data_source, SyntheticSource),
        "baseline": baseline.model_dump(mode="json"),
        "candidate": candidate.model_dump(mode="json") if candidate else None,
        "gates": [gate.model_dump(mode="json") for gate in gates],
        "recommendation": recommendation(candidate is not None, gates),
        "clinical_validity": False,
    }
    scorecard = ComparisonScorecard(scorecard_id=content_address("scorecard", body), **body)
    write_json(root / f"outputs/scorecards/{experiment_id}.json", scorecard)
    return scorecard


def compare_only_experiment(root: Path | None = None) -> ComparisonScorecard:
    root = root or project_root()
    manifests = load_experiments(root)
    if len(manifests) != 1:
        raise ValueError("compare-only requires exactly one configured experiment")
    return compare_experiment(manifests[0].experiment_id, root)


def aggregate_scorecards(root: Path | None = None) -> BenchmarkIndex:
    root = root or project_root()
    references: list[ScorecardReference] = []
    for manifest in load_experiments(root):
        path = root / f"outputs/scorecards/{manifest.experiment_id}.json"
        scorecard = load_model(path, ComparisonScorecard)
        _validate_content_id(scorecard, "scorecard_id", "scorecard")
        references.append(
            ScorecardReference(
                experiment_id=manifest.experiment_id,
                scorecard_id=scorecard.scorecard_id,
                artifact=_artifact_reference(root, path),
            )
        )
    body = {
        "schema_version": "1.0.0",
        "scorecards": [reference.model_dump(mode="json") for reference in references],
        "clinical_validity": False,
    }
    benchmark_id = content_address("benchmark", body)
    index = BenchmarkIndex(benchmark_id=benchmark_id, **body)
    write_json(root / "outputs/benchmark/index.json", index)
    return index


def write_schemas(*, check: bool = False, root: Path | None = None) -> None:
    root = root or contract_root()
    write_schema_artifacts(SCHEMA_MODELS, root=root, check=check)


def _verify_comparison_input(
    root: Path,
    experiment_id: str,
    reference: ComparisonInput,
) -> None:
    evaluation = load_model(
        _evaluation_path(root, experiment_id, reference.adapter_id),
        EvaluationResult,
    )
    _validate_content_id(evaluation, "evaluation_id", "evaluation")
    if evaluation.evaluation_id != reference.evaluation_id:
        raise ValueError(f"evaluation reference mismatch for {reference.adapter_id}")
    for artifact in (
        evaluation.experiment_manifest,
        evaluation.data_manifest,
        evaluation.predictions,
    ):
        _validated_artifact(root, artifact)

    run = load_model(
        _run_directory(root, experiment_id, reference.adapter_id) / "run-record.json",
        RunRecord,
    )
    _validate_content_id(run, "run_id", "run")
    if run.run_id != reference.run_id:
        raise ValueError(f"run reference mismatch for {reference.adapter_id}")
    for artifact in (run.predictions, run.resources, run.failure_report):
        _validated_artifact(root, artifact)
    if run.predictions != evaluation.predictions:
        raise ValueError("evaluation predictions differ from its run record")
    failures = load_model(resolve_under(root, run.failure_report.path), FailureReport).failures
    if failures:
        raise ValueError(f"run contains {len(failures)} recorded failure(s)")


def verify(root: Path | None = None) -> None:
    root = root or project_root()
    validate_contracts(root, write_report=False)
    index = load_model(root / "outputs/benchmark/index.json", BenchmarkIndex)
    _validate_content_id(index, "benchmark_id", "benchmark")
    for reference in index.scorecards:
        scorecard = load_model(_validated_artifact(root, reference.artifact), ComparisonScorecard)
        _validate_content_id(scorecard, "scorecard_id", "scorecard")
        if scorecard.scorecard_id != reference.scorecard_id:
            raise ValueError(f"scorecard reference mismatch for {reference.experiment_id}")
        if not scorecard.synthetic_evidence_only:
            raise ValueError("initial scorecards must use synthetic contract evidence")
        if not all(gate.passed for gate in scorecard.gates):
            raise ValueError(f"failed benchmark gate in {scorecard.experiment_id}")
        _verify_comparison_input(root, scorecard.experiment_id, scorecard.baseline)
        if scorecard.candidate is not None:
            _verify_comparison_input(root, scorecard.experiment_id, scorecard.candidate)


def generate(root: Path | None = None) -> None:
    root = root or project_root()
    generate_fixtures(root)
