from __future__ import annotations

import math
from enum import StrEnum
from typing import Annotated, Literal, Self

from ml_evaluation.contracts import (
    SHA256_PATTERN,
    AdapterSpec,
    ArtifactReference,
    FailureReport,
    GateResult,
    MetricObjective,
    MetricResult,
    ResourceBudget,
    ResourceUsage,
    RunRecord,
    Split,
    StrictModel,
)
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Workstream(StrEnum):
    SLIDE_QUALITY = "whole_slide_tissue_artifact_quality"
    TILING_POLICY = "tiling_magnification_policy"
    NUCLEI = "nucleus_detection_segmentation_classification"


class BenchmarkProject(StrictModel):
    schema_version: Literal["1.0.0"]
    benchmark_id: str = Field(pattern=r"^pathologize\.[a-z0-9-]+/v[0-9]+$")
    workstream: Workstream
    experiments: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_experiment_paths(self) -> Self:
        if len(self.experiments) != len(set(self.experiments)):
            raise ValueError("experiment paths must be unique")
        return self


class LeakageUnit(StrEnum):
    SUBJECT = "subject_id"
    SPECIMEN = "specimen_id"
    BLOCK = "block_id"
    SLIDE = "slide_id"
    ACQUISITION = "acquisition_id"
    SITE = "site_id"
    SCANNER = "scanner_id"


class LeakageKeys(StrictModel):
    subject_id: str = Field(min_length=1)
    specimen_id: str = Field(min_length=1)
    block_id: str = Field(min_length=1)
    slide_id: str = Field(min_length=1)
    acquisition_id: str = Field(min_length=1)
    site_id: str = Field(min_length=1)
    scanner_id: str = Field(min_length=1)
    stain_protocol_id: str = Field(min_length=1)


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
        test_variants = {case.variant for case in self.cases if case.split == Split.TEST}
        if test_variants != {"clean", "fold_like", "mark_like"}:
            raise ValueError(
                "fixture test split must contain clean, fold-like, and mark-like cases"
            )
        return self


NucleusClass = Literal["synthetic_type_a", "synthetic_type_b"]


class NucleusTruth(StrictModel):
    instance_id: int = Field(gt=0)
    class_name: NucleusClass


class FixtureItem(StrictModel):
    item_id: str = Field(pattern=r"^synthetic-[a-z0-9-]+$")
    split: Split
    variant: Literal["clean", "fold_like", "mark_like"]
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

    @model_validator(mode="after")
    def require_unique_items(self) -> Self:
        item_ids = [item.item_id for item in self.items]
        if len(item_ids) != len(set(item_ids)):
            raise ValueError("fixture item IDs must be unique")
        return self


class RegistryExport(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)

    context: dict[str, object] = Field(alias="@context")
    dataset_type: Literal["sc:Dataset"] = Field(alias="@type")
    name: str = Field(min_length=1)
    conforms_to: Literal["http://mlcommons.org/croissant/1.1"] = Field(alias="conformsTo")
    contract: Literal["pathologize.data-registry-export/v1"] = Field(alias="pathologize:contract")
    registry_revision: str = Field(alias="pathologize:registryRevision", pattern=r"^[a-f0-9]{40}$")

    @model_validator(mode="after")
    def reject_downstream_policy(self) -> Self:
        extra = self.__pydantic_extra__ or {}
        forbidden = {"items", "provenance", "split", "leakage"}.intersection(extra)
        if forbidden:
            raise ValueError(
                "registry exports contain source metadata only; downstream fields found: "
                + ", ".join(sorted(forbidden))
            )

        return self


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
    export_sha256: str = Field(pattern=SHA256_PATTERN)
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
            LeakageUnit.ACQUISITION,
            LeakageUnit.SITE,
            LeakageUnit.SCANNER,
        }
        if not required.issubset(self.leakage_units):
            raise ValueError(
                "leakage units must include subject, specimen, block, slide, acquisition, site, "
                "and scanner"
            )
        if len(self.leakage_units) != len(set(self.leakage_units)):
            raise ValueError("leakage units must be unique")
        return self


