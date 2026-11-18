from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import time
import urllib.request
import zipfile
from collections.abc import Callable, Iterable, Sequence
from contextlib import suppress
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Literal, Self
from urllib.parse import urlsplit

import fire
from openslide import OpenSlide
from pathologize_tiler import DicomSlide, probe_nvimagecodec
from PIL import features
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

MATRIX_PATH = Path("fixtures/wsi-decoder-matrix.json")
REPORT_PATH = Path("reports/wsi-decoder-fixture-probes.json")
SHA256_PATTERN = r"^[a-f0-9]{64}$"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class SourceObject(StrictModel):
    path: str
    url: str
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=SHA256_PATTERN)

    @field_validator("path")
    @classmethod
    def require_relative_path(cls, value: str) -> str:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts or value in {"", "."}:
            raise ValueError("source path must name a file below the fixture root")
        return value

    @field_validator("url")
    @classmethod
    def require_https_url(cls, value: str) -> str:
        if urlsplit(value).scheme != "https":
            raise ValueError("fixture source URL must use HTTPS")
        return value


class LicenseSpec(StrictModel):
    name: str
    spdx_id: str | None
    url: str
    redistribution: str
    attribution: str | None


class LevelSpec(StrictModel):
    logical_level: int = Field(ge=0)
    dimensions: tuple[int, int]
    downsample: tuple[float, float]
    mpp: tuple[float, float]
    tile_size: tuple[int, int]
    frame_count: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def require_positive_geometry(self) -> Self:
        values: Iterable[int | float] = (
            *self.dimensions,
            *self.downsample,
            *self.mpp,
            *self.tile_size,
        )
        if any(not math.isfinite(value) or value <= 0 for value in values):
            raise ValueError("level geometry and scale must be finite and positive")
        return self


class AssociatedImageSpec(StrictModel):
    role: str
    dimensions: tuple[int, int]
    compression: str
    color_model: str


class BackendSpec(StrictModel):
    backend: str
    status: Literal["supported", "unsupported", "not_tested"]
    output_residences: tuple[Literal["host", "cuda"], ...]
    reason: str


class GpuTrialSpec(StrictModel):
    status: Literal["possible_now", "blocked"]
    candidate: str
    reason: str


class FixtureSpec(StrictModel):
    fixture_id: str
    acquisition_profile: Literal["smoke", "extended"]
    family: Literal["aperio", "leica", "tiled_tiff", "dicom_wsi"]
    container: str
    compression: Literal["jpeg", "jpeg2000"]
    tiling: str
    color_model: str
    packaging: Literal["file", "zip", "dicom_series"]
    materialized_path: str
    sources: tuple[SourceObject, ...]
    total_bytes: int = Field(gt=0)
    license: LicenseSpec
    levels: tuple[LevelSpec, ...] = Field(min_length=1)
    associated_images: tuple[AssociatedImageSpec, ...]
    backends: tuple[BackendSpec, ...] = Field(min_length=1)
    gpu_trial: GpuTrialSpec

    @field_validator("materialized_path")
    @classmethod
    def require_materialized_path_below_root(cls, value: str) -> str:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts or value == "":
            raise ValueError("materialized path must stay below the fixture root")
        return value

    @model_validator(mode="after")
    def require_consistent_source_bytes(self) -> Self:
        if sum(source.bytes for source in self.sources) != self.total_bytes:
            raise ValueError(f"source bytes do not sum to total_bytes for {self.fixture_id}")
        logical_levels = [level.logical_level for level in self.levels]
        if logical_levels != sorted(set(logical_levels)):
            raise ValueError(f"logical levels must be unique and ordered for {self.fixture_id}")
        if not any(backend.status == "supported" for backend in self.backends):
            raise ValueError(f"at least one backend must support {self.fixture_id}")
        return self


class AnisotropicProbeSpec(StrictModel):
    base_mpp: tuple[float, float]
    level_downsamples: tuple[tuple[float, float], ...]
    target_mpp: tuple[float, float]
    expected_level: int = Field(ge=0)


