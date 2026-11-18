from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GpuBenchmarkConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_root: Path
    logical_level: int = Field(default=0, ge=0)
    batch_sizes: tuple[int, ...] = (1, 8, 32, 128)
    access_patterns: tuple[Literal["contiguous", "random"], ...] = (
        "contiguous",
        "random",
    )
    warmup_repetitions: int = Field(default=1, ge=0, le=20)
    measured_repetitions: int = Field(default=5, ge=1, le=100)
    random_seed: int = 1729
    output_size: int = Field(default=224, ge=32, le=2048)
    pixel_absolute_tolerance: int = Field(default=1, ge=0, le=255)
    correctness_samples: int = Field(default=8, ge=1, le=128)

    @field_validator("batch_sizes")
    @classmethod
    def validate_batch_sizes(cls, values: tuple[int, ...]) -> tuple[int, ...]:
        if not values or any(value < 1 for value in values):
            raise ValueError("batch_sizes must contain positive integers")
        if len(set(values)) != len(values):
            raise ValueError("batch_sizes must not contain duplicates")
        return values

    @field_validator("access_patterns")
    @classmethod
    def validate_access_patterns(
        cls, values: tuple[Literal["contiguous", "random"], ...]
    ) -> tuple[Literal["contiguous", "random"], ...]:
        if not values:
            raise ValueError("access_patterns must not be empty")
        if len(set(values)) != len(values):
            raise ValueError("access_patterns must not contain duplicates")
        return values


class StageMeasurement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    wall_milliseconds: float = Field(ge=0)
    process_cpu_milliseconds: float = Field(ge=0)
    cuda_milliseconds: float | None = Field(default=None, ge=0)
    host_bytes: int = Field(default=0, ge=0)
    device_bytes: int = Field(default=0, ge=0)


class StageSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    median_wall_milliseconds: float = Field(ge=0)
    median_process_cpu_milliseconds: float = Field(ge=0)
    median_cuda_milliseconds: float | None = Field(default=None, ge=0)
    host_bytes: int = Field(default=0, ge=0)
    device_bytes: int = Field(default=0, ge=0)


class PipelineCaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    pipeline: Literal["cpu_decode_pinned_h2d", "nvimagecodec_device_decode"]
    access_pattern: Literal["contiguous", "random"]
    batch_size: int = Field(ge=1)
    runtime_state: Literal["first_call", "steady_state"]
    repetitions: int = Field(ge=1)
    stages: dict[str, StageSummary]
    median_end_to_end_wall_milliseconds: float = Field(ge=0)
    median_end_to_end_process_cpu_milliseconds: float = Field(ge=0)
    peak_cupy_pool_reserved_bytes: int = Field(ge=0)
    peak_host_rss_bytes: int = Field(ge=0)


class PixelAgreement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    samples: int = Field(ge=1)
    maximum_absolute_error: int = Field(ge=0)
    mean_absolute_error: float = Field(ge=0)
    tolerance: int = Field(ge=0)
    passed: bool


class ViewerCpuResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    decoder: str
    median_decode_milliseconds: float = Field(ge=0)
    median_png_encode_milliseconds: float = Field(ge=0)
    median_png_bytes: int = Field(ge=0)


class BenchmarkEnvironment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    cupy_version: str
    cuda_runtime_version: str
    device_name: str
    device_capability: str
    nvimagecodec_backend: str
    fixture_root: str
    fixture_transfer_syntax: str
    fixture_photometric_interpretation: str
    fixture_tile_size: tuple[int, int]
    fixture_microns_per_pixel: tuple[float, float]
    fixture_complete_tile_count: int = Field(ge=1)
    sampling_scope: Literal["complete-tiles-only"] = "complete-tiles-only"


class GpuDecodeBenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["pathologize.gpu-decode-benchmark.v1"] = (
        "pathologize.gpu-decode-benchmark.v1"
    )
    benchmark_scope: Literal["dicom-jpeg2000"] = "dicom-jpeg2000"
    disk_cache_control: Literal["os-cache-warm-wsidicom-frame-caches-disabled"] = (
        "os-cache-warm-wsidicom-frame-caches-disabled"
    )
    consumer: Literal["deterministic-local-linear-pooling-proxy"] = (
        "deterministic-local-linear-pooling-proxy"
    )
    config: GpuBenchmarkConfig
    environment: BenchmarkEnvironment
    pixel_agreement: PixelAgreement
    viewer_cpu: ViewerCpuResult
    cases: tuple[PipelineCaseResult, ...]
