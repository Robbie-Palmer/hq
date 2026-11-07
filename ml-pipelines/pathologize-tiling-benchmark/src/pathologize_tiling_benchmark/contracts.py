from __future__ import annotations

import math
from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ExpectedResponse(StrEnum):
    ACCEPT = "accept"
    REJECT_MISSING_MPP = "reject_missing_mpp"
    REJECT_IMPLAUSIBLE_MPP = "reject_implausible_mpp"


class GeometryProfile(StrictModel):
    profile_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    pixel_width: int = Field(gt=0)
    pixel_height: int = Field(gt=0)
    physical_width_microns: float = Field(gt=0)
    physical_height_microns: float = Field(gt=0)

    @property
    def mpp_x(self) -> float:
        return self.physical_width_microns / self.pixel_width

    @property
    def mpp_y(self) -> float:
        return self.physical_height_microns / self.pixel_height


class FixtureSource(StrictModel):
    kind: Literal["checked_in_fixture_derivation"]
    synthetic: Literal[True]
    intended_use: Literal["physical_scale_contract_test_only"]
    clinical_validity: Literal[False]
    fixture_plan: str
    fixture_plan_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    fixture_manifest: str
    fixture_case_id: str
    image_path: str
    derivation: Literal["microns_per_pixel_axis=physical_extent_microns_axis/pixel_dimension_axis"]
    geometry_profiles: list[GeometryProfile] = Field(min_length=2)

    @model_validator(mode="after")
    def require_unique_profiles(self) -> Self:
        identifiers = [profile.profile_id for profile in self.geometry_profiles]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("geometry profile IDs must be unique")
        return self


class TileRequest(StrictModel):
    output_width_pixels: int = Field(gt=0)
    output_height_pixels: int = Field(gt=0)
    target_mpp_x: float = Field(gt=0)
    target_mpp_y: float = Field(gt=0)

    @property
    def physical_width_microns(self) -> float:
        return self.output_width_pixels * self.target_mpp_x

    @property
    def physical_height_microns(self) -> float:
        return self.output_height_pixels * self.target_mpp_y


class PlausibleMppRange(StrictModel):
    minimum: float = Field(gt=0)
    maximum: float = Field(gt=0)

    @model_validator(mode="after")
    def require_ordered_range(self) -> Self:
        if self.minimum >= self.maximum:
            raise ValueError("plausible MPP minimum must be below maximum")
        return self


class PerturbationCase(StrictModel):
    case_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    category: Literal[
        "isotropic_pixels",
        "anisotropic_pixels",
        "absent_mpp",
        "implausible_mpp",
        "wrong_pyramid_level",
        "corrupted_metadata",
    ]
    geometry_profile: str
    declared_mpp_x: float | None
    declared_mpp_y: float | None
    actual_pyramid_downsample: float = Field(gt=0)
    declared_pyramid_downsample: float = Field(gt=0)
    metadata_corruption: str | None = None
    perturbation_magnitude: float | None = Field(ge=0)
    expected_response: ExpectedResponse
    expected_source_width_pixels: int | None = Field(default=None, gt=0)
    expected_source_height_pixels: int | None = Field(default=None, gt=0)
    expected_physical_scale_error: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_expected_fields(self) -> Self:
        expected_values = (
            self.expected_source_width_pixels,
            self.expected_source_height_pixels,
            self.expected_physical_scale_error,
        )
        if self.expected_response == ExpectedResponse.ACCEPT and any(
            value is None for value in expected_values
        ):
            raise ValueError("accepted cases require expected dimensions and scale error")
        if self.expected_response != ExpectedResponse.ACCEPT and any(
            value is not None for value in expected_values
        ):
            raise ValueError("rejected cases cannot declare produced tile expectations")
        if self.expected_response == ExpectedResponse.REJECT_MISSING_MPP:
            if self.declared_mpp_x is not None or self.declared_mpp_y is not None:
                raise ValueError("missing-MPP cases must omit both axes")
            if self.perturbation_magnitude is not None:
                raise ValueError("missing-MPP cases have no numeric perturbation magnitude")
        return self


class MonotonicityCheck(StrictModel):
    check_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]+$")
    case_ids: list[str] = Field(min_length=3)


