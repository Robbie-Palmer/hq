from __future__ import annotations

from pathlib import Path
from typing import Any

from data_artifacts.files import (
    content_address,
    load_model,
    read_jsonl,
    resolve_under,
    sha256_file,
    write_json,
    write_jsonl,
)
from data_artifacts.schemas import write_schemas as write_schema_artifacts
from ml_evaluation.contracts import AdapterSpec, MetricResult, ResourceUsage, RunSummary
from ml_evaluation.gates import evaluate_gates, recommendation
from pydantic import BaseModel

from .adapters import load_adapter
from .artifacts import contract_root, project_root
from .contracts import (
    SCHEMA_MODELS,
    AggregateScorecard,
    BenchmarkProject,
    ExperimentManifest,
    FixtureItem,
    FixtureManifest,
    LeakageUnit,
    NucleiPrediction,
    QualityPrediction,
    RegistryExport,
    RegistryItem,
    RegistrySource,
    Scorecard,
    Split,
    SyntheticSource,
    TilingPrediction,
    Workstream,
)
from .metrics import evaluate_predictions
from .synthetic import generate_fixtures


def _configuration(root: Path) -> BenchmarkProject:
    return load_model(root / "params.yaml", BenchmarkProject)


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


def _leakage_values(item: FixtureItem | RegistryItem, unit: LeakageUnit) -> str:
    return str(getattr(item.leakage, unit.value))


