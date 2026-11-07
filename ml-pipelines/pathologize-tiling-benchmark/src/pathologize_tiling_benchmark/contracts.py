from __future__ import annotations

import math
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

IDENTIFIER_PATTERN = r"^[a-z0-9][a-z0-9-]+$"
SHA256_PATTERN = r"^[a-f0-9]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ExpectedResponse(StrEnum):
    ACCEPT_ZERO_ERROR = "accept_zero_error"
    ACCEPT_POSITIVE_ERROR = "accept_positive_error"
    REJECT_MISSING_MPP = "reject_missing_mpp"
    REJECT_IMPLAUSIBLE_MPP = "reject_implausible_mpp"


class PyramidLevel(StrictModel):
    level: int = Field(ge=0)
    downsample: float = Field(gt=0)


class RegistrySlide(StrictModel):
    source_id: Literal["cptac-coad-isotropic"]
    kind: Literal["registry_slide"]
    registry_root: str
    collection_id: str
    subset_id: str
    slide_id: str
    asset_root: str
    source_instance_path: str
    slide_record: str
    asset_manifest: str
    source_instance_sha256: str = Field(pattern=SHA256_PATTERN)
    total_asset_bytes: int = Field(gt=0)
    trusted_mpp_x: float = Field(gt=0)
    trusted_mpp_y: float = Field(gt=0)
    expected_vendor: str
    levels: list[PyramidLevel] = Field(min_length=3)

    def level_downsample(self, level: int) -> float:
        return next(item.downsample for item in self.levels if item.level == level)


class DerivedSource(StrictModel):
    source_id: Literal["cptac-coad-anisotropic-region"]
    kind: Literal["derived_region"]
    image_path: str
    manifest_path: str
    trusted_mpp_x: float = Field(gt=0)
    trusted_mpp_y: float = Field(gt=0)
    source_level: Literal[0]
    source_location_level_zero: tuple[int, int]
    initial_size: tuple[int, int]
    derived_size: tuple[int, int]
    derivation: Literal["halve_rows_preserve_physical_extent"]


class TileRequest(StrictModel):
    location_level_zero: tuple[int, int]
    output_size: tuple[int, int]
    target_mpp_x: float = Field(gt=0)
    target_mpp_y: float = Field(gt=0)

    @property
    def physical_width_microns(self) -> float:
        return self.output_size[0] * self.target_mpp_x

    @property
    def physical_height_microns(self) -> float:
        return self.output_size[1] * self.target_mpp_y


class PerturbationCase(StrictModel):
    case_id: str = Field(pattern=IDENTIFIER_PATTERN)
    category: Literal[
        "isotropic_pixels",
        "anisotropic_pixels",
        "absent_mpp",
        "implausible_mpp",
        "wrong_pyramid_level",
        "corrupted_metadata",
    ]
    source_id: str
    level: int = Field(ge=0)
    declared_mpp_x: float | None
    declared_mpp_y: float | None
    declared_level_downsample: float = Field(gt=0)
    metadata_corruption: str | None
    perturbation_magnitude: float | None = Field(ge=0)
    expected_response: ExpectedResponse


class MonotonicityCheck(StrictModel):
    check_id: str = Field(pattern=IDENTIFIER_PATTERN)
    case_ids: list[str] = Field(min_length=3)