class StudySpec(StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: Literal["pathologize.tiling-mpp-perturbation/v1"]
    seed: int = Field(ge=0)
    source: FixtureSource
    request: TileRequest
    plausible_mpp: PlausibleMppRange
    cases: list[PerturbationCase] = Field(min_length=8)
    monotonicity_checks: list[MonotonicityCheck] = Field(min_length=2)

    @model_validator(mode="after")
    def require_consistent_references(self) -> Self:
        case_ids = [case.case_id for case in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("perturbation case IDs must be unique")
        profile_ids = {profile.profile_id for profile in self.source.geometry_profiles}
        missing_profiles = {case.geometry_profile for case in self.cases} - profile_ids
        if missing_profiles:
            raise ValueError(f"unknown geometry profiles: {sorted(missing_profiles)}")
        known_cases = set(case_ids)
        check_ids = [check.check_id for check in self.monotonicity_checks]
        if len(check_ids) != len(set(check_ids)):
            raise ValueError("monotonicity check IDs must be unique")
        for check in self.monotonicity_checks:
            if len(check.case_ids) != len(set(check.case_ids)):
                raise ValueError(f"duplicate case in monotonicity check {check.check_id}")
            unknown = set(check.case_ids) - known_cases
            if unknown:
                raise ValueError(f"unknown cases in {check.check_id}: {sorted(unknown)}")
        required_categories = {
            "isotropic_pixels",
            "anisotropic_pixels",
            "absent_mpp",
            "implausible_mpp",
            "wrong_pyramid_level",
            "corrupted_metadata",
        }
        observed_categories = {case.category for case in self.cases}
        if observed_categories != required_categories:
            raise ValueError("study cases must cover every required perturbation category")
        return self

    def profile(self, profile_id: str) -> GeometryProfile:
        return next(
            profile for profile in self.source.geometry_profiles if profile.profile_id == profile_id
        )


class AdapterOutput(StrictModel):
    source_width_pixels: int = Field(gt=0)
    source_height_pixels: int = Field(gt=0)
    output_width_pixels: int = Field(gt=0)
    output_height_pixels: int = Field(gt=0)
    reported_source_mpp_x: float = Field(gt=0)
    reported_source_mpp_y: float = Field(gt=0)


class ProducedTile(StrictModel):
    source_width_pixels: int = Field(gt=0)
    source_height_pixels: int = Field(gt=0)
    output_width_pixels: int = Field(gt=0)
    output_height_pixels: int = Field(gt=0)
    physical_coverage_microns_x: float = Field(gt=0)
    physical_coverage_microns_y: float = Field(gt=0)
    source_coverage_fraction: float = Field(gt=0)


class CaseFailure(StrictModel):
    code: str
    message: str
    expected: bool


class CaseResult(StrictModel):
    case_id: str
    category: str
    perturbation_magnitude: float | None
    expected_response: ExpectedResponse
    status: Literal["completed", "rejected"]
    response_matched: bool
    trusted_source_mpp_x: float = Field(gt=0)
    trusted_source_mpp_y: float = Field(gt=0)
    presented_source_mpp_x: float | None = Field(default=None, gt=0)
    presented_source_mpp_y: float | None = Field(default=None, gt=0)
    actual_pyramid_downsample: float = Field(gt=0)
    declared_pyramid_downsample: float = Field(gt=0)
    physical_scale_error: float | None = Field(ge=0)
    produced_tile: ProducedTile | None
    reported_source_mpp_x: float | None = Field(default=None, gt=0)
    reported_source_mpp_y: float | None = Field(default=None, gt=0)
    bytes_read: int = Field(ge=0)
    runtime_seconds: float = Field(ge=0)
    source_image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    failure: CaseFailure | None


class MonotonicityResult(StrictModel):
    check_id: str
    case_ids: list[str]
    perturbation_magnitudes: list[float]
    physical_scale_errors: list[float]
    passed: bool


class FailedCase(StrictModel):
    adapter_id: str
    reference_id: str
    code: str
    message: str
    expected: bool


class AdapterResult(StrictModel):
    adapter_id: str
    role: Literal["primary", "negative_control"]
    passed: bool
    bytes_read: int = Field(ge=0)
    runtime_seconds: float = Field(ge=0)
    cases: list[CaseResult]
    monotonicity: list[MonotonicityResult]
    failed_cases: list[FailedCase]


class Provenance(StrictModel):
    source_kind: Literal["checked_in_fixture_derivation"]
    synthetic: Literal[True]
    bounded_item_count: Literal[1]
    clinical_validity: Literal[False]
    fixture_case_id: str
    fixture_plan: str
    fixture_plan_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    fixture_manifest: str
    fixture_manifest_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_image: str
    source_image_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    generator_module: str
    generator_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    derivation: str


class DvcEvidence(StrictModel):
    lockfile: Literal["dvc.lock"]
    run_stage: Literal["run_mpp_perturbation_study"]
    verification_stage: Literal["verify_mpp_perturbation_study"]


class StudyResult(StrictModel):
    schema_version: Literal["1.0.0"]
    study_id: Literal["pathologize.tiling-mpp-perturbation/v1"]
    status: Literal["passed", "stopped"]
    seed: int
    provenance: Provenance
    request: TileRequest
    adapters: list[AdapterResult]
    echo_control_rejected: bool
    failed_cases: list[FailedCase]
    dvc: DvcEvidence

    @model_validator(mode="after")
    def require_finite_results(self) -> Self:
        values = [
            result.physical_scale_error
            for adapter in self.adapters
            for result in adapter.cases
            if result.physical_scale_error is not None
        ]
        if not all(math.isfinite(value) for value in values):
            raise ValueError("physical-scale errors must be finite")
        return self
