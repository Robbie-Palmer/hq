from __future__ import annotations

import hashlib
import inspect
import json
import math
import time
from itertools import pairwise
from pathlib import Path
from typing import Literal, Protocol

from pathologize_benchmark_contracts.synthetic import generate_fixtures

from .contracts import (
    AdapterOutput,
    AdapterResult,
    CaseFailure,
    CaseResult,
    DvcEvidence,
    ExpectedResponse,
    FailedCase,
    MonotonicityResult,
    PerturbationCase,
    ProducedTile,
    Provenance,
    StudyResult,
    StudySpec,
)

SPEC_PATH = Path("fixtures/mpp-perturbations.json")
RESULT_PATH = Path("outputs/perturbations/mpp-study.json")
VERIFICATION_PATH = Path("outputs/perturbations/verification.json")
TOLERANCE = 1e-9


class StudyStoppedError(ValueError):
    pass


class MetadataError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ScaleAdapter(Protocol):
    adapter_id: str

    def produce(self, spec: StudySpec, case: PerturbationCase) -> AdapterOutput: ...


class MetadataAwareAdapter:
    adapter_id = "metadata-aware-v1"

    def produce(self, spec: StudySpec, case: PerturbationCase) -> AdapterOutput:
        if case.declared_mpp_x is None or case.declared_mpp_y is None:
            raise MetadataError("missing_mpp", "both MPP axes are required")
        for axis, value in (("x", case.declared_mpp_x), ("y", case.declared_mpp_y)):
            if (
                not math.isfinite(value)
                or value < spec.plausible_mpp.minimum
                or value > spec.plausible_mpp.maximum
            ):
                raise MetadataError(
                    "implausible_mpp",
                    f"declared MPP {axis}={value} is outside the configured plausible range",
                )
        effective_x = case.declared_mpp_x * case.declared_pyramid_downsample
        effective_y = case.declared_mpp_y * case.declared_pyramid_downsample
        return AdapterOutput(
            source_width_pixels=max(1, round(spec.request.physical_width_microns / effective_x)),
            source_height_pixels=max(1, round(spec.request.physical_height_microns / effective_y)),
            output_width_pixels=spec.request.output_width_pixels,
            output_height_pixels=spec.request.output_height_pixels,
            reported_source_mpp_x=effective_x,
            reported_source_mpp_y=effective_y,
        )


class RequestedScaleEchoAdapter:
    adapter_id = "requested-scale-echo-v1"

    def produce(self, spec: StudySpec, case: PerturbationCase) -> AdapterOutput:
        del case
        return AdapterOutput(
            source_width_pixels=spec.request.output_width_pixels,
            source_height_pixels=spec.request.output_height_pixels,
            output_width_pixels=spec.request.output_width_pixels,
            output_height_pixels=spec.request.output_height_pixels,
            reported_source_mpp_x=spec.request.target_mpp_x,
            reported_source_mpp_y=spec.request.target_mpp_y,
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, value: object) -> None:
    payload = value.model_dump(mode="json") if isinstance(value, StudyResult) else value
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _pnm_dimensions(data: bytes) -> tuple[int, int]:
    tokens = data.split()
    if len(tokens) < 4 or tokens[0] not in {b"P2", b"P3"}:
        raise ValueError("unsupported source PNM fixture")
    channels = 3 if tokens[0] == b"P3" else 1
    width, height, maximum = (int(value) for value in tokens[1:4])
    if maximum <= 0 or len(tokens) - 4 != width * height * channels:
        raise ValueError("invalid source PNM fixture")
    return width, height


def _load_spec(root: Path) -> StudySpec:
    return StudySpec.model_validate_json((root / SPEC_PATH).read_text(encoding="utf-8"))


def _expected_error_code(response: ExpectedResponse) -> str | None:
    if response == ExpectedResponse.REJECT_MISSING_MPP:
        return "missing_mpp"
    if response == ExpectedResponse.REJECT_IMPLAUSIBLE_MPP:
        return "implausible_mpp"
    return None


def _case_magnitude(spec: StudySpec, case: PerturbationCase) -> float | None:
    if case.declared_mpp_x is None or case.declared_mpp_y is None:
        return None
    profile = spec.profile(case.geometry_profile)
    actual_x = profile.mpp_x * case.actual_pyramid_downsample
    actual_y = profile.mpp_y * case.actual_pyramid_downsample
    declared_x = case.declared_mpp_x * case.declared_pyramid_downsample
    declared_y = case.declared_mpp_y * case.declared_pyramid_downsample
    return max(abs(declared_x - actual_x) / actual_x, abs(declared_y - actual_y) / actual_y)


