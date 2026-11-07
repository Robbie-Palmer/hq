from __future__ import annotations

import hashlib
import json
import math
import os
import time
from itertools import pairwise
from pathlib import Path
from typing import Literal

from pathologize_tiler import (
    PhysicalTileRead,
    PhysicalTileRequest,
    ScaleMetadataError,
    SlideMetadata,
    SourceScale,
    inspect_slide,
    read_physical_tile,
    read_raster_physical_tile,
)
from PIL import Image

from .contracts import (
    AdapterResult,
    CaseResult,
    DvcEvidence,
    ExpectedResponse,
    ExperimentResult,
    ExperimentSpec,
    FailureEvidence,
    MonotonicityResult,
    PerturbationCase,
    Provenance,
    TileEvidence,
)

SPEC_PATH = Path("experiments/mpp-perturbation.json")
RESULT_PATH = Path("outputs/perturbations/mpp-experiment.json")
VERIFICATION_PATH = Path("outputs/perturbations/verification.json")
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
TOLERANCE = 1e-9


class ExperimentStoppedError(ValueError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_tree(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*.py")):
        digest.update(item.relative_to(path).as_posix().encode())
        digest.update(item.read_bytes())
    return digest.hexdigest()


def _write_json(path: Path, value: object) -> None:
    payload = value.model_dump(mode="json") if isinstance(value, ExperimentResult) else value
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _load_spec(root: Path) -> ExperimentSpec:
    return ExperimentSpec.model_validate_json((root / SPEC_PATH).read_text(encoding="utf-8"))


def _registry_root(root: Path, spec: ExperimentSpec) -> Path:
    configured = Path(spec.registry_source.registry_root)
    return configured if configured.is_absolute() else (root / configured).resolve()


def _source_paths(root: Path, spec: ExperimentSpec) -> tuple[Path, Path, Path]:
    registry = _registry_root(root, spec)
    source = registry / spec.registry_source.asset_root / spec.registry_source.source_instance_path
    record = registry / spec.registry_source.slide_record
    assets = registry / spec.registry_source.asset_manifest
    return source, record, assets


def _relative_path(root: Path, path: Path) -> str:
    return Path(os.path.relpath(path, root)).as_posix()


def _observed_mpp(metadata: SlideMetadata) -> tuple[float, float]:
    observed_x = metadata.microns_per_pixel_x
    observed_y = metadata.microns_per_pixel_y
    if observed_x is None or observed_y is None:
        raise ValueError("OpenSlide did not report both MPP axes")
    return observed_x, observed_y


def _validate_public_source(root: Path, spec: ExperimentSpec) -> tuple[Path, SlideMetadata]:
    source, record_path, assets_path = _source_paths(root, spec)
    if _sha256(source) != spec.registry_source.source_instance_sha256:
        raise ValueError("public source SHA-256 differs from the experiment specification")
    record = json.loads(record_path.read_text(encoding="utf-8"))
    resolution = record["physical_resolution"]
    if record["slide_id"] != spec.registry_source.slide_id:
        raise ValueError("registry slide identity differs from the experiment specification")
    if not math.isclose(
        resolution["micrometres_per_pixel_x"],
        spec.registry_source.reference_mpp_x,
        abs_tol=TOLERANCE,
    ) or not math.isclose(
        resolution["micrometres_per_pixel_y"],
        spec.registry_source.reference_mpp_y,
        abs_tol=TOLERANCE,
    ):
        raise ValueError("registry MPP differs from the experiment specification")
    assets = json.loads(assets_path.read_text(encoding="utf-8"))["assets"]
    if sum(asset["bytes"] for asset in assets) != spec.registry_source.total_asset_bytes:
        raise ValueError("registry asset bytes differ from the experiment specification")
    metadata = inspect_slide(source)
    if metadata.vendor != spec.registry_source.expected_vendor:
        raise ValueError("OpenSlide vendor differs from the experiment specification")
    observed_mpp = _observed_mpp(metadata)
    expected_mpp = (spec.registry_source.reference_mpp_x, spec.registry_source.reference_mpp_y)
    if not all(
        math.isclose(observed, expected, abs_tol=TOLERANCE)
        for observed, expected in zip(observed_mpp, expected_mpp, strict=True)
    ):
        raise ValueError("OpenSlide MPP differs from the pinned registry truth")
    expected_levels = [level.downsample for level in spec.registry_source.levels]
    if len(metadata.level_downsamples) != len(expected_levels) or not all(
        math.isclose(observed, expected, abs_tol=TOLERANCE)
        for observed, expected in zip(metadata.level_downsamples, expected_levels, strict=True)
    ):
        raise ValueError("OpenSlide pyramid differs from the experiment specification")
    return source, metadata


def prepare_inputs(root: Path | None = None) -> dict[str, object]:
    root = (root or Path.cwd()).resolve()
    spec = _load_spec(root)
    source, _ = _validate_public_source(root, spec)
    derived = spec.derived_source
    request = PhysicalTileRequest(
        location_level_zero=derived.source_location_level_zero,
        level=derived.source_level,
        output_size=derived.initial_size,
        target_microns_per_pixel=(
            spec.registry_source.reference_mpp_x,
            spec.registry_source.reference_mpp_y,
        ),
    )
    tile = read_physical_tile(source, request, plausible_mpp=spec.plausible_mpp)
    image_path = root / derived.image_path
    image_path.parent.mkdir(parents=True, exist_ok=True)
    with tile.image, tile.image.resize(derived.derived_size, Image.Resampling.LANCZOS) as image:
        image.save(image_path, format="PNG")
    manifest: dict[str, object] = {
        "schema_version": "1.0.0",
        "source_slide_id": spec.registry_source.slide_id,
        "source_instance_path": spec.registry_source.source_instance_path,
        "source_instance_sha256": spec.registry_source.source_instance_sha256,
        "source_location_level_zero": list(derived.source_location_level_zero),
        "source_level": derived.source_level,
        "initial_dimensions": list(derived.initial_size),
        "derived_dimensions": list(derived.derived_size),
        "reference_mpp_x": derived.reference_mpp_x,
        "reference_mpp_y": derived.reference_mpp_y,
        "derivation": derived.derivation,
        "decoded_bytes_read": tile.decoded_bytes_read,
        "derived_image": derived.image_path,
        "derived_image_sha256": _sha256(image_path),
    }
    _write_json(root / derived.manifest_path, manifest)
    return manifest


def _case_magnitude(spec: ExperimentSpec, case: PerturbationCase) -> float | None:
    if case.declared_mpp_x is None or case.declared_mpp_y is None:
        return None
    reference_x, reference_y, actual_downsample = spec.reference_scale(case)
    actual_x = reference_x * actual_downsample
    actual_y = reference_y * actual_downsample
    declared_x = case.declared_mpp_x * case.declared_level_downsample
    declared_y = case.declared_mpp_y * case.declared_level_downsample
    return max(abs(declared_x - actual_x) / actual_x, abs(declared_y - actual_y) / actual_y)


def _validate_design(spec: ExperimentSpec) -> None:
    for case in spec.cases:
        observed = _case_magnitude(spec, case)
        expected = case.perturbation_magnitude
        if observed is None or expected is None:
            if observed != expected:
                raise ValueError(f"perturbation magnitude differs for {case.case_id}")
        elif not math.isclose(observed, expected, abs_tol=TOLERANCE):
            raise ValueError(f"perturbation magnitude differs for {case.case_id}")


def _request(spec: ExperimentSpec, case: PerturbationCase) -> PhysicalTileRequest:
    location = (
        (0, 0)
        if case.source_id == spec.derived_source.source_id
        else spec.request.location_level_zero
    )
    return PhysicalTileRequest(
        location_level_zero=location,
        level=case.level,
        output_size=spec.request.output_size,
        target_microns_per_pixel=(spec.request.target_mpp_x, spec.request.target_mpp_y),
    )


def _read_case(
    root: Path,
    spec: ExperimentSpec,
    case: PerturbationCase,
    source_scale: SourceScale,
) -> PhysicalTileRead:
    request = _request(spec, case)
    if case.source_id == spec.registry_source.source_id:
        source, _, _ = _source_paths(root, spec)
        return read_physical_tile(
            source,
            request,
            source_scale=source_scale,
            plausible_mpp=spec.plausible_mpp,
        )
    return read_raster_physical_tile(
        root / spec.derived_source.image_path,
        request,
        source_scale=source_scale,
        plausible_mpp=spec.plausible_mpp,
    )


def _expected_error_code(response: ExpectedResponse) -> str | None:
    if response == ExpectedResponse.REJECT_MISSING_MPP:
        return "missing_mpp"
    if response == ExpectedResponse.REJECT_IMPLAUSIBLE_MPP:
        return "implausible_mpp"
    return None


def _failure(
    adapter_id: str,
    reference_id: str,
    code: str,
    message: str,
    *,
    expected: bool,
) -> FailureEvidence:
    return FailureEvidence(
        adapter_id=adapter_id,
        reference_id=reference_id,
        code=code,
        message=message,
        expected=expected,
    )


def _rejected_case(
    spec: ExperimentSpec,
    case: PerturbationCase,
    adapter_id: str,
    error: ScaleMetadataError,
    runtime_seconds: float,
) -> CaseResult:
    expected = error.code == _expected_error_code(case.expected_response)
    reference_x, reference_y, downsample = spec.reference_scale(case)
    failure = _failure(
        adapter_id,
        case.case_id,
        error.code,
        str(error),
        expected=expected,
    )
    return CaseResult(
        case_id=case.case_id,
        category=case.category,
        source_id=case.source_id,
        level=case.level,
        expected_response=case.expected_response,
        perturbation_magnitude=case.perturbation_magnitude,
        reference_effective_mpp=(reference_x * downsample, reference_y * downsample),
        presented_effective_mpp=None,
        physical_scale_error=None,
        runtime_seconds=runtime_seconds,
        response_matched=expected,
        tile=None,
        failure=failure,
    )


def _completed_case(
    root: Path,
    spec: ExperimentSpec,
    case: PerturbationCase,
    adapter_id: str,
    tile: PhysicalTileRead,
    runtime_seconds: float,
) -> CaseResult:
    reference_x, reference_y, actual_downsample = spec.reference_scale(case)
    effective_x = reference_x * actual_downsample
    effective_y = reference_y * actual_downsample
    coverage_x = tile.source_size[0] * effective_x
    coverage_y = tile.source_size[1] * effective_y
    error = max(
        abs(coverage_x - spec.request.physical_width_microns) / spec.request.physical_width_microns,
        abs(coverage_y - spec.request.physical_height_microns)
        / spec.request.physical_height_microns,
    )
    rounding_tolerance = max(
        effective_x / spec.request.physical_width_microns,
        effective_y / spec.request.physical_height_microns,
    )
    zero_expected = case.expected_response == ExpectedResponse.ACCEPT_ZERO_ERROR
    positive_expected = case.expected_response == ExpectedResponse.ACCEPT_POSITIVE_ERROR
    expected_size = (
        max(1, round(spec.request.physical_width_microns / tile.presented_microns_per_pixel[0])),
        max(1, round(spec.request.physical_height_microns / tile.presented_microns_per_pixel[1])),
    )
    response_matched = (
        tile.source_size == expected_size
        and tile.output_size == spec.request.output_size
        and (
            (zero_expected and error <= rounding_tolerance + TOLERANCE)
            or (positive_expected and error > rounding_tolerance + TOLERANCE)
        )
    )
    output_path = Path("outputs/perturbations/tiles") / adapter_id / f"{case.case_id}.png"
    absolute_output = root / output_path
    absolute_output.parent.mkdir(parents=True, exist_ok=True)
    with tile.image:
        tile.image.save(absolute_output, format="PNG")
    failure = None
    if not response_matched:
        failure = _failure(
            adapter_id,
            case.case_id,
            "unexpected_result",
            "tile dimensions or physical coverage did not match the case expectation",
            expected=False,
        )
    return CaseResult(
        case_id=case.case_id,
        category=case.category,
        source_id=case.source_id,
        level=case.level,
        expected_response=case.expected_response,
        perturbation_magnitude=case.perturbation_magnitude,
        reference_effective_mpp=(effective_x, effective_y),
        presented_effective_mpp=tile.presented_microns_per_pixel,
        physical_scale_error=error,
        runtime_seconds=runtime_seconds,
        response_matched=response_matched,
        tile=TileEvidence(
            source_dimensions=tile.source_size,
            output_dimensions=tile.output_size,
            physical_coverage_microns=(coverage_x, coverage_y),
            coverage_fraction_of_request=(coverage_x * coverage_y)
            / (spec.request.physical_width_microns * spec.request.physical_height_microns),
            decoded_bytes_read=tile.decoded_bytes_read,
            output_path=output_path.as_posix(),
            output_sha256=_sha256(absolute_output),
        ),
        failure=failure,
    )


def _run_case(
    root: Path,
    spec: ExperimentSpec,
    case: PerturbationCase,
    adapter_id: str,
    role: Literal["primary", "negative_control"],
) -> CaseResult:
    if role == "primary":
        scale = SourceScale(
            case.declared_mpp_x,
            case.declared_mpp_y,
            case.declared_level_downsample,
        )
    else:
        scale = SourceScale(
            spec.request.target_mpp_x,
            spec.request.target_mpp_y,
            1.0,
        )
    started = time.process_time_ns()
    try:
        tile = _read_case(root, spec, case, scale)
    except ScaleMetadataError as error:
        runtime = (time.process_time_ns() - started) / 1_000_000_000
        return _rejected_case(spec, case, adapter_id, error, runtime)
    runtime = (time.process_time_ns() - started) / 1_000_000_000
    return _completed_case(root, spec, case, adapter_id, tile, runtime)


def _monotonicity(spec: ExperimentSpec, results: list[CaseResult]) -> list[MonotonicityResult]:
    by_id = {result.case_id: result for result in results}
    checks: list[MonotonicityResult] = []
    for check in spec.monotonicity_checks:
        selected = [by_id[case_id] for case_id in check.case_ids]
        magnitudes = [case.perturbation_magnitude for case in selected]
        errors = [case.physical_scale_error for case in selected]
        complete = all(value is not None for value in magnitudes + errors)
        numeric_magnitudes = [float(value) for value in magnitudes if value is not None]
        numeric_errors = [float(value) for value in errors if value is not None]
        passed = (
            complete
            and all(current < following for current, following in pairwise(numeric_magnitudes))
            and all(current < following for current, following in pairwise(numeric_errors))
        )
        checks.append(
            MonotonicityResult(
                check_id=check.check_id,
                case_ids=check.case_ids,
                perturbation_magnitudes=numeric_magnitudes,
                physical_scale_errors=numeric_errors,
                passed=passed,
            )
        )
    return checks


def _adapter_result(
    root: Path,
    spec: ExperimentSpec,
    adapter_id: str,
    role: Literal["primary", "negative_control"],
) -> AdapterResult:
    started = time.process_time_ns()
    cases = [_run_case(root, spec, case, adapter_id, role) for case in spec.cases]
    monotonicity = _monotonicity(spec, cases)
    return AdapterResult(
        adapter_id=adapter_id,
        role=role,
        passed=all(case.response_matched for case in cases)
        and all(check.passed for check in monotonicity),
        runtime_seconds=(time.process_time_ns() - started) / 1_000_000_000,
        decoded_bytes_read=sum(
            case.tile.decoded_bytes_read for case in cases if case.tile is not None
        ),
        cases=cases,
        monotonicity=monotonicity,
    )


def _provenance(root: Path, spec: ExperimentSpec) -> Provenance:
    source, metadata = _validate_public_source(root, spec)
    _, record, assets = _source_paths(root, spec)
    derived_manifest = root / spec.derived_source.manifest_path
    return Provenance(
        collection_id=spec.registry_source.collection_id,
        subset_id=spec.registry_source.subset_id,
        slide_id=spec.registry_source.slide_id,
        source_instance_path=_relative_path(root, source),
        source_instance_sha256=_sha256(source),
        total_asset_bytes=spec.registry_source.total_asset_bytes,
        slide_record=_relative_path(root, record),
        slide_record_sha256=_sha256(record),
        asset_manifest=_relative_path(root, assets),
        asset_manifest_sha256=_sha256(assets),
        openslide_vendor=metadata.vendor or "",
        observed_mpp=_observed_mpp(metadata),
        observed_level_downsamples=list(metadata.level_downsamples),
        derived_manifest=spec.derived_source.manifest_path,
        derived_manifest_sha256=_sha256(derived_manifest),
        tiler_package_source_sha256=_sha256_tree(
            REPOSITORY_ROOT / "packages/pathologize-tiler/src/pathologize_tiler"
        ),
    )


def run_experiment(root: Path | None = None) -> ExperimentResult:
    root = (root or Path.cwd()).resolve()
    spec = _load_spec(root)
    _validate_design(spec)
    provenance = _provenance(root, spec)
    primary = _adapter_result(root, spec, "pathologize-tiler-v1", "primary")
    control = _adapter_result(root, spec, "requested-scale-echo-v1", "negative_control")
    echo_rejected = not control.passed and any(
        not check.passed
        for check in control.monotonicity
        if check.check_id == "isotropic-error-response"
    )
    status = "passed" if primary.passed and echo_rejected else "stopped"
    failures = [
        case.failure
        for adapter in (primary, control)
        for case in adapter.cases
        if case.failure is not None
    ]
    failures.extend(
        _failure(
            adapter.adapter_id,
            check.check_id,
            "non_monotonic_physical_scale_error",
            "physical-scale error did not increase with perturbation magnitude",
            expected=adapter.role == "negative_control",
        )
        for adapter in (primary, control)
        for check in adapter.monotonicity
        if not check.passed
    )
    result = ExperimentResult(
        schema_version="2.0.0",
        experiment_id=spec.experiment_id,
        status=status,
        seed=spec.seed,
        hypothesis=(
            "Increasing error in source MPP or pyramid metadata increases measured physical "
            "tile-coverage error when the tiler uses source metadata."
        ),
        provenance=provenance,
        request=spec.request,
        adapters=[primary, control],
        echo_control_rejected=echo_rejected,
        failed_cases=failures,
        dvc=DvcEvidence(
            lockfile="dvc.lock",
            prepare_stage="prepare_mpp_experiment_inputs",
            run_stage="run_mpp_perturbation_experiment",
            verification_stage="verify_mpp_perturbation_experiment",
        ),
    )
    _write_json(root / RESULT_PATH, result)
    if status == "stopped":
        raise ExperimentStoppedError(
            "experiment stopped because the primary metric was not monotonic or the echo "
            "control was not rejected"
        )
    return result


def verify_experiment(root: Path | None = None, *, write_report: bool = False) -> dict[str, object]:
    root = (root or Path.cwd()).resolve()
    result = ExperimentResult.model_validate_json((root / RESULT_PATH).read_text(encoding="utf-8"))
    spec = _load_spec(root)
    _validate_design(spec)
    if result.status != "passed" or not result.adapters[0].passed:
        raise ValueError("primary physical-scale experiment did not pass")
    if not result.echo_control_rejected or result.adapters[1].passed:
        raise ValueError("requested-scale echo control was not rejected")
    if _sha256(root / result.provenance.derived_manifest) != (
        result.provenance.derived_manifest_sha256
    ):
        raise ValueError("derived source provenance changed")
    source, record, assets = _source_paths(root, spec)
    for path, expected in (
        (source, result.provenance.source_instance_sha256),
        (record, result.provenance.slide_record_sha256),
        (assets, result.provenance.asset_manifest_sha256),
    ):
        if _sha256(path) != expected:
            raise ValueError(f"provenance SHA-256 differs for {path}")
    for adapter in result.adapters:
        for case in adapter.cases:
            if case.tile is not None and _sha256(root / case.tile.output_path) != (
                case.tile.output_sha256
            ):
                raise ValueError(f"tile SHA-256 differs for {case.case_id}")
    report: dict[str, object] = {
        "schema_version": "2.0.0",
        "experiment_id": result.experiment_id,
        "status": "verified",
        "primary_adapter": result.adapters[0].adapter_id,
        "case_count": len(result.adapters[0].cases),
        "primary_unexpected_failure_count": sum(
            not failure.expected and failure.adapter_id == result.adapters[0].adapter_id
            for failure in result.failed_cases
        ),
        "negative_control_failure_count": sum(
            failure.adapter_id == result.adapters[1].adapter_id for failure in result.failed_cases
        ),
        "echo_control_rejected": True,
        "source_asset_bytes": result.provenance.total_asset_bytes,
        "dvc_lockfile": result.dvc.lockfile,
    }
    if write_report:
        _write_json(root / VERIFICATION_PATH, report)
    return report
