from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Workstream(StrEnum):
    SLIDE_QUALITY = "whole_slide_tissue_artifact_quality"
    TILING_POLICY = "tiling_magnification_policy"
    NUCLEI = "nucleus_detection_segmentation_classification"


class Split(StrEnum):
    TRAIN = "train"
    VALIDATION = "validation"
    TEST = "test"


class LeakageUnit(StrEnum):
    SUBJECT = "subject_id"
    SPECIMEN = "specimen_id"
    BLOCK = "block_id"
    SLIDE = "slide_id"
    ACQUISITION = "acquisition_id"
    SITE = "site_id"


class LeakageKeys(StrictModel):
    subject_id: str = Field(min_length=1)
    specimen_id: str = Field(min_length=1)
    block_id: str = Field(min_length=1)
    slide_id: str = Field(min_length=1)
    acquisition_id: str = Field(min_length=1)
    site_id: str = Field(min_length=1)


class FixturePlanCase(StrictModel):
    case_id: str = Field(pattern=r"^synthetic-[a-z0-9-]+$")
    split: Split
    variant: Literal["clean", "fold_like", "mark_like"]


class FixturePlan(StrictModel):
    schema_version: Literal["1.0.0"]
    seed: int = Field(ge=0)
    width: int = Field(ge=32, le=512)
    height: int = Field(ge=32, le=512)
    cases: list[FixturePlanCase] = Field(min_length=3)

    @model_validator(mode="after")
    def require_unique_cases_and_all_splits(self) -> Self:
        ids = [case.case_id for case in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError("fixture case IDs must be unique")
        if {case.split for case in self.cases} != set(Split):
            raise ValueError("fixture plan must contain train, validation, and test cases")
        return self


NucleusClass = Literal["synthetic_type_a", "synthetic_type_b"]


class NucleusTruth(StrictModel):
    instance_id: int = Field(gt=0)
    class_name: NucleusClass


class FixtureItem(StrictModel):
    item_id: str = Field(pattern=r"^synthetic-[a-z0-9-]+$")
    split: Split
    synthetic: Literal[True]
    image_path: str
    tissue_mask_path: str
    artifact_mask_path: str
    nucleus_instance_mask_path: str
    nucleus_truth: list[NucleusTruth]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    microns_per_pixel_x: float = Field(gt=0)
    microns_per_pixel_y: float = Field(gt=0)
    leakage: LeakageKeys


class FixtureManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    dataset_id: Literal["pathologize-synthetic-contract-fixtures-v1"]
    intended_use: Literal["contract_and_pipeline_tests_only"]
    clinical_validity: Literal[False]
    seed: int = Field(ge=0)
    items: list[FixtureItem] = Field(min_length=1)


class RegistryAnnotation(StrictModel):
    kind: Literal["tissue_mask", "artifact_mask", "nucleus_instances", "nucleus_classes"]
    uri: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class RegistryItem(StrictModel):
    item_id: str = Field(min_length=1)
    split: Split
    image_uri: str = Field(min_length=1)
    image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    microns_per_pixel_x: float = Field(gt=0)
    microns_per_pixel_y: float = Field(gt=0)
    leakage: LeakageKeys
    annotations: list[RegistryAnnotation]


class RegistryExport(StrictModel):
    contract: Literal["pathologize.data-registry-export/v1"]
    registry_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    items: list[RegistryItem] = Field(min_length=1)


class SyntheticSource(StrictModel):
    kind: Literal["synthetic_fixture"]
    fixture_manifest: str
    dataset_id: Literal["pathologize-synthetic-contract-fixtures-v1"]


class RegistrySource(StrictModel):
    kind: Literal["pathologize_registry"]
    contract: Literal["pathologize.data-registry-export/v1"]
    registry_uri: str = Field(min_length=1)
    revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    export_manifest: str
    export_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    copy_raw_data: Literal[False]


DataSource = Annotated[SyntheticSource | RegistrySource, Field(discriminator="kind")]


class SplitPolicy(StrictModel):
    evaluation_split: Literal[Split.TEST]
    leakage_units: list[LeakageUnit] = Field(min_length=1)

    @model_validator(mode="after")
    def require_core_pathology_units(self) -> Self:
        required = {
            LeakageUnit.SUBJECT,
            LeakageUnit.SPECIMEN,
            LeakageUnit.BLOCK,
            LeakageUnit.SLIDE,
        }
        if not required.issubset(self.leakage_units):
            raise ValueError("leakage units must include subject, specimen, block, and slide")
        if len(self.leakage_units) != len(set(self.leakage_units)):
            raise ValueError("leakage units must be unique")
        return self


class AdapterSpec(StrictModel):
    adapter_id: str = Field(pattern=r"^[a-z0-9][a-z0-9._-]+$")
    kind: Literal["builtin", "python_entrypoint"]
    entrypoint: str = Field(min_length=1)
    version: str = Field(min_length=1)
    artifact_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    paid_api_calls_allowed: Literal[False]

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
    max_paid_api_calls: Literal[0]


class SuperResolutionSeam(StrictModel):
    enabled: Literal[False]
    status: Literal["future_evaluation_only"]
    source_pixels_preserved: Literal[True]
    synthetic_detail_claims_forbidden: Literal[True]
    separate_native_resolution_scorecard_required: Literal[True]


class ExperimentManifest(StrictModel):
    schema_version: Literal["1.0.0"]
    experiment_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    workstream: Workstream
    purpose: str = Field(min_length=1)
    clinical_validity_claimed: Literal[False]
    random_seed: int = Field(ge=0)
    data_source: DataSource
    split_policy: SplitPolicy
    baseline: AdapterSpec
    candidate: AdapterSpec | None
    objectives: list[MetricObjective] = Field(min_length=1)
    resource_budget: ResourceBudget
    super_resolution: SuperResolutionSeam
    parameters: dict[str, int | float | str | bool]

    @model_validator(mode="after")
    def require_unique_metrics_and_adapters(self) -> Self:
        names = [objective.metric for objective in self.objectives]
        if len(names) != len(set(names)):
            raise ValueError("objective metric names must be unique")
        if self.candidate and self.candidate.adapter_id == self.baseline.adapter_id:
            raise ValueError("candidate adapter must differ from baseline adapter")
        return self


class QualityPrediction(StrictModel):
    workstream: Literal[Workstream.SLIDE_QUALITY]
    item_id: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    tissue_labels: list[int]
    artifact_labels: list[int]
    reject_slide: bool


class TilePrediction(StrictModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class TilingPrediction(StrictModel):
    workstream: Literal[Workstream.TILING_POLICY]
    item_id: str
    target_microns_per_pixel: float = Field(gt=0)
    tiles: list[TilePrediction]


class NucleusPrediction(StrictModel):
    instance_id: int = Field(gt=0)
    class_name: NucleusClass
    pixels: list[int] = Field(min_length=1)


class NucleiPrediction(StrictModel):
    workstream: Literal[Workstream.NUCLEI]
    item_id: str
    instances: list[NucleusPrediction]


Prediction = QualityPrediction | TilingPrediction | NucleiPrediction


class ResourceUsage(StrictModel):
    samples: int = Field(ge=0)
    input_bytes: int = Field(ge=0)
    prediction_bytes: int = Field(ge=0)
    pixels_read: int = Field(ge=0)
    accelerator_seconds: float = Field(ge=0)
    paid_api_calls: Literal[0]
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


class Scorecard(StrictModel):
    schema_version: Literal["1.0.0"]
    scorecard_id: str = Field(pattern=r"^scorecard:sha256:[a-f0-9]{64}$")
    experiment_id: str
    workstream: Workstream
    data_source_kind: Literal["synthetic_fixture", "pathologize_registry"]
    synthetic_evidence_only: bool
    baseline: RunSummary
    candidate: RunSummary | None
    gates: list[GateResult]
    recommendation: Literal["baseline_only", "promote_candidate", "reject_candidate"]
    clinical_validity: Literal[False]


class AggregateScorecard(StrictModel):
    schema_version: Literal["1.0.0"]
    benchmark_id: str = Field(pattern=r"^benchmark:sha256:[a-f0-9]{64}$")
    scorecards: list[Scorecard] = Field(min_length=1)
    clinical_validity: Literal[False]


SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "experiment-manifest.schema.json": ExperimentManifest,
    "fixture-manifest.schema.json": FixtureManifest,
    "pathologize-registry-export.schema.json": RegistryExport,
    "scorecard.schema.json": Scorecard,
    "aggregate-scorecard.schema.json": AggregateScorecard,
}


def require_relative_path(path: str) -> str:
    candidate = Path(path)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("path must be project-relative without parent traversal")
    return path
