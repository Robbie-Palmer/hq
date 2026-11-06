from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from pathologize_evaluation.artifacts import project_root
from pathologize_evaluation.pipeline import (
    aggregate_scorecards,
    evaluate_experiment,
    generate,
    load_experiments,
    run_adapters,
    validate_contracts,
    write_schemas,
)


@pytest.fixture
def configured_root(tmp_path: Path) -> Path:
    source = project_root()
    shutil.copytree(source / "experiments", tmp_path / "experiments")
    shutil.copytree(source / "fixtures", tmp_path / "fixtures")
    shutil.copy2(source / "params.yaml", tmp_path / "params.yaml")
    shutil.copy2(source / "dvc.yaml", tmp_path / "dvc.yaml")
    return tmp_path


@pytest.fixture
def reproduced_root(configured_root: Path) -> Path:
    write_schemas(root=configured_root)
    generate(configured_root)
    validate_contracts(configured_root)
    run_adapters(configured_root)
    for manifest in load_experiments(configured_root):
        evaluate_experiment(manifest.experiment_id, configured_root)
    aggregate_scorecards(configured_root)
    return configured_root
