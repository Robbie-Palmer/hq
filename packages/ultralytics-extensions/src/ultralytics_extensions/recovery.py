from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal


@dataclass(frozen=True)
class TrainingTaskState:
    status: Literal["running", "failed", "complete"]
    consumed_gpu_seconds_upper_bound: float
    wall_seconds: float
    cpu_seconds: float
    peak_rss_bytes: int
    peak_vram_bytes: int
    resource: dict[str, Any] | None = None
    checkpoint: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        numeric_values = (
            self.consumed_gpu_seconds_upper_bound,
            self.wall_seconds,
            self.cpu_seconds,
            self.peak_rss_bytes,
            self.peak_vram_bytes,
        )
        if any(value < 0 for value in numeric_values):
            raise ValueError("training task state values must be non-negative")
        has_completion = self.resource is not None and self.checkpoint is not None
        if (self.status == "complete") != has_completion:
            raise ValueError(
                "complete training task state requires resource and checkpoint evidence"
            )


def load_training_task_state(path: Path) -> TrainingTaskState | None:
    if not path.is_file():
        return None
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.pop("schema_version", None) != "1.0.0":
        raise ValueError(f"invalid training task state: {path}")
    return TrainingTaskState(**document)


def write_training_task_state(path: Path, state: TrainingTaskState) -> None:
    document = {"schema_version": "1.0.0", **asdict(state)}
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.parent.mkdir(parents=True, exist_ok=True)
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
