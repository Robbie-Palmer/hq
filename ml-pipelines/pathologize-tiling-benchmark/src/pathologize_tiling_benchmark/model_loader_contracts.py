from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Pipeline = Literal["cpu_decode_pinned_h2d", "nvimagecodec_device_decode"]
Workload = Literal["inference", "training"]
AccessPattern = Literal["contiguous", "random"]
_SHA256_PATTERN = r"^[a-f0-9]{64}$"


class ModelLoaderBenchmarkConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    fixture_root: Path
    fixture_manifest: Path
    fixture_collection_manifest: Path
    logical_level: int = Field(default=0, ge=0)
    batch_sizes: tuple[int, ...] = (8, 32, 64)
    loader_concurrency: tuple[int, ...] = (1, 2, 4)
    access_patterns: tuple[AccessPattern, ...] = ("random",)
    workloads: tuple[Workload, ...] = ("inference", "training")
    warmup_batches: int = Field(default=4, ge=0, le=20)
    measured_batches: int = Field(default=16, ge=2, le=100)
    queue_depth_factor: int = Field(default=2, ge=1, le=8)
    output_size: int = Field(default=224, ge=32, le=2048)
    random_seed: int = 1729
    model_classes: int = Field(default=2, ge=2, le=1000)
    memory_sample_interval_milliseconds: int = Field(default=5, ge=1, le=1000)

    @field_validator("batch_sizes", "loader_concurrency")
    @classmethod
    def validate_positive_unique_values(cls, values: tuple[int, ...]) -> tuple[int, ...]:
        if not values or any(value < 1 for value in values):
            raise ValueError("benchmark dimensions must contain positive integers")
        if len(set(values)) != len(values):
            raise ValueError("benchmark dimensions must not contain duplicates")
        return values

    @field_validator("access_patterns", "workloads")
    @classmethod
    def validate_nonempty_unique_strings(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if not values:
            raise ValueError("benchmark string dimensions must not be empty")
        if len(set(values)) != len(values):
            raise ValueError("benchmark string dimensions must not contain duplicates")
        return values


class DependencyVersion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    name: str
    version: str


class FixtureAsset(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    relative_path: str
    bytes: int = Field(ge=1)
    sha256: str = Field(pattern=_SHA256_PATTERN)
    source_url: str


class LoaderBenchmarkEnvironment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    hostname: str
    operating_system: str
    python_version: str
    cpu_model: str
    logical_cpu_count: int = Field(ge=1)
    cgroup_cpu_quota_cores: float | None = Field(default=None, gt=0)
    cgroup_cpuset: str
    total_host_memory_bytes: int = Field(ge=1)
    cgroup_memory_limit_bytes: int | None = Field(default=None, ge=1)
    gpu_name: str
    gpu_capability: str
    gpu_memory_bytes: int = Field(ge=1)
    gpu_pci_bus_id: str
    gpu_power_limit_milliwatts: int | None = Field(default=None, ge=1)
    nvidia_driver_version: str
    cuda_runtime_version: str
    dependencies: tuple[DependencyVersion, ...]
    image_reference: str | None
    fixture_manifest_id: str
    fixture_manifest_sha256: str = Field(pattern=_SHA256_PATTERN)
    fixture_collection: str
    fixture_citation: str
    fixture_license: str
    fixture_assets: tuple[FixtureAsset, ...]
    fixture_total_bytes: int = Field(ge=1)
    fixture_transfer_syntax: str
    fixture_photometric_interpretation: str
    fixture_dimensions: tuple[int, int]
    fixture_tile_size: tuple[int, int]
    fixture_microns_per_pixel: tuple[float, float]
    fixture_complete_tile_count: int = Field(ge=1)
    model_architecture: Literal["torchvision.models.resnet18"] = "torchvision.models.resnet18"
    model_weights: Literal["deterministic-local-initialization"] = (
        "deterministic-local-initialization"
    )
    model_state_sha256: str = Field(pattern=_SHA256_PATTERN)


class StageSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    samples: int = Field(ge=1)
    median_wall_milliseconds: float = Field(ge=0)
    total_wall_milliseconds: float = Field(ge=0)
    median_process_cpu_milliseconds: float = Field(ge=0)
    total_process_cpu_milliseconds: float = Field(ge=0)
    median_cuda_milliseconds: float | None = Field(default=None, ge=0)
    total_cuda_milliseconds: float | None = Field(default=None, ge=0)


class RuntimeMeasurement(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    runtime_state: Literal["application_cold", "steady_state"]
    batches: int = Field(ge=1)
    samples: int = Field(ge=1)
    end_to_end_wall_milliseconds: float = Field(gt=0)
    process_cpu_milliseconds: float = Field(ge=0)
    mean_process_cpu_cores: float = Field(ge=0)
    samples_per_second: float = Field(gt=0)
    stages: dict[str, StageSummary]
    host_to_device_bytes: int = Field(ge=0)
    compressed_input_bytes: int = Field(ge=0)
    uncompressed_sample_bytes: int = Field(ge=0)
    torch_peak_allocated_bytes: int = Field(ge=0)
    torch_peak_reserved_bytes: int = Field(ge=0)
    cupy_peak_reserved_bytes: int = Field(ge=0)
    process_gpu_peak_bytes: int | None = Field(default=None, ge=0)
    summed_stage_work_milliseconds: float = Field(ge=0)
    hidden_stage_work_milliseconds: float = Field(ge=0)
    overlap_fraction: float = Field(ge=0, le=1)


class ModelLoaderCaseResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    execution_index: int | None = Field(default=None, ge=0)
    pipeline: Pipeline
    workload: Workload
    access_pattern: AccessPattern
    batch_size: int = Field(ge=1)
    loader_concurrency: int = Field(ge=1)
    setup_milliseconds: float = Field(ge=0)
    cold: RuntimeMeasurement
    steady: RuntimeMeasurement


class ModelLoaderBenchmarkReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal["pathologize.model-loader-benchmark.v1"] = (
        "pathologize.model-loader-benchmark.v1"
    )
    benchmark_scope: Literal["dicom-jpeg2000-resnet18"] = "dicom-jpeg2000-resnet18"
    cache_policy: Literal["os-cache-warm-wsidicom-frame-caches-disabled-application-cold"] = (
        "os-cache-warm-wsidicom-frame-caches-disabled-application-cold"
    )
    sampling_scope: Literal["complete-tiles-only"] = "complete-tiles-only"
    timing_method: Literal["perf-counter-process-time-thread-time-cuda-events-nvml-sampling"] = (
        "perf-counter-process-time-thread-time-cuda-events-nvml-sampling"
    )
    config: ModelLoaderBenchmarkConfig
    environment: LoaderBenchmarkEnvironment
    cases: tuple[ModelLoaderCaseResult, ...]
