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


class ExecutionDevice(StrEnum):
    CPU = "cpu"
    ACCELERATOR = "accelerator"


class AdapterSpec(StrictModel):
    adapter_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]+$")
    kind: Literal["builtin", "python_entrypoint"]
    entrypoint: str = Field(min_length=1)
    version: str = Field(min_length=1)
    execution_device: ExecutionDevice = ExecutionDevice.CPU
    artifact_path: str | None = None
    artifact_sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def pin_external_adapter(self) -> Self:
        if self.kind == "python_entrypoint" and (
            self.artifact_path is None or self.artifact_sha256 is None
        ):
            raise ValueError("python entrypoint adapters require an artifact path and SHA-256")
        if self.kind == "builtin" and (
            self.artifact_path is not None or self.artifact_sha256 is not None
        ):
            raise ValueError("built-in adapters are pinned by the evaluation source fingerprint")
        return self


class MetricObjective(StrictModel):
    metric: str = Field(pattern=r"^[a-z][a-z0-9_]+$")
    role: Literal["primary", "guardrail", "robustness", "calibration", "diagnostic"]
    direction: Literal["maximize", "minimize"]
    unit: Literal["ratio", "pixels", "bytes", "seconds"]
    baseline_floor: float | None = None
    candidate_min_delta: float | None = Field(default=None, gt=0)
    candidate_max_regression: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_gate_for_non_diagnostic_metric(self) -> Self:
        if self.role != "diagnostic" and self.baseline_floor is None:
            raise ValueError("decision metrics require a baseline threshold")
        if self.role == "primary" and self.candidate_min_delta is None:
            raise ValueError("primary metrics require a candidate minimum delta")
        if self.role in {"guardrail", "robustness", "calibration"} and (
            self.candidate_max_regression is None
        ):
            raise ValueError(
                "guardrail, robustness, and calibration metrics require a candidate "
                "maximum regression"
            )
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
    max_input_pixels: int = Field(gt=0)
    max_wall_seconds: float = Field(gt=0)
    max_cpu_seconds: float = Field(gt=0)
    max_peak_rss_bytes: int = Field(gt=0)
    max_accelerator_wall_seconds: float = Field(ge=0)
    max_accelerator_memory_bytes: int = Field(ge=0)


class ResourceUsage(StrictModel):
    samples: int = Field(ge=0)
    input_bytes: int = Field(ge=0)
    prediction_bytes: int = Field(ge=0)
    input_pixels: int = Field(ge=0)
    wall_seconds: float = Field(ge=0)
    cpu_seconds: float = Field(ge=0)
    peak_rss_bytes: int = Field(ge=0)
    accelerator_wall_seconds: float = Field(ge=0)
    peak_accelerator_memory_bytes: int = Field(ge=0)


class RunFailure(StrictModel):
    item_id: str
    error_type: str
    message: str


class MetricResult(StrictModel):
    metric: str
    value: float
    unit: str
    role: str
    direction: str


class GateResult(StrictModel):
    gate: str
    passed: bool
    observed: float | None
    threshold: float


class RunSummary(StrictModel):
    adapter: AdapterSpec
    metrics: list[MetricResult]
    resources: ResourceUsage
    failures: list[RunFailure]


def require_relative_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("path must be project-relative without parent traversal")
    return path
