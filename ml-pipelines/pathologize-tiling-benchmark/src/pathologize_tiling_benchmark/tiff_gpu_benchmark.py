from __future__ import annotations

import hashlib
import io
import os
import platform
import random
import resource
import statistics
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from importlib import import_module, metadata
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np
from openslide import OpenSlide, OpenSlideError

from .tiff_gpu_contracts import (
    AccessPattern,
    ReaderGeometry,
    TiffBenchmarkEnvironment,
    TiffFixtureManifest,
    TiffFixtureMember,
    TiffFixtureProbe,
    TiffGpuBenchmarkConfig,
    TiffGpuBenchmarkReport,
    TiffPipeline,
    TiffPipelineCase,
    TiffPixelAgreement,
    TiffStageSummary,
    TiffViewerCpuResult,
)


@dataclass(frozen=True, slots=True)
class _Measurement:
    wall_milliseconds: float
    process_cpu_milliseconds: float
    cuda_milliseconds: float | None = None
    host_bytes: int = 0
    device_bytes: int = 0


def parse_batch_sizes(value: int | str | tuple[int, ...]) -> tuple[int, ...]:
    if isinstance(value, tuple):
        return value
    if isinstance(value, int):
        return (value,)
    try:
        return tuple(int(part.strip()) for part in value.split(",") if part.strip())
    except ValueError as error:
        raise ValueError("batch_sizes must be a comma-separated list of integers") from error


def load_fixture_manifest(path: Path) -> TiffFixtureManifest:
    return TiffFixtureManifest.model_validate_json(path.read_text(encoding="utf-8"))


def fixture_members(manifest: TiffFixtureManifest) -> tuple[TiffFixtureMember, ...]:
    return tuple(member for source in manifest.sources for member in source.members)


def complete_region_locations(
    dimensions: tuple[int, int],
    *,
    region_size: int,
    downsample: float,
) -> tuple[tuple[int, int], ...]:
    width, height = dimensions
    if region_size > width or region_size > height:
        return ()
    return tuple(
        (round(x * downsample), round(y * downsample))
        for y in range(0, height - region_size + 1, region_size)
        for x in range(0, width - region_size + 1, region_size)
    )


