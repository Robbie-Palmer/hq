from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from data_artifacts.files import resolve_under, sha256_file

from .contracts import CheckpointArtifact, CheckpointSeries


def index_checkpoints(
    root: Path,
    checkpoints: Mapping[int, str | Path],
    *,
    parameters_sha256: str,
    source_run_sha256: str,
) -> CheckpointSeries:
    artifacts: list[CheckpointArtifact] = []
    for step, relative in sorted(checkpoints.items()):
        relative_path = Path(relative)
        path = resolve_under(root, relative_path)
        if not path.is_file():
            raise FileNotFoundError(f"checkpoint does not exist: {relative_path.as_posix()}")
        artifacts.append(
            CheckpointArtifact(
                step=step,
                path=relative_path.as_posix(),
                sha256=sha256_file(path),
            )
        )
    return CheckpointSeries(
        parameters_sha256=parameters_sha256,
        source_run_sha256=source_run_sha256,
        checkpoints=tuple(artifacts),
    )


def verify_checkpoint_series(root: Path, series: CheckpointSeries) -> tuple[Path, ...]:
    verified: list[Path] = []
    for checkpoint in series.checkpoints:
        path = resolve_under(root, checkpoint.path)
        if not path.is_file():
            raise FileNotFoundError(f"checkpoint does not exist: {checkpoint.path}")
        if sha256_file(path) != checkpoint.sha256:
            raise ValueError(f"checkpoint digest differs at step {checkpoint.step}")
        verified.append(path)
    return tuple(verified)