class SuperResolutionSeam(StrictModel):
    enabled: Literal[False]
    status: Literal["future_evaluation_only"]
    source_pixels_preserved: Literal[True]
    synthetic_detail_claims_forbidden: Literal[True]
    separate_native_resolution_scorecard_required: Literal[True]


def _validate_tiling_parameters(parameters: dict[str, int | float | str | bool]) -> None:
    tile_size = parameters.get("tile_size")
    minimum_tissue = parameters.get("minimum_tissue_fraction")
    target_mpp = parameters.get("target_microns_per_pixel")
    if isinstance(tile_size, bool) or not isinstance(tile_size, int) or tile_size <= 0:
        raise ValueError("tile_size must be a positive integer")
    if (
        isinstance(minimum_tissue, bool)
        or not isinstance(minimum_tissue, (int, float))
        or not 0 <= minimum_tissue <= 1
    ):
        raise ValueError("minimum_tissue_fraction must be between zero and one")
    if (
        isinstance(target_mpp, bool)
        or not isinstance(target_mpp, (int, float))
        or not math.isfinite(target_mpp)
        or target_mpp <= 0
    ):
        raise ValueError("target_microns_per_pixel must be positive")


def _validate_nuclei_parameters(parameters: dict[str, int | float | str | bool]) -> None:
    match_iou = parameters.get("instance_match_iou")
    if (
        isinstance(match_iou, bool)
        or not isinstance(match_iou, (int, float))
        or not 0 <= match_iou <= 1
    ):
        raise ValueError("instance_match_iou must be between zero and one")


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
        roles = {objective.role for objective in self.objectives}
        if "robustness" not in roles:
            raise ValueError("every experiment requires a robustness objective")
        if (
            self.workstream in {Workstream.SLIDE_QUALITY, Workstream.NUCLEI}
            and "calibration" not in roles
        ):
            raise ValueError("classification experiments require a calibration objective")
        if self.workstream == Workstream.TILING_POLICY:
            _validate_tiling_parameters(self.parameters)
        if self.workstream == Workstream.NUCLEI:
            _validate_nuclei_parameters(self.parameters)
        return self


class QualityPrediction(StrictModel):
    workstream: Literal[Workstream.SLIDE_QUALITY]
    item_id: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    tissue_labels: list[int]
    artifact_labels: list[int]
    reject_slide: bool
    reject_probability: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def require_consistent_rejection(self) -> Self:
        if self.reject_slide != (self.reject_probability >= 0.5):
            raise ValueError("slide rejection must match its probability threshold")
        return self


