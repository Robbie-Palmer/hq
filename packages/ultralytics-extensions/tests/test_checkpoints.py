from __future__ import annotations

from pathlib import Path

import pytest
import torch

from ultralytics_extensions.checkpoints import (
    checkpoint_epoch,
    load_safe_checkpoint,
    resume_evidence,
    training_rows,
)


def test_checkpoint_loading_restricts_deserialization(tmp_path: Path) -> None:
    checkpoint_path = tmp_path / "checkpoint.pt"
    torch.save({"epoch": 3, "loss": torch.tensor([0.25])}, checkpoint_path)
    checkpoint = load_safe_checkpoint(torch, checkpoint_path)
    assert checkpoint["epoch"] == 3
    assert torch.equal(checkpoint["loss"], torch.tensor([0.25]))
    assert checkpoint_epoch(torch, checkpoint_path) == 3


def test_resume_requires_rows_and_checkpoint(tmp_path: Path) -> None:
    task_output = tmp_path / "detect"
    weights = task_output / "weights"
    weights.mkdir(parents=True)
    (weights / "last.pt").write_bytes(b"checkpoint")
    (task_output / "results.csv").write_text(
        "epoch,time,metrics/mAP50-95(B)\n2,23.0,0.2\n",
        encoding="utf-8",
    )
    rows = training_rows(task_output)
    assert rows[0]["epoch"] == 2
    resume = resume_evidence(task_output)
    assert resume is not None
    assert resume.completed_epochs == 2
    assert resume.elapsed_seconds_upper_bound == 23.0
    partial = tmp_path / "partial"
    partial.mkdir()
    assert resume_evidence(partial) is None
    incomplete = tmp_path / "incomplete"
    incomplete.mkdir()
    (incomplete / "results.csv").write_text("epoch,time\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError, match="not resumable"):
        resume_evidence(incomplete)
