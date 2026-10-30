from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from financial_document_idp.pipeline import (
    build_corpus,
    error_analysis,
    evaluate,
    extract,
    match,
    normalize,
    safety_and_render,
    write_schemas,
)


@pytest.fixture
def evaluation_root(tmp_path: Path) -> Path:
    source_root = Path(__file__).resolve().parents[1]
    for filename in ("models.json", "params.yaml", "pyproject.toml", "uv.lock"):
        shutil.copy2(source_root / filename, tmp_path / filename)
    for directory in ("fixtures", "prompts", "schemas", "src"):
        shutil.copytree(source_root / directory, tmp_path / directory)
    return tmp_path


@pytest.fixture
def reproduced_root(evaluation_root: Path) -> Path:
    run_pipeline(evaluation_root)
    return evaluation_root


def run_pipeline(root: Path) -> None:
    write_schemas(check=False, root=root)
    build_corpus(root)
    safety_and_render(root)
    extract(root)
    normalize(root)
    match(root)
    evaluate(root)
    error_analysis(root)