def validate_leakage(
    items: list[FixtureItem] | list[RegistryItem], units: list[LeakageUnit]
) -> None:
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
            validate_leakage(export.items, manifest.split_policy.leakage_units)
            sources.append(
                {
                    "experiment_id": manifest.experiment_id,
                    "kind": manifest.data_source.kind,
                    "items": len(export.items),
                    "registry_revision": export.registry_revision,
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
    validate_leakage(export.items, manifest.split_policy.leakage_units)
    output = {
        "contract": export.contract,
        "registry_uri": manifest.data_source.registry_uri,
        "registry_revision": export.registry_revision,
        "export_sha256": manifest.data_source.export_sha256,
        "raw_data_copied": False,
        "dataset": export.dataset.model_dump(mode="json"),
        "provenance": export.provenance.model_dump(mode="json"),
        "items": [item.model_dump(mode="json") for item in export.items],
    }
    write_json(root / f"data/imported/{experiment_id}/registry-index.json", output)


def _evaluation_items(root: Path, manifest: ExperimentManifest) -> list[FixtureItem]:
    if not isinstance(manifest.data_source, SyntheticSource):
        raise TypeError("the built-in runner only consumes synthetic fixtures")
    fixture = _load_fixture_source(root, manifest.data_source)
    return [item for item in fixture.items if item.split == manifest.split_policy.evaluation_split]


def _run_directory(root: Path, experiment_id: str, adapter_id: str) -> Path:
    return root / "outputs/runs" / experiment_id / adapter_id


def _run_adapter(
    root: Path,
    manifest: ExperimentManifest,
    adapter_spec: AdapterSpec,
    items: list[FixtureItem],
) -> None:
    adapter = load_adapter(adapter_spec)
    predictions = [adapter.predict(manifest, item, root) for item in items]
    output = _run_directory(root, manifest.experiment_id, adapter.adapter_id)
    prediction_bytes = write_jsonl(output / "predictions.jsonl", predictions)
    input_paths = [resolve_under(root, item.image_path) for item in items]
    resources = ResourceUsage(
        samples=len(items),
        input_bytes=sum(path.stat().st_size for path in input_paths),
        prediction_bytes=prediction_bytes,
        pixels_read=sum(item.width * item.height for item in items),
        accelerator_seconds=0,
        observed_wall_seconds=None,
        observed_cpu_seconds=None,
        observed_peak_rss_bytes=None,
    )
    write_json(output / "resources.json", resources)


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


def _read_run(
    root: Path,
    manifest: ExperimentManifest,
    spec: AdapterSpec,
    items: list[FixtureItem],
) -> RunSummary:
    directory = _run_directory(root, manifest.experiment_id, spec.adapter_id)
    prediction_type = _prediction_type(manifest.workstream)
    predictions = [
        prediction_type.model_validate(value)
        for value in read_jsonl(directory / "predictions.jsonl")
    ]
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
    return RunSummary(
        adapter=spec,
        metrics=metrics,
        resources=load_model(directory / "resources.json", ResourceUsage),
    )


def _scorecard_id(scorecard: dict[str, Any]) -> str:
    return content_address("scorecard", scorecard)


def evaluate_experiment(experiment_id: str, root: Path | None = None) -> Scorecard:
    root = root or project_root()
    manifest = next(
        (item for item in load_experiments(root) if item.experiment_id == experiment_id), None
    )
    if manifest is None:
        raise ValueError(f"unknown experiment: {experiment_id}")
    items = _evaluation_items(root, manifest)
    baseline = _read_run(root, manifest, manifest.baseline, items)
    candidate = (
        _read_run(root, manifest, manifest.candidate, items)
        if manifest.candidate is not None
        else None
    )
    gates = evaluate_gates(
        manifest.objectives,
        manifest.resource_budget,
        baseline,
        candidate,
    )
    experiment_recommendation = recommendation(candidate, gates)
    body = {
        "schema_version": "1.0.0",
        "experiment_id": manifest.experiment_id,
        "workstream": manifest.workstream,
        "data_source_kind": manifest.data_source.kind,
        "synthetic_evidence_only": isinstance(manifest.data_source, SyntheticSource),
        "baseline": baseline.model_dump(mode="json"),
        "candidate": candidate.model_dump(mode="json") if candidate else None,
        "gates": [gate.model_dump(mode="json") for gate in gates],
        "recommendation": experiment_recommendation,
        "clinical_validity": False,
    }
    scorecard = Scorecard(scorecard_id=_scorecard_id(body), **body)
    write_json(root / f"outputs/scorecards/{experiment_id}.json", scorecard)
    return scorecard


def evaluate_only_experiment(root: Path | None = None) -> Scorecard:
    root = root or project_root()
    manifests = load_experiments(root)
    if len(manifests) != 1:
        raise ValueError("eval-only requires exactly one configured experiment")
    return evaluate_experiment(manifests[0].experiment_id, root)


def aggregate_scorecards(root: Path | None = None) -> AggregateScorecard:
    root = root or project_root()
    scorecards = [
        load_model(root / f"outputs/scorecards/{manifest.experiment_id}.json", Scorecard)
        for manifest in load_experiments(root)
    ]
    body = {
        "schema_version": "1.0.0",
        "scorecards": [scorecard.model_dump(mode="json") for scorecard in scorecards],
        "clinical_validity": False,
    }
    benchmark_id = content_address("benchmark", body)
    aggregate = AggregateScorecard(benchmark_id=benchmark_id, **body)
    write_json(root / "outputs/scorecard/benchmark.json", aggregate)
    write_json(
        root / "outputs/scorecard/metrics.json",
        {
            scorecard.experiment_id: {
                metric.metric: metric.value for metric in scorecard.baseline.metrics
            }
            for scorecard in scorecards
        },
    )
    return aggregate


def write_schemas(*, check: bool = False, root: Path | None = None) -> None:
    root = root or contract_root()
    write_schema_artifacts(SCHEMA_MODELS, root=root, check=check)


def _validate_scorecard_id(scorecard: Scorecard) -> None:
    body = scorecard.model_dump(mode="json", exclude={"scorecard_id"})
    if scorecard.scorecard_id != _scorecard_id(body):
        raise ValueError(f"scorecard ID mismatch for {scorecard.experiment_id}")


def verify(root: Path | None = None) -> None:
    root = root or project_root()
    validate_contracts(root, write_report=False)
    aggregate = load_model(root / "outputs/scorecard/benchmark.json", AggregateScorecard)
    for scorecard in aggregate.scorecards:
        _validate_scorecard_id(scorecard)
        if not scorecard.synthetic_evidence_only:
            raise ValueError("initial scorecards must use synthetic contract evidence")
        if not all(gate.passed for gate in scorecard.gates):
            raise ValueError(f"failed benchmark gate in {scorecard.experiment_id}")
    body = aggregate.model_dump(mode="json", exclude={"benchmark_id"})
    expected = content_address("benchmark", body)
    if aggregate.benchmark_id != expected:
        raise ValueError("aggregate benchmark ID mismatch")


def generate(root: Path | None = None) -> None:
    root = root or project_root()
    generate_fixtures(root)