class FixtureMatrix(StrictModel):
    schema_version: Literal["pathologize.wsi-decoder-fixture-matrix.v1"]
    catalog_url: str
    catalog_retrieved_at: str
    timing_method: str
    anisotropic_probe: AnisotropicProbeSpec
    fixtures: tuple[FixtureSpec, ...] = Field(min_length=6)

    @model_validator(mode="after")
    def require_requested_coverage(self) -> Self:
        fixture_ids = [fixture.fixture_id for fixture in self.fixtures]
        if len(fixture_ids) != len(set(fixture_ids)):
            raise ValueError("fixture IDs must be unique")
        families = {fixture.family for fixture in self.fixtures}
        required_families = {"aperio", "leica", "tiled_tiff", "dicom_wsi"}
        if not required_families <= families:
            raise ValueError(f"missing fixture families: {sorted(required_families - families)}")
        codecs = {fixture.compression for fixture in self.fixtures}
        if codecs != {"jpeg", "jpeg2000"}:
            raise ValueError("matrix must cover JPEG and JPEG 2000")
        if not any(
            fixture.family == "dicom_wsi" and fixture.compression == "jpeg"
            for fixture in self.fixtures
        ):
            raise ValueError("matrix must include DICOM WSI JPEG")
        if not any(
            fixture.family == "dicom_wsi" and fixture.compression == "jpeg2000"
            for fixture in self.fixtures
        ):
            raise ValueError("matrix must include DICOM WSI JPEG 2000")
        return self


class ProbeTiming(StrictModel):
    cold_milliseconds: float = Field(ge=0)
    warm_median_milliseconds: float = Field(ge=0)
    warm_repetitions: int = Field(ge=1)


class FixtureProbeResult(StrictModel):
    fixture_id: str
    status: Literal["passed", "missing"]
    backend: str | None
    detected_format: str | None
    selected_level: int | None
    boundary_size: tuple[int, int] | None
    fallback_reason: str | None
    timing: ProbeTiming | None


class ProbeEnvironment(StrictModel):
    kernel: str
    machine: str
    processor: str
    cpu_model: str
    logical_cpus: int
    memory_bytes: int
    gpu: str | None
    dependencies: dict[str, str]


class FixtureProbeReport(StrictModel):
    schema_version: Literal["pathologize.wsi-decoder-fixture-probes.v1"]
    generated_at: str
    timing_method: str
    environment: ProbeEnvironment
    anisotropic_level_selection_passed: bool
    results: tuple[FixtureProbeResult, ...]


