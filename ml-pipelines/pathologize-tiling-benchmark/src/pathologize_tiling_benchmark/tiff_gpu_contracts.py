from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

FixtureFormat = Literal[
    "aperio_svs",
    "generic_tiled_tiff",
    "leica_scn",
    "tiled_tiff",
]
FixtureCodec = Literal["jpeg", "jpeg2000", "lzw", "none"]
AccessPattern = Literal["contiguous", "random"]
TiffPipeline = Literal["openslide_cpu_pinned_h2d", "cucim_cuslide2_device"]


class TiffFixtureMember(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    path: str
    bytes: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    format: FixtureFormat
    codec: FixtureCodec
    license_spdx: str


class TiffFixtureSource(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    id: str
    url: str
    revision: str
    source_commit: str | None = Field(default=None, pattern=r"^[a-f0-9]{40}$")
    license: str
    members: tuple[TiffFixtureMember, ...]


class TiffFixtureManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["pathologize.tiff-gpu-fixtures.v1"]
    sources: tuple[TiffFixtureSource, ...]

    @field_validator("sources")
    @classmethod
    def validate_unique_paths(
        cls, sources: tuple[TiffFixtureSource, ...]
    ) -> tuple[TiffFixtureSource, ...]:
        paths = tuple(member.path for source in sources for member in source.members)
        if len(paths) != len(set(paths)):
            raise ValueError("fixture member paths must be unique")
        return sources


class TiffGpuBenchmarkConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_root: Path
    fixture_manifest: Path
    benchmark_fixture_paths: tuple[str, ...] = (
        "svs/239551.svs",
        "svs/590_crop_jp2k_imagescope.svs",
    )
    logical_level: int = Field(default=0, ge=0)
    region_size: int = Field(default=256, ge=32, le=2048)
    output_size: int = Field(default=224, ge=32, le=2048)
    batch_sizes: tuple[int, ...] = (1, 8, 32, 128)
    access_patterns: tuple[AccessPattern, ...] = ("contiguous", "random")
    warmup_repetitions: int = Field(default=1, ge=0, le=20)
    measured_repetitions: int = Field(default=5, ge=1, le=100)
    correctness_samples: int = Field(default=8, ge=1, le=128)
    pixel_absolute_tolerance: int = Field(default=3, ge=0, le=255)
    random_seed: int = 1729

    @field_validator("batch_sizes")
    @classmethod
    def validate_batch_sizes(cls, values: tuple[int, ...]) -> tuple[int, ...]:
        if not values or any(value < 1 for value in values):
            raise ValueError("batch_sizes must contain positive integers")
        if len(set(values)) != len(values):
            raise ValueError("batch_sizes must not contain duplicates")
        return values

    @field_validator("access_patterns", "benchmark_fixture_paths")
    @classmethod
    def validate_nonempty_unique[T](cls, values: tuple[T, ...]) -> tuple[T, ...]:
        if not values:
            raise ValueError("value must not be empty")
        if len(set(values)) != len(values):
            raise ValueError("value must not contain duplicates")
        return values


class ReaderGeometry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    vendor: str | None = None
    level_dimensions: tuple[tuple[int, int], ...]
    level_downsamples: tuple[float, ...]
    level_tile_sizes: tuple[tuple[int, int], ...]
    microns_per_pixel: tuple[float | None, float | None]
    associated_images: tuple[str, ...]


class TiffFixtureProbe(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    path: str
    expected_format: FixtureFormat
    expected_codec: FixtureCodec
    expected_bytes: int
    sha256: str
    sha256_verified: bool
    tiff_compression: str | None
    tiff_is_tiled: bool | None
    tiff_tile_size: tuple[int, int] | None
    openslide_supported: bool
    openslide_error: str | None
    openslide_geometry: ReaderGeometry | None
    cucim_supported: bool
    cucim_error: str | None
    cucim_geometry: ReaderGeometry | None
    cucim_device_output: bool
    device_output_shape: tuple[int, ...] | None
    pyramid_geometry_match: bool
    microns_per_pixel_match: bool
    associated_images_match: bool
    semantic_geometry_match: bool
    accelerator_eligible: bool
    measurement_eligible: bool
    selection_reason: str
    decoder_evidence: str
    remaining_host_work: tuple[str, ...]


class TiffPixelAgreement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_path: str
    samples: int = Field(ge=1)
    maximum_absolute_error: int = Field(ge=0)
    mean_absolute_error: float = Field(ge=0)
    tolerance: int = Field(ge=0)
    passed: bool


class TiffStageSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    median_wall_milliseconds: float = Field(ge=0)
    median_process_cpu_milliseconds: float = Field(ge=0)
    median_cuda_milliseconds: float | None = Field(default=None, ge=0)
    host_bytes: int = Field(default=0, ge=0)
    device_bytes: int = Field(default=0, ge=0)


class TiffPipelineCase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_path: str
    pipeline: TiffPipeline
    access_pattern: AccessPattern
    batch_size: int = Field(ge=1)
    execution_position: int = Field(ge=1, le=2)
    runtime_state: Literal["first_sample_after_correctness_probe", "steady_state"]
    repetitions: int = Field(ge=1)
    stages: dict[str, TiffStageSummary]
    median_end_to_end_wall_milliseconds: float = Field(ge=0)
    median_end_to_end_process_cpu_milliseconds: float = Field(ge=0)
    throughput_regions_per_second: float = Field(ge=0)
    peak_host_rss_bytes: int = Field(ge=0)
    cupy_pool_reserved_bytes: int = Field(ge=0)


class TiffViewerCpuResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_path: str
    median_decode_milliseconds: float = Field(ge=0)
    median_png_encode_milliseconds: float = Field(ge=0)
    median_png_bytes: int = Field(ge=0)


class TiffBenchmarkEnvironment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    host_kernel: str
    cpu_model: str
    cpu_logical_count: int = Field(ge=1)
    host_memory_bytes: int = Field(ge=1)
    gpu_name: str
    gpu_uuid: str
    gpu_compute_capability: str
    gpu_memory_bytes: int = Field(ge=1)
    driver_version: str
    cuda_runtime_version: str
    python_version: str
    cucim_version: str
    cucim_source_commit: Literal["1b7642933c4b3eba9b3d8361889c6824875afacf"] = (
        "1b7642933c4b3eba9b3d8361889c6824875afacf"
    )
    nvimagecodec_version: str
    cupy_version: str
    openslide_python_version: str
    openslide_library_version: str
    tifffile_version: str


class TiffGpuBenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["pathologize.tiff-gpu-decode-benchmark.v1"] = (
        "pathologize.tiff-gpu-decode-benchmark.v1"
    )
    timing_method: Literal[
        "perf-counter-and-process-time; cuda-events-only-on-caller-stream; "
        "readers-correctness-probed; shared-device-kernels-primed; os-cache-warm"
    ] = (
        "perf-counter-and-process-time; cuda-events-only-on-caller-stream; "
        "readers-correctness-probed; shared-device-kernels-primed; os-cache-warm"
    )
    disk_cache_control: Literal["os-cache-warm"] = "os-cache-warm"
    gpu_io_mode: Literal["ordinary-file-io-no-gds"] = "ordinary-file-io-no-gds"
    consumer: Literal["deterministic-local-linear-pooling-proxy"] = (
        "deterministic-local-linear-pooling-proxy"
    )
    config: TiffGpuBenchmarkConfig
    environment: TiffBenchmarkEnvironment
    probes: tuple[TiffFixtureProbe, ...]
    pixel_agreement: tuple[TiffPixelAgreement, ...]
    viewer_cpu: tuple[TiffViewerCpuResult, ...]
    cases: tuple[TiffPipelineCase, ...]
    omissions: tuple[str, ...]