def _evaluate_output(
    spec: StudySpec, case: PerturbationCase, output: AdapterOutput
) -> tuple[ProducedTile, float]:
    profile = spec.profile(case.geometry_profile)
    actual_mpp_x = profile.mpp_x * case.actual_pyramid_downsample
    actual_mpp_y = profile.mpp_y * case.actual_pyramid_downsample
    coverage_x = output.source_width_pixels * actual_mpp_x
    coverage_y = output.source_height_pixels * actual_mpp_y
    error = max(
        abs(coverage_x - spec.request.physical_width_microns) / spec.request.physical_width_microns,
        abs(coverage_y - spec.request.physical_height_microns)
        / spec.request.physical_height_microns,
    )
    coverage_fraction = (coverage_x * coverage_y) / (
        profile.physical_width_microns * profile.physical_height_microns
    )
    return (
        ProducedTile(
            source_width_pixels=output.source_width_pixels,
            source_height_pixels=output.source_height_pixels,
            output_width_pixels=output.output_width_pixels,
            output_height_pixels=output.output_height_pixels,
            physical_coverage_microns_x=coverage_x,
            physical_coverage_microns_y=coverage_y,
            source_coverage_fraction=coverage_fraction,
        ),
        error,
    )


def _completed_case(
    spec: StudySpec,
    case: PerturbationCase,
    output: AdapterOutput,
    *,
    bytes_read: int,
    runtime_seconds: float,
    source_sha256: str,
) -> CaseResult:
    tile, error = _evaluate_output(spec, case, output)
    profile = spec.profile(case.geometry_profile)
    response_matched = (
        case.expected_response == ExpectedResponse.ACCEPT
        and tile.source_width_pixels == case.expected_source_width_pixels
        and tile.source_height_pixels == case.expected_source_height_pixels
        and case.expected_physical_scale_error is not None
        and math.isclose(error, case.expected_physical_scale_error, abs_tol=TOLERANCE)
    )
    failure = None
    if not response_matched:
        code = (
            "unexpected_result"
            if case.expected_response == ExpectedResponse.ACCEPT
            else "unexpected_acceptance"
        )
        failure = CaseFailure(
            code=code,
            message="adapter output did not match the machine-checkable expected response",
            expected=False,
        )
    return CaseResult(
        case_id=case.case_id,
        category=case.category,
        perturbation_magnitude=case.perturbation_magnitude,
        expected_response=case.expected_response,
        status="completed",
        response_matched=response_matched,
        trusted_source_mpp_x=profile.mpp_x * case.actual_pyramid_downsample,
        trusted_source_mpp_y=profile.mpp_y * case.actual_pyramid_downsample,
        presented_source_mpp_x=(
            case.declared_mpp_x * case.declared_pyramid_downsample
            if case.declared_mpp_x is not None
            else None
        ),
        presented_source_mpp_y=(
            case.declared_mpp_y * case.declared_pyramid_downsample
            if case.declared_mpp_y is not None
            else None
        ),
        actual_pyramid_downsample=case.actual_pyramid_downsample,
        declared_pyramid_downsample=case.declared_pyramid_downsample,
        physical_scale_error=error,
        produced_tile=tile,
        reported_source_mpp_x=output.reported_source_mpp_x,
        reported_source_mpp_y=output.reported_source_mpp_y,
        bytes_read=bytes_read,
        runtime_seconds=runtime_seconds,
        source_image_sha256=source_sha256,
        failure=failure,
    )


def _rejected_case(
    spec: StudySpec,
    case: PerturbationCase,
    error: MetadataError,
    *,
    bytes_read: int,
    runtime_seconds: float,
    source_sha256: str,
) -> CaseResult:
    expected_code = _expected_error_code(case.expected_response)
    response_matched = error.code == expected_code
    profile = spec.profile(case.geometry_profile)
    return CaseResult(
        case_id=case.case_id,
        category=case.category,
        perturbation_magnitude=case.perturbation_magnitude,
        expected_response=case.expected_response,
        status="rejected",
        response_matched=response_matched,
        trusted_source_mpp_x=profile.mpp_x * case.actual_pyramid_downsample,
        trusted_source_mpp_y=profile.mpp_y * case.actual_pyramid_downsample,
        presented_source_mpp_x=(
            case.declared_mpp_x * case.declared_pyramid_downsample
            if case.declared_mpp_x is not None
            else None
        ),
        presented_source_mpp_y=(
            case.declared_mpp_y * case.declared_pyramid_downsample
            if case.declared_mpp_y is not None
            else None
        ),
        actual_pyramid_downsample=case.actual_pyramid_downsample,
        declared_pyramid_downsample=case.declared_pyramid_downsample,
        physical_scale_error=None,
        produced_tile=None,
        bytes_read=bytes_read,
        runtime_seconds=runtime_seconds,
        source_image_sha256=source_sha256,
        failure=CaseFailure(code=error.code, message=str(error), expected=response_matched),
    )


