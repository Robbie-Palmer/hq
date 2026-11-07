from pathlib import Path

import pytest
import torch

from pathologize_cell_analysis.ultralytics_conversion import load_ultralytics_experiment
from pathologize_cell_analysis.ultralytics_experiment import (
    ULTRALYTICS_OUTPUT_DIRECTORY,
    _experiment_output_root,
    _load_safe_checkpoint,
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