class ExperimentSpec(StrictModel):
    schema_version: Literal["2.0.0"]
    experiment_id: Literal["pathologize.tiling-mpp-perturbation/v2"]
    seed: int = Field(ge=0)
    registry_source: RegistrySlide
    derived_source: DerivedSource
    request: TileRequest
    plausible_mpp: tuple[float, float]
    cases: list[PerturbationCase] = Field(min_length=10)
    monotonicity_checks: list[MonotonicityCheck] = Field(min_length=2)

    @model_validator(mode="after")
    def require_complete_design(self) -> Self:
        case_ids = [case.case_id for case in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("perturbation case IDs must be unique")
        source_ids = {self.registry_source.source_id, self.derived_source.source_id}
        if {case.source_id for case in self.cases} - source_ids:
            raise ValueError("case references an unknown source")
        required = {
            "isotropic_pixels",
            "anisotropic_pixels",
            "absent_mpp",
            "implausible_mpp",
            "wrong_pyramid_level",
            "corrupted_metadata",
        }
        if {case.category for case in self.cases} != required:
            raise ValueError("experiment must cover every required perturbation category")
        for check in self.monotonicity_checks:
            if len(check.case_ids) != len(set(check.case_ids)):
                raise ValueError(f"duplicate case in {check.check_id}")
            if set(check.case_ids) - set(case_ids):
                raise ValueError(f"unknown case in {check.check_id}")
        minimum, maximum = self.plausible_mpp
        if minimum <= 0 or minimum >= maximum:
            raise ValueError("plausible MPP bounds must be positive and ordered")
        return self

    def trusted_scale(self, case: PerturbationCase) -> tuple[float, float, float]:
        if case.source_id == self.registry_source.source_id:
            return (
                self.registry_source.trusted_mpp_x,
                self.registry_source.trusted_mpp_y,
                self.registry_source.level_downsample(case.level),
            )
        if case.level != 0:
            raise ValueError("derived raster cases only support level zero")
        return self.derived_source.trusted_mpp_x, self.derived_source.trusted_mpp_y, 1.0


class TileEvidence(StrictModel):
    source_dimensions: tuple[int, int]
    output_dimensions: tuple[int, int]
    physical_coverage_microns: tuple[float, float]
    coverage_fraction_of_request: float = Field(gt=0)
    decoded_bytes_read: int = Field(gt=0)
    output_path: str
    output_sha256: str = Field(pattern=SHA256_PATTERN)


class FailureEvidence(StrictModel):
    adapter_id: str
    reference_id: str
    code: str
    message: str
    expected: bool


class CaseResult(StrictModel):
    case_id: str
    category: str
    source_id: str
    level: int
    expected_response: ExpectedResponse
    perturbation_magnitude: float | None
    trusted_effective_mpp: tuple[float, float]
    presented_effective_mpp: tuple[float, float] | None
    physical_scale_error: float | None = Field(ge=0)
    runtime_seconds: float = Field(ge=0)
    response_matched: bool
    tile: TileEvidence | None
    failure: FailureEvidence | None


class MonotonicityResult(StrictModel):
    check_id: str
    case_ids: list[str]
    perturbation_magnitudes: list[float]
    physical_scale_errors: list[float]
    passed: bool


class AdapterResult(StrictModel):
    adapter_id: str
    role: Literal["primary", "negative_control"]
    passed: bool
    runtime_seconds: float = Field(ge=0)
    decoded_bytes_read: int = Field(ge=0)
    cases: list[CaseResult]
    monotonicity: list[MonotonicityResult]


class Provenance(StrictModel):
    collection_id: str
    subset_id: str
    slide_id: str
    source_instance_path: str
    source_instance_sha256: str = Field(pattern=SHA256_PATTERN)
    total_asset_bytes: int = Field(gt=0)
    slide_record: str
    slide_record_sha256: str = Field(pattern=SHA256_PATTERN)
    asset_manifest: str
    asset_manifest_sha256: str = Field(pattern=SHA256_PATTERN)
    openslide_vendor: str
    observed_mpp: tuple[float, float]
    observed_level_downsamples: list[float]
    derived_manifest: str
    derived_manifest_sha256: str = Field(pattern=SHA256_PATTERN)
    tiler_package_source_sha256: str = Field(pattern=SHA256_PATTERN)


class DvcEvidence(StrictModel):
    lockfile: Literal["dvc.lock"]
    prepare_stage: Literal["prepare_mpp_experiment_inputs"]
    run_stage: Literal["run_mpp_perturbation_experiment"]
    verification_stage: Literal["verify_mpp_perturbation_experiment"]


class ExperimentResult(StrictModel):
    schema_version: Literal["2.0.0"]
    experiment_id: Literal["pathologize.tiling-mpp-perturbation/v2"]
    status: Literal["passed", "stopped"]
    seed: int
    hypothesis: str
    provenance: Provenance
    request: TileRequest
    adapters: list[AdapterResult]
    echo_control_rejected: bool
    failed_cases: list[FailureEvidence]
    dvc: DvcEvidence

    @model_validator(mode="after")
    def require_finite_errors(self) -> Self:
        errors = [
            case.physical_scale_error
            for adapter in self.adapters
            for case in adapter.cases
            if case.physical_scale_error is not None
        ]
        if not all(math.isfinite(value) for value in errors):
            raise ValueError("physical-scale errors must be finite")
        return self