def _run_case(
    root: Path,
    spec: StudySpec,
    case: PerturbationCase,
    adapter: ScaleAdapter,
    source_sha256: str,
) -> CaseResult:
    started = time.process_time_ns()
    image_path = root / spec.source.image_path
    image_bytes = image_path.read_bytes()
    width, height = _pnm_dimensions(image_bytes)
    profile = spec.profile(case.geometry_profile)
    if (width, height) != (profile.pixel_width, profile.pixel_height):
        raise ValueError(f"source dimensions differ from profile {profile.profile_id}")
    try:
        output = adapter.produce(spec, case)
    except MetadataError as error:
        runtime = (time.process_time_ns() - started) / 1_000_000_000
        return _rejected_case(
            spec,
            case,
            error,
            bytes_read=len(image_bytes),
            runtime_seconds=runtime,
            source_sha256=source_sha256,
        )
    runtime = (time.process_time_ns() - started) / 1_000_000_000
    return _completed_case(
        spec,
        case,
        output,
        bytes_read=len(image_bytes),
        runtime_seconds=runtime,
        source_sha256=source_sha256,
    )


def _monotonicity(spec: StudySpec, results: list[CaseResult]) -> list[MonotonicityResult]:
    by_id = {result.case_id: result for result in results}
    checks: list[MonotonicityResult] = []
    for check in spec.monotonicity_checks:
        selected = [by_id[case_id] for case_id in check.case_ids]
        magnitudes = [result.perturbation_magnitude for result in selected]
        errors = [result.physical_scale_error for result in selected]
        complete = all(value is not None for value in magnitudes + errors)
        numeric_magnitudes = [float(value) for value in magnitudes if value is not None]
        numeric_errors = [float(value) for value in errors if value is not None]
        increasing_magnitude = all(
            current < following for current, following in pairwise(numeric_magnitudes)
        )
        increasing_error = all(
            current < following for current, following in pairwise(numeric_errors)
        )
        checks.append(
            MonotonicityResult(
                check_id=check.check_id,
                case_ids=check.case_ids,
                perturbation_magnitudes=numeric_magnitudes,
                physical_scale_errors=numeric_errors,
                passed=complete and increasing_magnitude and increasing_error,
            )
        )
    return checks


def _adapter_result(
    root: Path,
    spec: StudySpec,
    adapter: ScaleAdapter,
    role: Literal["primary", "negative_control"],
    source_sha256: str,
) -> AdapterResult:
    started = time.process_time_ns()
    cases = [_run_case(root, spec, case, adapter, source_sha256) for case in spec.cases]
    monotonicity = _monotonicity(spec, cases)
    failures = [
        FailedCase(
            adapter_id=adapter.adapter_id,
            reference_id=result.case_id,
            code=result.failure.code,
            message=result.failure.message,
            expected=result.failure.expected,
        )
        for result in cases
        if result.failure is not None
    ]
    failures.extend(
        FailedCase(
            adapter_id=adapter.adapter_id,
            reference_id=check.check_id,
            code="non_monotonic_physical_scale_error",
            message="physical-scale error did not increase with perturbation magnitude",
            expected=role == "negative_control",
        )
        for check in monotonicity
        if not check.passed
    )
    passed = all(result.response_matched for result in cases) and all(
        check.passed for check in monotonicity
    )
    return AdapterResult(
        adapter_id=adapter.adapter_id,
        role=role,
        passed=passed,
        bytes_read=sum(result.bytes_read for result in cases),
        runtime_seconds=(time.process_time_ns() - started) / 1_000_000_000,
        cases=cases,
        monotonicity=monotonicity,
        failed_cases=failures,
    )


def _provenance(root: Path, spec: StudySpec) -> Provenance:
    fixture_plan = root / spec.source.fixture_plan
    if _sha256(fixture_plan) != spec.source.fixture_plan_sha256:
        raise ValueError("fixture plan SHA-256 differs from the perturbation specification")
    manifest_path = root / spec.source.fixture_manifest
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    item = next(
        (value for value in manifest["items"] if value["item_id"] == spec.source.fixture_case_id),
        None,
    )
    if item is None or item["image_path"] != spec.source.image_path:
        raise ValueError("fixture manifest does not contain the pinned perturbation source")
    generator_path_value = inspect.getsourcefile(generate_fixtures)
    if generator_path_value is None:
        raise ValueError("could not resolve the fixture generator module")
    generator_path = Path(generator_path_value)
    return Provenance(
        source_kind=spec.source.kind,
        synthetic=spec.source.synthetic,
        bounded_item_count=1,
        clinical_validity=spec.source.clinical_validity,
        fixture_case_id=spec.source.fixture_case_id,
        fixture_plan=spec.source.fixture_plan,
        fixture_plan_sha256=_sha256(fixture_plan),
        fixture_manifest=spec.source.fixture_manifest,
        fixture_manifest_sha256=_sha256(manifest_path),
        source_image=spec.source.image_path,
        source_image_sha256=_sha256(root / spec.source.image_path),
        generator_module="pathologize_benchmark_contracts.synthetic:generate_fixtures",
        generator_sha256=_sha256(generator_path),
        derivation=spec.source.derivation,
    )