def load_matrix(root: Path) -> FixtureMatrix:
    return FixtureMatrix.model_validate_json((root / MATRIX_PATH).read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_source(path: Path, source: SourceObject) -> None:
    if path.stat().st_size != source.bytes:
        raise ValueError(f"fixture size differs for {path}")
    if _sha256(path) != source.sha256:
        raise ValueError(f"fixture SHA-256 differs for {path}")


def _download(source: SourceObject, destination: Path) -> None:
    if urlsplit(source.url).scheme != "https":
        raise ValueError(f"fixture source URL must use HTTPS: {source.url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    temporary.unlink(missing_ok=True)
    with (
        urllib.request.urlopen(  # noqa: S310 - HTTPS is required above.
            source.url, timeout=120
        ) as response,
        temporary.open("wb") as out,
    ):
        shutil.copyfileobj(response, out, length=1024 * 1024)
    _verify_source(temporary, source)
    temporary.replace(destination)


def _safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            member_path = (destination / member.filename).resolve()
            if not member_path.is_relative_to(destination_root):
                raise ValueError(f"archive member escapes fixture root: {member.filename}")
        zipped.extractall(destination)


def acquire_fixtures(root: Path, data_root: Path, profile: str) -> dict[str, int]:
    if profile not in {"smoke", "extended"}:
        raise ValueError("profile must be smoke or extended")
    matrix = load_matrix(root)
    selected = [
        fixture
        for fixture in matrix.fixtures
        if profile == "extended" or fixture.acquisition_profile == "smoke"
    ]
    downloaded = 0
    reused = 0
    for fixture in selected:
        fixture_root = data_root / fixture.fixture_id
        for source in fixture.sources:
            destination = fixture_root / source.path
            if destination.is_file():
                _verify_source(destination, source)
                reused += 1
            else:
                _download(source, destination)
                downloaded += 1
        if fixture.packaging == "zip":
            _safe_extract(fixture_root / fixture.sources[0].path, fixture_root / "extracted")
    return {"fixtures": len(selected), "downloaded": downloaded, "reused": reused}


def select_level_for_mpp(
    base_mpp: tuple[float, float],
    level_downsamples: tuple[tuple[float, float], ...],
    target_mpp: tuple[float, float],
) -> int:
    for axis, value in (*enumerate(base_mpp), *enumerate(target_mpp)):
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"MPP axis {axis} must be finite and positive")
    if not level_downsamples or any(
        not math.isfinite(value) or value <= 0
        for downsample in level_downsamples
        for value in downsample
    ):
        raise ValueError("level downsamples must be finite and positive")
    errors = [
        max(
            abs(math.log((base_mpp[0] * downsample[0]) / target_mpp[0])),
            abs(math.log((base_mpp[1] * downsample[1]) / target_mpp[1])),
        )
        for downsample in level_downsamples
    ]
    return min(range(len(errors)), key=errors.__getitem__)


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _timed[T](operation: Callable[[], T], repetitions: int = 5) -> tuple[T, ProbeTiming]:
    start = time.perf_counter_ns()
    result = operation()
    cold = (time.perf_counter_ns() - start) / 1_000_000
    warm: list[float] = []
    for _ in range(repetitions):
        start = time.perf_counter_ns()
        result = operation()
        warm.append((time.perf_counter_ns() - start) / 1_000_000)
    return result, ProbeTiming(
        cold_milliseconds=cold,
        warm_median_milliseconds=_median(warm),
        warm_repetitions=repetitions,
    )


def _probe_openslide(path: Path, fixture: FixtureSpec) -> FixtureProbeResult:
    detected = OpenSlide.detect_format(path)
    if detected is None:
        raise ValueError(f"OpenSlide could not identify {fixture.fixture_id}")

    def read_boundary() -> tuple[int, tuple[int, int]]:
        with OpenSlide(path) as slide:
            selected = select_level_for_mpp(
                fixture.levels[0].mpp,
                tuple(level.downsample for level in fixture.levels),
                fixture.levels[-1].mpp,
            )
            width, height = slide.level_dimensions[selected]
            tile_width, tile_height = fixture.levels[selected].tile_size
            location = (
                math.floor(max(0, width - 1) * fixture.levels[selected].downsample[0]),
                math.floor(max(0, height - 1) * fixture.levels[selected].downsample[1]),
            )
            with slide.read_region(location, selected, (tile_width, tile_height)) as image:
                boundary_size = image.size
            return selected, boundary_size

    measured, timing = _timed(read_boundary)
    selected_level, boundary_size = measured
    if selected_level != len(fixture.levels) - 1:
        raise ValueError(f"level selection differs for {fixture.fixture_id}")
    return FixtureProbeResult(
        fixture_id=fixture.fixture_id,
        status="passed",
        backend="openslide",
        detected_format=detected,
        selected_level=selected_level,
        boundary_size=boundary_size,
        fallback_reason="no optional TIFF accelerator is installed in the CPU fixture environment",
        timing=timing,
    )


def _probe_dicom(path: Path, fixture: FixtureSpec) -> FixtureProbeResult:
    capability = probe_nvimagecodec()

    def read_boundary() -> tuple[int, tuple[int, int], str]:
        with DicomSlide.open(path) as slide:
            selected = select_level_for_mpp(
                fixture.levels[0].mpp,
                tuple(level.downsample for level in fixture.levels),
                fixture.levels[-1].mpp,
            )
            level = fixture.levels[selected]
            coordinate = (
                max(0, math.ceil(level.dimensions[0] / level.tile_size[0]) - 1),
                max(0, math.ceil(level.dimensions[1] / level.tile_size[1]) - 1),
            )
            with slide.read_host_tile(level.logical_level, coordinate).image as image:
                boundary_size = image.size
            return selected, boundary_size, slide.metadata.levels[selected].decoder

    measured, timing = _timed(read_boundary)
    selected_level, boundary_size, decoder = measured
    if selected_level != len(fixture.levels) - 1:
        raise ValueError(f"level selection differs for {fixture.fixture_id}")
    reason = (
        capability.reason
        if not capability.available
        else "CPU host output was requested explicitly"
    )
    return FixtureProbeResult(
        fixture_id=fixture.fixture_id,
        status="passed",
        backend=f"wsidicom/{decoder}",
        detected_format="dicom_wsi",
        selected_level=selected_level,
        boundary_size=boundary_size,
        fallback_reason=reason,
        timing=timing,
    )


def _package_versions() -> dict[str, str]:
    packages = (
        "openslide-bin",
        "openslide-python",
        "Pillow",
        "pydicom",
        "pylibjpeg",
        "pylibjpeg-openjpeg",
        "wsidicom",
    )
    found: dict[str, str] = {}
    for package in packages:
        try:
            found[package] = version(package)
        except PackageNotFoundError:
            found[package] = "not-installed"
    found["Pillow/libjpeg-turbo"] = features.version("libjpeg_turbo") or "unknown"
    found["Pillow/OpenJPEG"] = features.version("jpg_2000") or "unknown"
    return found


def _read_text(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return fallback


def _environment() -> ProbeEnvironment:
    meminfo = _read_text(Path("/proc/meminfo"), "")
    memory_line = next((line for line in meminfo.splitlines() if line.startswith("MemTotal:")), "")
    memory_bytes = int(memory_line.split()[1]) * 1024 if memory_line else 0
    cpuinfo = _read_text(Path("/proc/cpuinfo"), "")
    cpu_model_line = next(
        (line for line in cpuinfo.splitlines() if line.startswith("model name")), ""
    )
    cpu_model = cpu_model_line.split(":", maxsplit=1)[1].strip() if cpu_model_line else "unknown"
    nvidia_smi = shutil.which("nvidia-smi")
    gpu = None
    if nvidia_smi is not None:
        with suppress(subprocess.CalledProcessError):
            gpu = subprocess.run(  # noqa: S603 - shutil.which resolved the fixed executable.
                [
                    nvidia_smi,
                    "--query-gpu=name,driver_version,memory.total,compute_cap",
                    "--format=csv,noheader",
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
    return ProbeEnvironment(
        kernel=platform.release(),
        machine=platform.machine(),
        processor=platform.processor() or "unknown",
        cpu_model=cpu_model,
        logical_cpus=os.cpu_count() or 1,
        memory_bytes=memory_bytes,
        gpu=gpu,
        dependencies=_package_versions(),
    )


def _materialized_path(data_root: Path, fixture: FixtureSpec) -> Path:
    fixture_root = data_root / fixture.fixture_id
    if fixture.packaging == "zip":
        return fixture_root / "extracted" / fixture.materialized_path
    return fixture_root / fixture.materialized_path


def run_probes(root: Path, data_root: Path, *, require_all: bool) -> FixtureProbeReport:
    matrix = load_matrix(root)
    anisotropic = matrix.anisotropic_probe
    selected = select_level_for_mpp(
        anisotropic.base_mpp,
        anisotropic.level_downsamples,
        anisotropic.target_mpp,
    )
    anisotropic_passed = selected == anisotropic.expected_level
    if not anisotropic_passed:
        raise ValueError("anisotropic MPP level-selection contract failed")
    results: list[FixtureProbeResult] = []
    for fixture in matrix.fixtures:
        path = _materialized_path(data_root, fixture)
        if not path.exists():
            if require_all:
                raise FileNotFoundError(f"fixture is not materialized: {path}")
            results.append(
                FixtureProbeResult(
                    fixture_id=fixture.fixture_id,
                    status="missing",
                    backend=None,
                    detected_format=None,
                    selected_level=None,
                    boundary_size=None,
                    fallback_reason=None,
                    timing=None,
                )
            )
            continue
        fixture_root = data_root / fixture.fixture_id
        for source in fixture.sources:
            source_path = fixture_root / source.path
            if not source_path.is_file():
                raise FileNotFoundError(f"fixture source is not materialized: {source_path}")
            _verify_source(source_path, source)
        result = (
            _probe_dicom(path, fixture)
            if fixture.family == "dicom_wsi"
            else _probe_openslide(path, fixture)
        )
        results.append(result)
    return FixtureProbeReport(
        schema_version="pathologize.wsi-decoder-fixture-probes.v1",
        generated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        timing_method=matrix.timing_method,
        environment=_environment(),
        anisotropic_level_selection_passed=anisotropic_passed,
        results=tuple(results),
    )


class FixtureMatrixApplication:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else Path.cwd()

    def validate(self) -> None:
        matrix = load_matrix(self.root)
        print(f"Validated {len(matrix.fixtures)} WSI fixtures.")

    def acquire(self, profile: str = "smoke", data_root: str = "data/wsi-decoder-fixtures") -> None:
        result = acquire_fixtures(self.root, (self.root / data_root).resolve(), profile)
        print(json.dumps(result, sort_keys=True))

    def probe(
        self,
        data_root: str = "data/wsi-decoder-fixtures",
        require_all: bool = False,
        write_report: bool = False,
    ) -> None:
        report = run_probes(
            self.root,
            (self.root / data_root).resolve(),
            require_all=require_all,
        )
        payload = report.model_dump_json(indent=2) + "\n"
        if write_report:
            (self.root / REPORT_PATH).write_text(payload, encoding="utf-8")
        print(payload, end="")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(
            FixtureMatrixApplication,
            command=list(command) if command is not None else None,
        )
    except (OSError, ValidationError, ValueError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
