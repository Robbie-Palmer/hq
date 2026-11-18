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
    max_pixels_read: int = Field(gt=0)
    max_accelerator_seconds: float = Field(ge=0)


class ResourceUsage(StrictModel):
    samples: int = Field(ge=0)
    input_bytes: int = Field(ge=0)
    prediction_bytes: int = Field(ge=0)
    pixels_read: int = Field(ge=0)
    accelerator_seconds: float | None = Field(default=None, ge=0)
    observed_wall_seconds: float | None = Field(default=None, ge=0)
    observed_cpu_seconds: float | None = Field(default=None, ge=0)
    observed_peak_rss_bytes: int | None = Field(default=None, ge=0)


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


class ArtifactReference(StrictModel):
    path: str
    sha256: str = Field(pattern=SHA256_PATTERN)

    @model_validator(mode="after")
    def require_project_relative_path(self) -> Self:
        require_relative_path(self.path)
        return self


class CheckpointArtifact(ArtifactReference):
    step: int = Field(ge=0)


class CheckpointSeries(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    parameters_sha256: str = Field(pattern=SHA256_PATTERN)
    source_run_sha256: str = Field(pattern=SHA256_PATTERN)
    checkpoints: tuple[CheckpointArtifact, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def require_ordered_unique_checkpoints(self) -> Self:
        steps = [checkpoint.step for checkpoint in self.checkpoints]
        paths = [checkpoint.path for checkpoint in self.checkpoints]
        if steps != sorted(steps) or len(steps) != len(set(steps)):
            raise ValueError("checkpoints must have unique ascending steps")
        if len(paths) != len(set(paths)):
            raise ValueError("checkpoint paths must be unique")
        return self


class ExecutionBudget(StrictModel):
    max_wall_seconds: float | None = Field(default=None, gt=0)
    max_accelerator_seconds: float | None = Field(default=None, gt=0)
    max_peak_accelerator_bytes: int | None = Field(default=None, gt=0)
    minimum_free_disk_bytes: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_at_least_one_limit(self) -> Self:
        if all(
            value is None
            for value in (
                self.max_wall_seconds,
                self.max_accelerator_seconds,
                self.max_peak_accelerator_bytes,
                self.minimum_free_disk_bytes,
            )
        ):
            raise ValueError("execution budget must declare at least one limit")
        return self


class ExecutionUsage(StrictModel):
    wall_seconds: float | None = Field(default=None, ge=0)
    accelerator_seconds: float | None = Field(default=None, ge=0)
    peak_accelerator_bytes: int | None = Field(default=None, ge=0)
    free_disk_bytes: int | None = Field(default=None, ge=0)


class ResourceLimitViolation(StrictModel):
    resource: Literal[
        "wall_seconds",
        "accelerator_seconds",
        "peak_accelerator_bytes",
        "free_disk_bytes",
    ]
    relation: Literal["maximum", "minimum"]
    observed: float | None
    limit: float


class BootstrapConfig(StrictModel):
    replicates: int = Field(ge=100)
    seed: int = Field(ge=0)
    confidence_level: float = Field(gt=0, lt=1)


class ConfidenceInterval(StrictModel):
    lower: float = Field(allow_inf_nan=False)
    upper: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def require_ordered_bounds(self) -> Self:
        if self.lower > self.upper:
            raise ValueError("confidence interval bounds must be ordered")
        return self


class CurveWindow(StrictModel):
    start_step: int = Field(ge=1)
    end_step: int = Field(ge=1)
    mean: float = Field(allow_inf_nan=False)

    @model_validator(mode="after")
    def require_ordered_steps(self) -> Self:
        if self.end_step < self.start_step:
            raise ValueError("curve window steps must be ordered")
        return self


class CurveDirectionAgreement(StrictModel):
    peak_worse_than_first: bool
    later_better_than_peak: bool


class CurveComparison(StrictModel):
    first_minimum: CurveWindow
    later_peak: CurveWindow
    later_minimum: CurveWindow
    peak_increase: float = Field(allow_inf_nan=False)
    peak_difference_interval: ConfidenceInterval
    second_descent: float = Field(allow_inf_nan=False)
    descent_difference_interval: ConfidenceInterval
    later_minus_first: float = Field(allow_inf_nan=False)
    later_beats_first: bool
    peak_supported: bool
    second_descent_supported: bool
    replicate_agreement: dict[str, CurveDirectionAgreement]
    pattern_observed: bool


class FailureReport(StrictModel):
    schema_version: Literal["1.0.0"]
    failures: list[RunFailure]


class RunRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    run_id: str = Field(pattern=r"^run:sha256:[a-f0-9]{64}$")
    experiment_id: str
    adapter: AdapterSpec
    predictions: ArtifactReference
    resources: ArtifactReference
    failure_report: ArtifactReference


def require_relative_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("path must be project-relative without parent traversal")
    return path