def _validate_spec_expectations(spec: StudySpec) -> None:
    for case in spec.cases:
        observed = _case_magnitude(spec, case)
        expected = case.perturbation_magnitude
        if observed is None or expected is None:
            if observed != expected:
                raise ValueError(f"perturbation magnitude differs for {case.case_id}")
        elif not math.isclose(observed, expected, abs_tol=TOLERANCE):
            raise ValueError(f"perturbation magnitude differs for {case.case_id}")


def run_study(
    root: Path | None = None,
    *,
    primary_adapter: ScaleAdapter | None = None,
) -> StudyResult:
    root = (root or Path.cwd()).resolve()
    spec = _load_spec(root)
    _validate_spec_expectations(spec)
    provenance = _provenance(root, spec)
    primary = _adapter_result(
        root,
        spec,
        primary_adapter or MetadataAwareAdapter(),
        "primary",
        provenance.source_image_sha256,
    )
    control = _adapter_result(
        root,
        spec,
        RequestedScaleEchoAdapter(),
        "negative_control",
        provenance.source_image_sha256,
    )
    echo_rejected = not control.passed and any(not check.passed for check in control.monotonicity)
    status = "passed" if primary.passed and echo_rejected else "stopped"
    result = StudyResult(
        schema_version="1.0.0",
        study_id=spec.study_id,
        status=status,
        seed=spec.seed,
        provenance=provenance,
        request=spec.request,
        adapters=[primary, control],
        echo_control_rejected=echo_rejected,
        failed_cases=primary.failed_cases + control.failed_cases,
        dvc=DvcEvidence(
            lockfile="dvc.lock",
            run_stage="run_mpp_perturbation_study",
            verification_stage="verify_mpp_perturbation_study",
        ),
    )
    _write_json(root / RESULT_PATH, result)
    if status == "stopped":
        raise StudyStoppedError(
            "physical-scale study stopped because the primary metric was not responsive or the "
            "scale-echo control was not rejected"
        )
    return result


def _verify_provenance(root: Path, result: StudyResult) -> None:
    paths = {
        result.provenance.fixture_plan: result.provenance.fixture_plan_sha256,
        result.provenance.fixture_manifest: result.provenance.fixture_manifest_sha256,
        result.provenance.source_image: result.provenance.source_image_sha256,
    }
    for relative, expected in paths.items():
        if _sha256(root / relative) != expected:
            raise ValueError(f"provenance SHA-256 differs for {relative}")


def verify_study(root: Path | None = None, *, write_report: bool = False) -> dict[str, object]:
    root = (root or Path.cwd()).resolve()
    result = StudyResult.model_validate_json((root / RESULT_PATH).read_text(encoding="utf-8"))
    spec = _load_spec(root)
    _validate_spec_expectations(spec)
    _verify_provenance(root, result)
    primary = next(adapter for adapter in result.adapters if adapter.role == "primary")
    control = next(adapter for adapter in result.adapters if adapter.role == "negative_control")
    if result.status != "passed" or not primary.passed:
        raise ValueError("primary physical-scale study did not pass")
    if not result.echo_control_rejected or control.passed:
        raise ValueError("requested-scale echo control was not rejected")
    if not all(check.passed for check in primary.monotonicity):
        raise ValueError("primary physical-scale error is not monotonic")
    if not any(not check.passed for check in control.monotonicity):
        raise ValueError("echo control did not expose a non-responsive scale metric")
    case_ids = {case.case_id for case in spec.cases}
    if {case.case_id for case in primary.cases} != case_ids:
        raise ValueError("study result case set differs from the perturbation specification")
    report: dict[str, object] = {
        "schema_version": "1.0.0",
        "study_id": result.study_id,
        "status": "verified",
        "primary_adapter": primary.adapter_id,
        "case_count": len(primary.cases),
        "failed_case_count": len(result.failed_cases),
        "echo_control_rejected": True,
        "dvc_lockfile": result.dvc.lockfile,
    }
    if write_report:
        _write_json(root / VERIFICATION_PATH, report)
    return report