class TilePrediction(StrictModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class TilingPrediction(StrictModel):
    workstream: Literal[Workstream.TILING_POLICY]
    item_id: str
    target_microns_per_pixel: float = Field(gt=0)
    source_microns_per_pixel_x: float = Field(gt=0)
    source_microns_per_pixel_y: float = Field(gt=0)
    tiles: list[TilePrediction]


class NucleusPrediction(StrictModel):
    instance_id: int = Field(gt=0)
    class_name: NucleusClass
    type_a_probability: float = Field(ge=0, le=1)
    pixels: list[int] = Field(min_length=1)

    @model_validator(mode="after")
    def require_consistent_classification(self) -> Self:
        expected = "synthetic_type_a" if self.type_a_probability >= 0.5 else "synthetic_type_b"
        if self.class_name != expected:
            raise ValueError("nucleus class must match its probability threshold")
        return self


class NucleiPrediction(StrictModel):
    workstream: Literal[Workstream.NUCLEI]
    item_id: str
    instances: list[NucleusPrediction]


Prediction = QualityPrediction | TilingPrediction | NucleiPrediction


class EvaluationResult(StrictModel):
    schema_version: Literal["1.0.0"]
    evaluation_id: str = Field(pattern=r"^evaluation:sha256:[a-f0-9]{64}$")
    experiment_id: str
    workstream: Workstream
    adapter_id: str
    adapter_version: str
    data_source_kind: Literal["synthetic_fixture", "pathologize_registry"]
    experiment_manifest: ArtifactReference
    data_manifest: ArtifactReference
    predictions: ArtifactReference
    metrics: list[MetricResult] = Field(min_length=1)
    clinical_validity: Literal[False]

    @model_validator(mode="after")
    def require_unique_metrics(self) -> Self:
        names = [metric.metric for metric in self.metrics]
        if len(names) != len(set(names)):
            raise ValueError("evaluation metric names must be unique")
        return self


class ComparisonInput(StrictModel):
    adapter_id: str
    run_id: str = Field(pattern=r"^run:sha256:[a-f0-9]{64}$")
    evaluation_id: str = Field(pattern=r"^evaluation:sha256:[a-f0-9]{64}$")


class ComparisonScorecard(StrictModel):
    schema_version: Literal["1.0.0"]
    scorecard_id: str = Field(pattern=r"^scorecard:sha256:[a-f0-9]{64}$")
    experiment_id: str
    workstream: Workstream
    data_source_kind: Literal["synthetic_fixture", "pathologize_registry"]
    synthetic_evidence_only: bool
    baseline: ComparisonInput
    candidate: ComparisonInput | None
    gates: list[GateResult]
    recommendation: Literal["baseline_only", "promote_candidate", "reject_candidate"]
    clinical_validity: Literal[False]

    @model_validator(mode="after")
    def require_synthetic_evidence_label(self) -> Self:
        if self.data_source_kind == "synthetic_fixture" and not self.synthetic_evidence_only:
            raise ValueError("synthetic fixtures require synthetic evidence only")
        if self.candidate is None and self.recommendation != "baseline_only":
            raise ValueError("baseline-only comparisons require a baseline-only recommendation")
        if self.candidate is not None and self.recommendation == "baseline_only":
            raise ValueError("candidate comparisons require a candidate recommendation")
        if self.candidate is not None:
            expected = (
                "promote_candidate"
                if all(gate.passed for gate in self.gates)
                else "reject_candidate"
            )
            if self.recommendation != expected:
                raise ValueError("candidate recommendation must match the recorded gates")
        return self


class ScorecardReference(StrictModel):
    experiment_id: str
    scorecard_id: str = Field(pattern=r"^scorecard:sha256:[a-f0-9]{64}$")
    artifact: ArtifactReference


class BenchmarkIndex(StrictModel):
    schema_version: Literal["1.0.0"]
    benchmark_id: str = Field(pattern=r"^benchmark:sha256:[a-f0-9]{64}$")
    scorecards: list[ScorecardReference] = Field(min_length=1)
    clinical_validity: Literal[False]

    @model_validator(mode="after")
    def require_unique_scorecards(self) -> Self:
        experiment_ids = [scorecard.experiment_id for scorecard in self.scorecards]
        scorecard_ids = [scorecard.scorecard_id for scorecard in self.scorecards]
        if len(experiment_ids) != len(set(experiment_ids)):
            raise ValueError("benchmark experiment references must be unique")
        if len(scorecard_ids) != len(set(scorecard_ids)):
            raise ValueError("benchmark scorecard references must be unique")
        return self


SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "benchmark-project.schema.json": BenchmarkProject,
    "experiment-manifest.schema.json": ExperimentManifest,
    "fixture-manifest.schema.json": FixtureManifest,
    "pathologize-registry-export.schema.json": RegistryExport,
    "resource-usage.schema.json": ResourceUsage,
    "failure-report.schema.json": FailureReport,
    "run-record.schema.json": RunRecord,
    "evaluation-result.schema.json": EvaluationResult,
    "comparison-scorecard.schema.json": ComparisonScorecard,
    "benchmark-index.schema.json": BenchmarkIndex,
}
