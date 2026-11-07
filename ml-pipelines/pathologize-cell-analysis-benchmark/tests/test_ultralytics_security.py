from pathlib import Path
from typing import Any

import pytest
import torch
from data_artifacts.files import read_json, write_json

from pathologize_cell_analysis import ultralytics_experiment
from pathologize_cell_analysis.ultralytics_conversion import load_ultralytics_experiment
from pathologize_cell_analysis.ultralytics_experiment import (
    ULTRALYTICS_EXPERIMENT_PATH,
    ULTRALYTICS_JSON_REPORT,
    ULTRALYTICS_MARKDOWN_REPORT,
    ULTRALYTICS_OUTPUT_DIRECTORY,
    _experiment_output_root,
    _load_safe_checkpoint,
    report_ultralytics,
)


def test_checkpoint_loading_restricts_deserialization(tmp_path: Path) -> None:
    checkpoint_path = tmp_path / "checkpoint.pt"
    torch.save({"epoch": 3, "loss": torch.tensor([0.25])}, checkpoint_path)

    checkpoint = _load_safe_checkpoint(torch, checkpoint_path)

    assert checkpoint["epoch"] == 3
    assert torch.equal(checkpoint["loss"], torch.tensor([0.25]))


def test_experiment_output_directory_is_pinned(tmp_path: Path) -> None:
    experiment_path = Path(__file__).parents[1] / "experiments/nucls-ultralytics-baseline.json"
    experiment = load_ultralytics_experiment(experiment_path)

    assert _experiment_output_root(tmp_path, experiment) == (
        tmp_path / ULTRALYTICS_OUTPUT_DIRECTORY
    )

    escaped = experiment.model_copy(update={"output_directory": "../../outside"})
    with pytest.raises(ValueError, match="output directory must be"):
        _experiment_output_root(tmp_path, escaped)


def test_ultralytics_report_writes_only_pinned_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repository_root = Path(__file__).parents[1]
    experiment_path = tmp_path / ULTRALYTICS_EXPERIMENT_PATH
    experiment_path.parent.mkdir(parents=True)
    source_path = repository_root / ULTRALYTICS_EXPERIMENT_PATH
    experiment_path.write_text(source_path.read_text(encoding="utf-8"), encoding="utf-8")
    evidence: Any = read_json(repository_root / ULTRALYTICS_JSON_REPORT)
    write_json(
        tmp_path / ULTRALYTICS_OUTPUT_DIRECTORY / "evaluation" / "evidence.json",
        evidence,
    )
    monkeypatch.setattr(
        ultralytics_experiment, "ULTRALYTICS_EXPERIMENT_FILE", experiment_path
    )
    monkeypatch.setattr(
        ultralytics_experiment,
        "ULTRALYTICS_OUTPUT_ROOT",
        tmp_path / ULTRALYTICS_OUTPUT_DIRECTORY,
    )
    monkeypatch.setattr(
        ultralytics_experiment,
        "ULTRALYTICS_JSON_REPORT_FILE",
        tmp_path / ULTRALYTICS_JSON_REPORT,
    )
    monkeypatch.setattr(
        ultralytics_experiment,
        "ULTRALYTICS_MARKDOWN_REPORT_FILE",
        tmp_path / ULTRALYTICS_MARKDOWN_REPORT,
    )

    observed = report_ultralytics()

    assert observed == evidence
    assert read_json(tmp_path / ULTRALYTICS_JSON_REPORT) == evidence
    assert (
        (tmp_path / ULTRALYTICS_MARKDOWN_REPORT)
        .read_text(encoding="utf-8")
        .startswith("# NuCLS Ultralytics baseline")
    )
