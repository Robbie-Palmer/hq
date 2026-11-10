from pathlib import Path

import pytest
from pydantic import ValidationError

from ml_evaluation.contracts import CheckpointArtifact, CheckpointSeries
from ml_evaluation.provenance import index_checkpoints, verify_checkpoint_series

DIGEST = "a" * 64


def test_indexes_and_verifies_checkpoint_series(tmp_path: Path) -> None:
    weights = tmp_path / "weights"
    weights.mkdir()
    (weights / "step-1.bin").write_bytes(b"one")
    (weights / "step-2.bin").write_bytes(b"two")

    series = index_checkpoints(
        tmp_path,
        {2: "weights/step-2.bin", 1: "weights/step-1.bin"},
        parameters_sha256=DIGEST,
        source_run_sha256="b" * 64,
    )

    assert [checkpoint.step for checkpoint in series.checkpoints] == [1, 2]
    assert verify_checkpoint_series(tmp_path, series) == (
        weights / "step-1.bin",
        weights / "step-2.bin",
    )


def test_checkpoint_verification_rejects_drift_and_escaped_paths(tmp_path: Path) -> None:
    checkpoint = tmp_path / "checkpoint.bin"
    checkpoint.write_bytes(b"original")
    series = index_checkpoints(
        tmp_path,
        {1: "checkpoint.bin"},
        parameters_sha256=DIGEST,
        source_run_sha256="b" * 64,
    )
    checkpoint.write_bytes(b"changed")

    with pytest.raises(ValueError, match="digest differs"):
        verify_checkpoint_series(tmp_path, series)
    with pytest.raises(ValueError, match="relative"):
        index_checkpoints(
            tmp_path,
            {1: checkpoint},
            parameters_sha256=DIGEST,
            source_run_sha256="b" * 64,
        )


def test_checkpoint_contract_rejects_empty_duplicate_or_unordered_series() -> None:
    first = CheckpointArtifact(step=1, path="one.bin", sha256=DIGEST)
    second = CheckpointArtifact(step=2, path="two.bin", sha256="b" * 64)
    with pytest.raises(ValidationError, match="at least 1"):
        CheckpointSeries(
            parameters_sha256=DIGEST,
            source_run_sha256="c" * 64,
            checkpoints=(),
        )
    with pytest.raises(ValidationError, match="ascending"):
        CheckpointSeries(
            parameters_sha256=DIGEST,
            source_run_sha256="c" * 64,
            checkpoints=(second, first),
        )
    with pytest.raises(ValidationError, match="paths must be unique"):
        CheckpointSeries(
            parameters_sha256=DIGEST,
            source_run_sha256="c" * 64,
            checkpoints=(first, second.model_copy(update={"path": "one.bin"})),
        )
