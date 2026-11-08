from __future__ import annotations

from pathlib import Path

import pytest

from ultralytics_extensions.recovery import (
    TrainingTaskState,
    load_training_task_state,
    write_training_task_state,
)


def test_training_task_state_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "detect-state.json"
    state = TrainingTaskState(
        status="complete",
        consumed_gpu_seconds_upper_bound=12.5,
        wall_seconds=13.0,
        cpu_seconds=4.0,
        peak_rss_bytes=1024,
        peak_vram_bytes=2048,
        resource={"gpu_seconds": 12.5},
        checkpoint={"best": "best.pt"},
    )
    write_training_task_state(path, state)
    assert load_training_task_state(path) == state
    assert not path.with_suffix(".json.tmp").exists()


def test_training_task_state_rejects_inconsistent_completion(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires resource and checkpoint"):
        TrainingTaskState(
            status="complete",
            consumed_gpu_seconds_upper_bound=0,
            wall_seconds=0,
            cpu_seconds=0,
            peak_rss_bytes=0,
            peak_vram_bytes=0,
        )

    path = tmp_path / "invalid.json"
    path.write_text('{"schema_version":"2.0.0"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="invalid training task state"):
        load_training_task_state(path)
