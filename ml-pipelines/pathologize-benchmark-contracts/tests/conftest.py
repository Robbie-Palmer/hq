from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from pathologize_benchmark_contracts import pipeline
from pathologize_benchmark_contracts.pipeline import (
    aggregate_scorecards,
    evaluate_experiment,
    evaluate_only_experiment,
    generate,
    load_experiments,
    validate_contracts,
    write_schemas,
)

PIPELINES_ROOT = Path(__file__).resolve().parents[2]
BENCHMARK_PROJECTS = (
    "pathologize-slide-quality-benchmark",
    "pathologize-tiling-benchmark",
    "pathologize-cell-analysis-benchmark",
)


def _copy_project(project_name: str, target: Path) -> Path:
    source = PIPELINES_ROOT / project_name
    shutil.copytree(source / "experiments", target / "experiments")
    shutil.copytree(source / "fixtures", target / "fixtures")
    for filename in ("params.yaml", "dvc.yaml", "pyproject.toml"):
        shutil.copy2(source / filename, target / filename)
    return target


def _run_adapters_inline(root: Path) -> None:
    for manifest in load_experiments(root):
        items = pipeline._evaluation_items(root, manifest)
        pipeline._run_adapter(root, manifest, manifest.baseline, items)
        if manifest.candidate is not None:
            pipeline._run_adapter(root, manifest, manifest.candidate, items)


@pytest.fixture
def configured_root(tmp_path: Path) -> Path:
    return _copy_project("pathologize-slide-quality-benchmark", tmp_path)


@pytest.fixture(params=BENCHMARK_PROJECTS)
def configured_benchmark_root(request: pytest.FixtureRequest, tmp_path: Path) -> Path:
    return _copy_project(str(request.param), tmp_path)


@pytest.fixture
def reproduced_root(configured_root: Path) -> Path:
    write_schemas(root=configured_root)
    generate(configured_root)
    validate_contracts(configured_root)
    _run_adapters_inline(configured_root)
    for manifest in load_experiments(configured_root):
        evaluate_experiment(manifest.experiment_id, configured_root)
    aggregate_scorecards(configured_root)
    return configured_root


@pytest.fixture
def reproduced_benchmark_root(configured_benchmark_root: Path) -> Path:
    generate(configured_benchmark_root)
    validate_contracts(configured_benchmark_root)
    _run_adapters_inline(configured_benchmark_root)
    evaluate_only_experiment(configured_benchmark_root)
    aggregate_scorecards(configured_benchmark_root)
    return configured_benchmark_root


@pytest.fixture
def reproduced_tiling_root(tmp_path: Path) -> Path:
    root = _copy_project("pathologize-tiling-benchmark", tmp_path)
    generate(root)
    validate_contracts(root)
    _run_adapters_inline(root)
    for manifest in load_experiments(root):
        evaluate_experiment(manifest.experiment_id, root)
    aggregate_scorecards(root)
    return root
