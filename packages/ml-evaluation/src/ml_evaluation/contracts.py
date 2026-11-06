from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

SHA256_PATTERN = r"^[a-f0-9]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Split(StrEnum):
    TRAIN = "train"
    VALIDATION = "validation"
    TEST = "test"


class AdapterSpec(StrictModel):
    adapter_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]+$")
    kind: Literal["builtin", "python_entrypoint"]
    entrypoint: str = Field(min_length=1)
    version: str = Field(min_length=1)
    artifact_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def pin_external_adapter(self) -> Self:
        if self.kind == "python_entrypoint" and self.artifact_sha256 is None:
            raise ValueError("python entrypoint adapters require an artifact SHA-256")
        return self


class MetricObjective(StrictModel):
    metric: str = Field(pattern=r"^[a-z][a-z0-9_]+$")
    role: Literal["primary", "guardrail", "diagnostic"]
    direction: Literal["maximize", "minimize"]
    unit: Literal["ratio", "pixels", "bytes", "seconds"]
    baseline_floor: float | None = None
    candidate_min_delta: float | None = None
    candidate_max_regression: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_gate_for_non_diagnostic_metric(self) -> Self:
        if self.role != "diagnostic" and self.baseline_floor is None:
            raise ValueError("primary and guardrail metrics require a baseline floor")
        if self.role == "primary" and self.candidate_min_delta is None:
            raise ValueError("primary metrics require a candidate minimum delta")
        if self.role == "diagnostic" and any(
            value is not None
            for value in (
                self.baseline_floor,
                self.candidate_min_delta,
                self.candidate_max_regression,
            )
        ):
            raise ValueError("diagnostic metrics cannot define decision gates")
        return self


class ResourceBudget(StrictModel):
    max_input_bytes: int = Field(gt=0)
    max_prediction_bytes: int = Field(gt=0)
    max_pixels_read: int = Field(gt=0)
    max_accelerator_seconds: float = Field(ge=0)


class ResourceUsage(StrictModel):
    samples: int = Field(ge=0)
    input_bytes: int = Field(ge=0)
    prediction_bytes: int = Field(ge=0)
    pixels_read: int = Field(ge=0)
    accelerator_seconds: float = Field(ge=0)
    observed_wall_seconds: float | None = Field(default=None, ge=0)
    observed_cpu_seconds: float | None = Field(default=None, ge=0)
    observed_peak_rss_bytes: int | None = Field(default=None, ge=0)


class MetricResult(StrictModel):
    metric: str
    value: float
    unit: str
    role: str
    direction: str


class GateResult(StrictModel):
    gate: str
    passed: bool
    observed: float
    threshold: float


class RunSummary(StrictModel):
    adapter: AdapterSpec
    metrics: list[MetricResult]
    resources: ResourceUsage


def require_relative_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("path must be project-relative without parent traversal")
    return path