def select_region_locations(
    locations: tuple[tuple[int, int], ...],
    *,
    access_pattern: AccessPattern,
    batch_size: int,
    seed: int,
) -> tuple[tuple[int, int], ...]:
    if batch_size > len(locations):
        raise ValueError(f"batch size {batch_size} exceeds the level's {len(locations)} regions")
    if access_pattern == "random":
        return tuple(
            random.Random(seed).sample(  # noqa: S311  # NOSONAR - benchmark sampling.
                locations, batch_size
            )
        )
    midpoint = len(locations) // 2
    start = min(max(0, midpoint - batch_size // 2), len(locations) - batch_size)
    return locations[start : start + batch_size]


def summarize_stages(
    measurements: tuple[dict[str, _Measurement], ...],
) -> dict[str, TiffStageSummary]:
    if not measurements:
        raise ValueError("at least one stage measurement is required")
    names = tuple(measurements[0])
    if any(tuple(sample) != names for sample in measurements):
        raise ValueError("stage measurement names and order must match")
    result: dict[str, TiffStageSummary] = {}
    for name in names:
        samples = tuple(measurement[name] for measurement in measurements)
        cuda_samples = tuple(
            sample.cuda_milliseconds for sample in samples if sample.cuda_milliseconds is not None
        )
        result[name] = TiffStageSummary(
            median_wall_milliseconds=statistics.median(
                sample.wall_milliseconds for sample in samples
            ),
            median_process_cpu_milliseconds=statistics.median(
                sample.process_cpu_milliseconds for sample in samples
            ),
            median_cuda_milliseconds=statistics.median(cuda_samples) if cuda_samples else None,
            host_bytes=max(sample.host_bytes for sample in samples),
            device_bytes=max(sample.device_bytes for sample in samples),
        )
    return result


def _measure_cpu[T](
    operation: Callable[[], T], *, host_bytes: int = 0, device_bytes: int = 0
) -> tuple[T, _Measurement]:
    process_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    result = operation()
    return result, _Measurement(
        wall_milliseconds=(time.perf_counter_ns() - wall_start) / 1_000_000,
        process_cpu_milliseconds=(time.process_time_ns() - process_start) / 1_000_000,
        host_bytes=host_bytes,
        device_bytes=device_bytes,
    )


def _measure_cuda[T](
    cupy: Any,
    operation: Callable[[], T],
    *,
    host_bytes: int = 0,
    device_bytes: int = 0,
) -> tuple[T, _Measurement]:
    stream = cupy.cuda.get_current_stream()
    stream.synchronize()
    start_event = cupy.cuda.Event()
    end_event = cupy.cuda.Event()
    process_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    start_event.record()
    result = operation()
    end_event.record()
    end_event.synchronize()
    return result, _Measurement(
        wall_milliseconds=(time.perf_counter_ns() - wall_start) / 1_000_000,
        process_cpu_milliseconds=(time.process_time_ns() - process_start) / 1_000_000,
        cuda_milliseconds=float(cupy.cuda.get_elapsed_time(start_event, end_event)),
        host_bytes=host_bytes,
        device_bytes=device_bytes,
    )


def _peak_rss_bytes() -> int:
    status = Path("/proc/self/status")
    if status.exists():
        for line in status.read_text(encoding="utf-8").splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) * 1024
    multiplier = 1024 if os.name != "darwin" else 1
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * multiplier


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _openslide_geometry(slide: OpenSlide) -> ReaderGeometry:
    tile_sizes: list[tuple[int, int]] = []
    for level in range(slide.level_count):
        width = int(slide.properties.get(f"openslide.level[{level}].tile-width", "0"))
        height = int(slide.properties.get(f"openslide.level[{level}].tile-height", "0"))
        tile_sizes.append((width, height))
    return ReaderGeometry(
        vendor=slide.properties.get("openslide.vendor"),
        level_dimensions=tuple(
            (int(width), int(height)) for width, height in slide.level_dimensions
        ),
        level_downsamples=tuple(float(value) for value in slide.level_downsamples),
        level_tile_sizes=tuple(tile_sizes),
        microns_per_pixel=(
            _optional_float(slide.properties.get("openslide.mpp-x")),
            _optional_float(slide.properties.get("openslide.mpp-y")),
        ),
        associated_images=tuple(sorted(slide.associated_images)),
    )


def _cucim_geometry(image: Any) -> ReaderGeometry:
    resolutions = cast(dict[str, Any], image.resolutions)
    dimensions = tuple((int(value[0]), int(value[1])) for value in resolutions["level_dimensions"])
    downsamples = tuple(float(value) for value in resolutions["level_downsamples"])
    raw_tile_sizes = resolutions.get("level_tile_sizes") or ((0, 0),) * len(dimensions)
    tile_sizes = tuple((int(value[0]), int(value[1])) for value in raw_tile_sizes)
    spacing = tuple(float(value) for value in image.spacing("XY"))
    metadata_value = image.metadata
    vendor = None
    if isinstance(metadata_value, dict):
        vendor_value = metadata_value.get("vendor")
        vendor = str(vendor_value) if vendor_value is not None else None
    return ReaderGeometry(
        vendor=vendor,
        level_dimensions=dimensions,
        level_downsamples=downsamples,
        level_tile_sizes=tile_sizes,
        microns_per_pixel=(spacing[0], spacing[1]) if len(spacing) >= 2 else (None, None),
        associated_images=tuple(sorted(str(value) for value in image.associated_images)),
    )


def _pyramid_matches(left: ReaderGeometry | None, right: ReaderGeometry | None) -> bool:
    if left is None or right is None:
        return False
    if left.level_dimensions != right.level_dimensions:
        return False
    if len(left.level_downsamples) != len(right.level_downsamples):
        return False
    return not any(
        abs(left_value - right_value) > max(1e-6, abs(left_value) * 1e-6)
        for left_value, right_value in zip(
            left.level_downsamples, right.level_downsamples, strict=True
        )
    )


def _mpp_matches(left: ReaderGeometry | None, right: ReaderGeometry | None) -> bool:
    if left is None or right is None:
        return False
    for left_value, right_value in zip(
        left.microns_per_pixel, right.microns_per_pixel, strict=True
    ):
        if left_value is None or right_value is None:
            if left_value != right_value:
                return False
            continue
        if abs(left_value - right_value) > max(1e-6, abs(left_value) * 1e-4):
            return False
    return True


def _associated_images_match(left: ReaderGeometry | None, right: ReaderGeometry | None) -> bool:
    if left is None or right is None:
        return False
    return set(left.associated_images) == set(right.associated_images)


def _requested_level_matches(
    left: ReaderGeometry | None, right: ReaderGeometry | None, logical_level: int
) -> bool:
    if left is None or right is None:
        return False
    if logical_level >= len(left.level_dimensions) or logical_level >= len(right.level_dimensions):
        return False
    if left.level_dimensions[logical_level] != right.level_dimensions[logical_level]:
        return False
    left_downsample = left.level_downsamples[logical_level]
    right_downsample = right.level_downsamples[logical_level]
    return abs(left_downsample - right_downsample) <= max(1e-6, abs(left_downsample) * 1e-6)


def _inspect_tiff(
    tifffile: Any, path: Path
) -> tuple[str | None, bool | None, tuple[int, int] | None]:
    try:
        with tifffile.TiffFile(path) as source:
            page = source.pages[0]
            compression = str(page.compression.name).lower()
            tiled = bool(page.is_tiled)
            tile_size = (
                (int(page.tilewidth), int(page.tilelength))
                if page.tilewidth and page.tilelength
                else None
            )
            return compression, tiled, tile_size
    except (OSError, ValueError, tifffile.TiffFileError):
        return None, None, None


def _decoder_evidence(member: TiffFixtureMember, device_output: bool) -> str:
    if not device_output:
        return "no CUDA array output was produced"
    codec = {
        "jpeg": "JPEG tiles map to nvImageCodec's JPEG codec",
        "jpeg2000": "JPEG 2000 tiles map to nvImageCodec's JPEG 2000 codec",
        "lzw": "LZW tiles remain in the TIFF codec path",
        "none": "uncompressed tiles remain in the TIFF codec path",
    }[member.codec]
    return (
        "cuCIM cuslide2 v26.10 schedules nvImageCodec ROI batch decode into a strided CUDA "
        f"device buffer; {codec}; nvImageCodec does not expose the selected plugin through cuCIM"
    )


def _probe_fixture(
    cupy: Any,
    cucim: Any,
    tifffile: Any,
    root: Path,
    member: TiffFixtureMember,
    region_size: int,
    logical_level: int,
) -> TiffFixtureProbe:
    path = root / member.path
    actual_sha256 = _sha256(path)
    compression, tiled, tile_size = _inspect_tiff(tifffile, path)
    openslide_geometry: ReaderGeometry | None = None
    openslide_error: str | None = None
    try:
        with OpenSlide(path) as slide:
            openslide_geometry = _openslide_geometry(slide)
    except (OpenSlideError, OSError) as error:
        openslide_error = str(error)

    cucim_geometry: ReaderGeometry | None = None
    cucim_error: str | None = None
    device_output = False
    output_shape: tuple[int, ...] | None = None
    image = None
    try:
        image = cucim.CuImage(str(path))
        cucim_geometry = _cucim_geometry(image)
        width, height = cucim_geometry.level_dimensions[0]
        size = min(region_size, width, height)
        location = (max(0, (width - size) // 2), max(0, (height - size) // 2))
        region = image.read_region(location=location, size=(size, size), level=0, device="cuda")
        array = cupy.asarray(region)
        cupy.cuda.get_current_stream().synchronize()
        device_output = hasattr(array, "__cuda_array_interface__")
        output_shape = tuple(int(value) for value in array.shape)
    except (OSError, RuntimeError, ValueError) as error:
        cucim_error = str(error)
    finally:
        if image is not None:
            image.close()

    pyramid_match = _pyramid_matches(openslide_geometry, cucim_geometry)
    mpp_match = _mpp_matches(openslide_geometry, cucim_geometry)
    associated_match = _associated_images_match(openslide_geometry, cucim_geometry)
    geometry_match = pyramid_match and mpp_match and associated_match
    eligible = openslide_geometry is not None and device_output and geometry_match
    measurement_eligible = (
        openslide_geometry is not None
        and device_output
        and _requested_level_matches(openslide_geometry, cucim_geometry, logical_level)
    )
    if eligible:
        reason = (
            "cuCIM returned CUDA pixels and matched OpenSlide pyramid, MPP, "
            "and associated-image geometry"
        )
    elif openslide_geometry is None:
        reason = "OpenSlide could not supply the required CPU fallback and geometry oracle"
    elif not device_output:
        reason = "cuCIM did not return a CUDA-resident region"
    elif not measurement_eligible:
        reason = "cuCIM did not preserve OpenSlide pyramid, MPP, or associated-image semantics"
    else:
        mismatches = ", ".join(
            name
            for name, matched in (
                ("pyramid", pyramid_match),
                ("MPP", mpp_match),
                ("associated images", associated_match),
            )
            if not matched
        )
        reason = f"measurement only at logical level {logical_level}; cuCIM mismatched {mismatches}"
    return TiffFixtureProbe(
        path=member.path,
        expected_format=member.format,
        expected_codec=member.codec,
        expected_bytes=member.bytes,
        sha256=actual_sha256,
        sha256_verified=actual_sha256 == member.sha256 and path.stat().st_size == member.bytes,
        tiff_compression=compression,
        tiff_is_tiled=tiled,
        tiff_tile_size=tile_size,
        openslide_supported=openslide_geometry is not None,
        openslide_error=openslide_error,
        openslide_geometry=openslide_geometry,
        cucim_supported=cucim_geometry is not None,
        cucim_error=cucim_error,
        cucim_geometry=cucim_geometry,
        cucim_device_output=device_output,
        device_output_shape=output_shape,
        pyramid_geometry_match=pyramid_match,
        microns_per_pixel_match=mpp_match,
        associated_images_match=associated_match,
        semantic_geometry_match=geometry_match,
        accelerator_eligible=eligible,
        measurement_eligible=measurement_eligible,
        selection_reason=reason,
        decoder_evidence=_decoder_evidence(member, device_output),
        remaining_host_work=(
            "ordinary filesystem reads and TIFF metadata parsing on the host",
            "compressed tile bytes staged through host memory before nvImageCodec decode",
        )
        if device_output
        else (),
    )


def _pinned_batch(cupy: Any, shape: tuple[int, int, int, int]) -> np.ndarray[Any, Any]:
    byte_count = int(np.prod(shape, dtype=np.int64))
    memory = cupy.cuda.alloc_pinned_memory(byte_count)
    return np.frombuffer(memory, dtype=np.uint8, count=byte_count).reshape(shape)


def _consumer_weights(cupy: Any) -> Any:
    return cupy.asarray(
        (
            (0.25, -0.50, 0.75, 1.00, -0.25, 0.50, -0.75, 0.125),
            (-0.75, 0.25, 0.50, -0.50, 1.00, 0.125, -0.25, 0.75),
            (0.50, 0.75, -0.25, 0.125, -0.50, 1.00, 0.25, -0.75),
        ),
        dtype=cupy.float32,
    )


def _preprocess(cupy: Any, batch: Any, output_size: int) -> Any:
    height, width = batch.shape[1:3]
    top = (height - output_size) // 2
    left = (width - output_size) // 2
    cropped = batch[:, top : top + output_size, left : left + output_size, :3]
    tensor = cropped.transpose(0, 3, 1, 2).astype(cupy.float32) / 255.0
    mean = cupy.asarray((0.485, 0.456, 0.406), dtype=cupy.float32).reshape(1, 3, 1, 1)
    std = cupy.asarray((0.229, 0.224, 0.225), dtype=cupy.float32).reshape(1, 3, 1, 1)
    return (tensor - mean) / std


def _consume(prepared: Any, weights: Any) -> Any:
    channels_last = prepared.transpose(0, 2, 3, 1)
    projected = (channels_last[..., :, None] * weights).sum(axis=3)
    return projected.mean(axis=(1, 2))


def _prime_shared_device_kernels(cupy: Any, config: TiffGpuBenchmarkConfig, weights: Any) -> None:
    batch = cupy.zeros((1, config.region_size, config.region_size, 3), dtype=cupy.uint8)
    prepared = _preprocess(cupy, batch, config.output_size)
    _consume(prepared, weights)
    cupy.cuda.get_current_stream().synchronize()
    cupy.get_default_memory_pool().free_all_blocks()


def _read_openslide_batch(
    slide: OpenSlide,
    locations: tuple[tuple[int, int], ...],
    logical_level: int,
    region_size: int,
) -> tuple[Any, ...]:
    return tuple(
        slide.read_region(location, logical_level, (region_size, region_size))
        for location in locations
    )


def _pack_openslide_rgb(images: tuple[Any, ...], pinned: np.ndarray[Any, Any]) -> None:
    for index, image in enumerate(images):
        try:
            np.copyto(pinned[index], np.asarray(image.convert("RGB"), dtype=np.uint8))
        finally:
            image.close()


def _read_cucim_batch(
    cupy: Any,
    image: Any,
    locations: tuple[tuple[int, int], ...],
    logical_level: int,
    region_size: int,
) -> Any:
    regions = image.read_region(
        location=[list(value) for value in locations],
        size=(region_size, region_size),
        level=logical_level,
        device="cuda",
        batch_size=len(locations),
    )
    if not hasattr(regions, "__cuda_array_interface__"):
        completed = tuple(regions)
        if len(completed) != 1:
            raise ValueError(
                f"cuCIM returned {len(completed)} completed batches for one read request"
            )
        regions = completed[0]
    batch = cupy.asarray(regions)
    if batch.ndim == 3:
        batch = batch[None, ...]
    if batch.ndim != 4:
        raise ValueError(f"cuCIM returned an unexpected batch shape: {batch.shape}")
    return batch[..., :3]


def _sample_cpu_pipeline(
    cupy: Any,
    slide: OpenSlide,
    locations: tuple[tuple[int, int], ...],
    config: TiffGpuBenchmarkConfig,
    pinned: np.ndarray[Any, Any],
    weights: Any,
) -> tuple[dict[str, _Measurement], float, float]:
    stream = cupy.cuda.get_current_stream()
    stream.synchronize()
    process_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    decoded_bytes = int(pinned.nbytes)
    images, decode = _measure_cpu(
        lambda: _read_openslide_batch(slide, locations, config.logical_level, config.region_size),
        host_bytes=decoded_bytes * 4 // 3,
    )
    _, pack = _measure_cpu(lambda: _pack_openslide_rgb(images, pinned), host_bytes=decoded_bytes)
    device_batch = cupy.empty(pinned.shape, dtype=cupy.uint8)
    _, transfer = _measure_cuda(
        cupy,
        lambda: device_batch.set(pinned, stream=stream),
        host_bytes=decoded_bytes,
        device_bytes=decoded_bytes,
    )
    prepared, preprocess = _measure_cuda(
        cupy,
        lambda: _preprocess(cupy, device_batch, config.output_size),
        device_bytes=int(device_batch.nbytes),
    )
    _, consumer = _measure_cuda(
        cupy,
        lambda: _consume(prepared, weights),
        device_bytes=int(prepared.nbytes),
    )
    stream.synchronize()
    return (
        {
            "openslide_host_decode_rgba": decode,
            "host_rgb_pack_pinned": pack,
            "host_to_device": transfer,
            "device_preprocess": preprocess,
            "consumer": consumer,
        },
        (time.perf_counter_ns() - wall_start) / 1_000_000,
        (time.process_time_ns() - process_start) / 1_000_000,
    )


def _sample_cucim_pipeline(
    cupy: Any,
    image: Any,
    locations: tuple[tuple[int, int], ...],
    config: TiffGpuBenchmarkConfig,
    weights: Any,
) -> tuple[dict[str, _Measurement], float, float]:
    stream = cupy.cuda.get_current_stream()
    stream.synchronize()
    process_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    decoded_bytes = len(locations) * config.region_size * config.region_size * 3
    device_batch, decode = _measure_cpu(
        lambda: _read_cucim_batch(cupy, image, locations, config.logical_level, config.region_size),
        device_bytes=decoded_bytes,
    )
    prepared, preprocess = _measure_cuda(
        cupy,
        lambda: _preprocess(cupy, device_batch, config.output_size),
        device_bytes=int(device_batch.nbytes),
    )
    _, consumer = _measure_cuda(
        cupy,
        lambda: _consume(prepared, weights),
        device_bytes=int(prepared.nbytes),
    )
    stream.synchronize()
    return (
        {
            "cucim_nvimagecodec_device_decode_and_pack": decode,
            "device_preprocess": preprocess,
            "consumer": consumer,
        },
        (time.perf_counter_ns() - wall_start) / 1_000_000,
        (time.process_time_ns() - process_start) / 1_000_000,
    )


def _case_result(
    fixture_path: str,
    pipeline: TiffPipeline,
    access_pattern: AccessPattern,
    batch_size: int,
    runtime_state: Literal["first_sample_after_correctness_probe", "steady_state"],
    samples: tuple[tuple[dict[str, _Measurement], float, float], ...],
    cupy: Any,
) -> TiffPipelineCase:
    wall = statistics.median(value[1] for value in samples)
    return TiffPipelineCase(
        fixture_path=fixture_path,
        pipeline=pipeline,
        access_pattern=access_pattern,
        batch_size=batch_size,
        runtime_state=runtime_state,
        repetitions=len(samples),
        stages=summarize_stages(tuple(value[0] for value in samples)),
        median_end_to_end_wall_milliseconds=wall,
        median_end_to_end_process_cpu_milliseconds=statistics.median(value[2] for value in samples),
        throughput_regions_per_second=batch_size * 1000 / wall if wall else 0,
        peak_host_rss_bytes=_peak_rss_bytes(),
        cupy_pool_reserved_bytes=int(cupy.get_default_memory_pool().total_bytes()),
    )


def _run_case(
    cupy: Any,
    slide: OpenSlide,
    image: Any,
    locations: tuple[tuple[int, int], ...],
    config: TiffGpuBenchmarkConfig,
    weights: Any,
    fixture_path: str,
    pipeline: TiffPipeline,
    access_pattern: AccessPattern,
) -> tuple[TiffPipelineCase, TiffPipelineCase]:
    pinned = (
        _pinned_batch(cupy, (len(locations), config.region_size, config.region_size, 3))
        if pipeline == "openslide_cpu_pinned_h2d"
        else None
    )

    def sample() -> tuple[dict[str, _Measurement], float, float]:
        if pipeline == "openslide_cpu_pinned_h2d":
            if pinned is None:
                raise RuntimeError("the OpenSlide pipeline requires a pinned host buffer")
            return _sample_cpu_pipeline(cupy, slide, locations, config, pinned, weights)
        return _sample_cucim_pipeline(cupy, image, locations, config, weights)

    memory_pool = cupy.get_default_memory_pool()
    memory_pool.free_all_blocks()
    first = sample()
    for _ in range(config.warmup_repetitions):
        sample()
    memory_pool.free_all_blocks()
    steady = tuple(sample() for _ in range(config.measured_repetitions))
    return (
        _case_result(
            fixture_path,
            pipeline,
            access_pattern,
            len(locations),
            "first_sample_after_correctness_probe",
            (first,),
            cupy,
        ),
        _case_result(
            fixture_path,
            pipeline,
            access_pattern,
            len(locations),
            "steady_state",
            steady,
            cupy,
        ),
    )


def _pixel_agreement(
    cupy: Any,
    slide: OpenSlide,
    image: Any,
    locations: tuple[tuple[int, int], ...],
    config: TiffGpuBenchmarkConfig,
    fixture_path: str,
) -> TiffPixelAgreement:
    candidate = cupy.asnumpy(
        _read_cucim_batch(cupy, image, locations, config.logical_level, config.region_size)
    )
    expected_images = _read_openslide_batch(
        slide, locations, config.logical_level, config.region_size
    )
    expected = np.empty(candidate.shape, dtype=np.uint8)
    _pack_openslide_rgb(expected_images, expected)
    absolute = np.abs(candidate.astype(np.int16) - expected.astype(np.int16))
    maximum = int(absolute.max())
    return TiffPixelAgreement(
        fixture_path=fixture_path,
        samples=len(locations),
        maximum_absolute_error=maximum,
        mean_absolute_error=float(absolute.mean()),
        tolerance=config.pixel_absolute_tolerance,
        passed=maximum <= config.pixel_absolute_tolerance,
    )


def _viewer_cpu(
    slide: OpenSlide,
    location: tuple[int, int],
    config: TiffGpuBenchmarkConfig,
    fixture_path: str,
) -> TiffViewerCpuResult:
    decode_samples: list[float] = []
    encode_samples: list[float] = []
    png_sizes: list[int] = []
    for _ in range(config.measured_repetitions):
        image, decode = _measure_cpu(
            lambda: slide.read_region(
                location,
                config.logical_level,
                (config.region_size, config.region_size),
            )
        )
        target = io.BytesIO()
        try:
            _, encode = _measure_cpu(
                lambda selected=image, output=target: selected.save(output, format="PNG")
            )
        finally:
            image.close()
        decode_samples.append(decode.wall_milliseconds)
        encode_samples.append(encode.wall_milliseconds)
        png_sizes.append(target.tell())
    return TiffViewerCpuResult(
        fixture_path=fixture_path,
        median_decode_milliseconds=statistics.median(decode_samples),
        median_png_encode_milliseconds=statistics.median(encode_samples),
        median_png_bytes=int(statistics.median(png_sizes)),
    )


def _read_first_value(path: Path, prefix: str) -> str:
    if not path.exists():
        return "unknown"
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(prefix):
            return line.split(":", 1)[1].strip()
    return "unknown"


def _environment(cupy: Any, tifffile: Any) -> TiffBenchmarkEnvironment:
    properties = cupy.cuda.runtime.getDeviceProperties(0)
    device_name = properties["name"]
    if isinstance(device_name, bytes):
        device_name = device_name.decode("utf-8")
    gpu_uuid = os.environ.get("PATHOLOGIZE_NVIDIA_GPU_UUID", "unavailable")
    driver = os.environ.get(
        "PATHOLOGIZE_NVIDIA_DRIVER_VERSION",
        f"CUDA driver API {cupy.cuda.runtime.driverGetVersion()}",
    )
    import openslide

    return TiffBenchmarkEnvironment(
        host_kernel=platform.platform(),
        cpu_model=_read_first_value(Path("/proc/cpuinfo"), "model name"),
        cpu_logical_count=os.cpu_count() or 1,
        host_memory_bytes=int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")),
        gpu_name=str(device_name),
        gpu_uuid=gpu_uuid,
        gpu_compute_capability=f"{properties['major']}.{properties['minor']}",
        gpu_memory_bytes=int(properties["totalGlobalMem"]),
        driver_version=driver,
        cuda_runtime_version=str(cupy.cuda.runtime.runtimeGetVersion()),
        python_version=sys.version.split()[0],
        cucim_version=metadata.version("cucim-cu12"),
        nvimagecodec_version=metadata.version("nvidia-nvimgcodec-cu12"),
        cupy_version=metadata.version("cupy-cuda12x"),
        openslide_python_version=str(openslide.__version__),
        openslide_library_version=str(openslide.__library_version__),
        tifffile_version=str(tifffile.__version__),
    )


def _run_selected_fixtures(
    cupy: Any,
    cucim: Any,
    config: TiffGpuBenchmarkConfig,
    probes: tuple[TiffFixtureProbe, ...],
) -> tuple[
    tuple[TiffPipelineCase, ...],
    tuple[TiffPixelAgreement, ...],
    tuple[TiffViewerCpuResult, ...],
    tuple[str, ...],
]:
    probe_by_path = {probe.path: probe for probe in probes}
    weights = _consumer_weights(cupy)
    _prime_shared_device_kernels(cupy, config, weights)
    cases: list[TiffPipelineCase] = []
    agreements: list[TiffPixelAgreement] = []
    viewer_results: list[TiffViewerCpuResult] = []
    omissions: list[str] = []
    for fixture_path in config.benchmark_fixture_paths:
        probe = probe_by_path[fixture_path]
        if not probe.measurement_eligible or probe.openslide_geometry is None:
            omissions.append(f"{fixture_path}: {probe.selection_reason}")
            continue
        path = config.fixture_root / fixture_path
        with OpenSlide(path) as slide:
            image = cucim.CuImage(str(path))
            try:
                geometry = probe.openslide_geometry
                if config.logical_level >= len(geometry.level_dimensions):
                    omissions.append(
                        f"{fixture_path}: logical level {config.logical_level} is unavailable"
                    )
                    continue
                locations = complete_region_locations(
                    geometry.level_dimensions[config.logical_level],
                    region_size=config.region_size,
                    downsample=geometry.level_downsamples[config.logical_level],
                )
                if not locations:
                    omissions.append(f"{fixture_path}: no complete benchmark regions")
                    continue
                agreement_count = min(config.correctness_samples, len(locations))
                agreement_locations = select_region_locations(
                    locations,
                    access_pattern="random",
                    batch_size=agreement_count,
                    seed=config.random_seed,
                )
                agreement = _pixel_agreement(
                    cupy, slide, image, agreement_locations, config, fixture_path
                )
                agreements.append(agreement)
                if not agreement.passed:
                    omissions.append(
                        f"{fixture_path}: pixel error {agreement.maximum_absolute_error} exceeds "
                        f"tolerance {agreement.tolerance}"
                    )
                    continue
                viewer_results.append(
                    _viewer_cpu(slide, agreement_locations[0], config, fixture_path)
                )
                for access_pattern in config.access_patterns:
                    for batch_size in config.batch_sizes:
                        if batch_size > len(locations):
                            omissions.append(
                                f"{fixture_path}: batch {batch_size} exceeds {len(locations)} "
                                f"complete regions for {access_pattern} access"
                            )
                            continue
                        selected = select_region_locations(
                            locations,
                            access_pattern=access_pattern,
                            batch_size=batch_size,
                            seed=config.random_seed + batch_size,
                        )
                        for pipeline in cast(
                            tuple[TiffPipeline, ...],
                            ("openslide_cpu_pinned_h2d", "cucim_cuslide2_device"),
                        ):
                            cases.extend(
                                _run_case(
                                    cupy,
                                    slide,
                                    image,
                                    selected,
                                    config,
                                    weights,
                                    fixture_path,
                                    pipeline,
                                    access_pattern,
                                )
                            )
            finally:
                image.close()
    return tuple(cases), tuple(agreements), tuple(viewer_results), tuple(omissions)


def run_tiff_gpu_decode_benchmark(config: TiffGpuBenchmarkConfig) -> TiffGpuBenchmarkReport:
    cupy = cast(Any, import_module("cupy"))
    cucim = cast(Any, import_module("cucim"))
    tifffile = cast(Any, import_module("tifffile"))
    if cupy.cuda.runtime.getDeviceCount() < 1:
        raise RuntimeError("CUDA is unavailable; run this benchmark with the bounded GPU image")
    if os.environ.get("ENABLE_CUSLIDE2") != "1":
        raise RuntimeError("ENABLE_CUSLIDE2=1 is required so the trial cannot use legacy cuslide")
    if config.output_size > config.region_size:
        raise ValueError("output_size must not exceed region_size")

    manifest = load_fixture_manifest(config.fixture_manifest)
    members = fixture_members(manifest)
    missing = tuple(
        member.path for member in members if not (config.fixture_root / member.path).is_file()
    )
    if missing:
        raise FileNotFoundError(f"fixture files are missing: {', '.join(missing)}")
    probes = tuple(
        _probe_fixture(
            cupy,
            cucim,
            tifffile,
            config.fixture_root,
            member,
            config.region_size,
            config.logical_level,
        )
        for member in members
    )
    invalid = tuple(probe.path for probe in probes if not probe.sha256_verified)
    if invalid:
        raise ValueError(f"fixture digest or size mismatch: {', '.join(invalid)}")

    member_paths = {member.path for member in members}
    unknown = tuple(path for path in config.benchmark_fixture_paths if path not in member_paths)
    if unknown:
        raise ValueError(f"benchmark fixture is not declared: {', '.join(unknown)}")

    cases, agreements, viewer_results, omissions = _run_selected_fixtures(
        cupy, cucim, config, probes
    )

    return TiffGpuBenchmarkReport(
        config=config,
        environment=_environment(cupy, tifffile),
        probes=probes,
        pixel_agreement=agreements,
        viewer_cpu=viewer_results,
        cases=cases,
        omissions=omissions,
    )
