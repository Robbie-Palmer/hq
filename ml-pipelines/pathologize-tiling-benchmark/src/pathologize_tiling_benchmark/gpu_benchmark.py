from __future__ import annotations

import io
import os
import random
import resource
import statistics
import time
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np
from pathologize_tiler import DicomSlide, NvImageCodecDecoder, decode_dicom_frames_nvimagecodec

from .gpu_contracts import (
    BenchmarkEnvironment,
    GpuBenchmarkConfig,
    GpuDecodeBenchmarkReport,
    PipelineCaseResult,
    PixelAgreement,
    StageMeasurement,
    StageSummary,
    ViewerCpuResult,
)

Pipeline = Literal["cpu_decode_pinned_h2d", "nvimagecodec_device_decode"]


def parse_batch_sizes(value: int | str | tuple[int, ...]) -> tuple[int, ...]:
    if isinstance(value, tuple):
        return value
    if isinstance(value, int):
        return (value,)
    try:
        return tuple(int(part.strip()) for part in value.split(",") if part.strip())
    except ValueError as error:
        raise ValueError("batch_sizes must be a comma-separated list of integers") from error


def complete_tile_coordinates(
    dimensions: tuple[int, int], tile_size: tuple[int, int]
) -> tuple[tuple[int, int], ...]:
    width = dimensions[0] // tile_size[0]
    height = dimensions[1] // tile_size[1]
    return tuple((x, y) for y in range(height) for x in range(width))


def select_coordinates(
    coordinates: tuple[tuple[int, int], ...],
    *,
    access_pattern: Literal["contiguous", "random"],
    batch_size: int,
    seed: int,
) -> tuple[tuple[int, int], ...]:
    if batch_size > len(coordinates):
        raise ValueError(f"batch size {batch_size} exceeds the level's {len(coordinates)} tiles")
    if access_pattern == "random":
        return tuple(
            random.Random(seed).sample(  # noqa: S311 - deterministic benchmark sampling.
                coordinates, batch_size
            )
        )
    midpoint = len(coordinates) // 2
    start = min(max(0, midpoint - batch_size // 2), len(coordinates) - batch_size)
    return coordinates[start : start + batch_size]


def summarize_stages(
    measurements: tuple[dict[str, StageMeasurement], ...],
) -> dict[str, StageSummary]:
    if not measurements:
        raise ValueError("at least one stage measurement is required")
    names = tuple(measurements[0])
    if any(tuple(sample) != names for sample in measurements):
        raise ValueError("stage measurement names and order must match")
    summaries: dict[str, StageSummary] = {}
    for name in names:
        samples = tuple(measurement[name] for measurement in measurements)
        cuda_samples = tuple(
            sample.cuda_milliseconds for sample in samples if sample.cuda_milliseconds is not None
        )
        summaries[name] = StageSummary(
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
    return summaries


def _measure_cpu[T](
    operation: Callable[[], T], *, host_bytes: int = 0
) -> tuple[T, StageMeasurement]:
    cpu_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    result = operation()
    wall_elapsed = time.perf_counter_ns() - wall_start
    cpu_elapsed = time.process_time_ns() - cpu_start
    return result, StageMeasurement(
        wall_milliseconds=wall_elapsed / 1_000_000,
        process_cpu_milliseconds=cpu_elapsed / 1_000_000,
        host_bytes=host_bytes,
    )


def _measure_cuda[T](
    cupy: Any,
    operation: Callable[[], T],
    *,
    host_bytes: int = 0,
    device_bytes: int = 0,
) -> tuple[T, StageMeasurement]:
    cupy.cuda.get_current_stream().synchronize()
    start_event = cupy.cuda.Event()
    end_event = cupy.cuda.Event()
    cpu_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    start_event.record()
    result = operation()
    end_event.record()
    end_event.synchronize()
    wall_elapsed = time.perf_counter_ns() - wall_start
    cpu_elapsed = time.process_time_ns() - cpu_start
    return result, StageMeasurement(
        wall_milliseconds=wall_elapsed / 1_000_000,
        process_cpu_milliseconds=cpu_elapsed / 1_000_000,
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
    cropped = batch[:, top : top + output_size, left : left + output_size, :]
    tensor = cropped.transpose(0, 3, 1, 2).astype(cupy.float32) / 255.0
    mean = cupy.asarray((0.485, 0.456, 0.406), dtype=cupy.float32).reshape(1, 3, 1, 1)
    std = cupy.asarray((0.229, 0.224, 0.225), dtype=cupy.float32).reshape(1, 3, 1, 1)
    return (tensor - mean) / std


def _consume(prepared: Any, weights: Any) -> Any:
    channels_last = prepared.transpose(0, 2, 3, 1)
    projected = (channels_last[..., :, None] * weights).sum(axis=3)
    return projected.mean(axis=(1, 2))


def _pinned_batch(cupy: Any, shape: tuple[int, int, int, int]) -> np.ndarray[Any, Any]:
    byte_count = int(np.prod(shape, dtype=np.int64))
    memory = cupy.cuda.alloc_pinned_memory(byte_count)
    return np.frombuffer(memory, dtype=np.uint8, count=byte_count).reshape(shape)


def _pack_host(
    slide: DicomSlide,
    logical_level: int,
    coordinates: tuple[tuple[int, int], ...],
    pinned: Any,
) -> None:
    for index, coordinate in enumerate(coordinates):
        tile = slide.read_host_tile(logical_level, coordinate)
        with tile.image:
            np.copyto(pinned[index], np.asarray(tile.image, dtype=np.uint8))


def _cpu_pipeline_stages(
    cupy: Any,
    slide: DicomSlide,
    weights: Any,
    coordinates: tuple[tuple[int, int], ...],
    logical_level: int,
    output_size: int,
    pinned: Any,
) -> dict[str, StageMeasurement]:
    decoded, decode_measurement = _measure_cpu(
        lambda: tuple(
            slide.read_host_tile(logical_level, coordinate) for coordinate in coordinates
        ),
        host_bytes=int(pinned.nbytes),
    )

    def pack_decoded() -> None:
        for index, tile in enumerate(decoded):
            with tile.image:
                np.copyto(pinned[index], np.asarray(tile.image, dtype=np.uint8))

    _, pack_measurement = _measure_cpu(pack_decoded, host_bytes=int(pinned.nbytes))
    device_batch = cupy.empty(pinned.shape, dtype=cupy.uint8)
    _, transfer_measurement = _measure_cuda(
        cupy,
        lambda: device_batch.set(pinned, stream=cupy.cuda.get_current_stream()),
        host_bytes=int(pinned.nbytes),
        device_bytes=int(pinned.nbytes),
    )
    prepared, preprocess_measurement = _measure_cuda(
        cupy,
        lambda: _preprocess(cupy, device_batch, output_size),
        device_bytes=int(device_batch.nbytes),
    )
    _, consumer_measurement = _measure_cuda(
        cupy,
        lambda: _consume(prepared, weights),
        device_bytes=int(prepared.nbytes),
    )
    return {
        "host_decode": decode_measurement,
        "host_pack_pinned": pack_measurement,
        "host_to_device": transfer_measurement,
        "device_preprocess": preprocess_measurement,
        "consumer": consumer_measurement,
    }


def _device_pipeline_stages(
    cupy: Any,
    slide: DicomSlide,
    decoder: NvImageCodecDecoder,
    weights: Any,
    coordinates: tuple[tuple[int, int], ...],
    logical_level: int,
    output_size: int,
    tile_size: tuple[int, int],
) -> dict[str, StageMeasurement]:
    frames, lookup_measurement = _measure_cpu(
        lambda: tuple(
            slide.read_encoded_frame(logical_level, coordinate) for coordinate in coordinates
        )
    )
    compressed_bytes = sum(len(frame.payload) for frame in frames)
    decoded_bytes = len(frames) * tile_size[0] * tile_size[1] * 3
    decoded, decode_measurement = _measure_cuda(
        cupy,
        lambda: decode_dicom_frames_nvimagecodec(frames, decoder=decoder),
        host_bytes=compressed_bytes,
        device_bytes=decoded_bytes,
    )
    device_batch, pack_measurement = _measure_cuda(
        cupy,
        lambda: cupy.stack(tuple(cupy.asarray(image) for image in decoded.images)),
        device_bytes=decoded_bytes,
    )
    prepared, preprocess_measurement = _measure_cuda(
        cupy,
        lambda: _preprocess(cupy, device_batch, output_size),
        device_bytes=int(device_batch.nbytes),
    )
    _, consumer_measurement = _measure_cuda(
        cupy,
        lambda: _consume(prepared, weights),
        device_bytes=int(prepared.nbytes),
    )
    return {
        "encoded_frame_lookup": lookup_measurement,
        "device_decode": decode_measurement,
        "device_batch_pack": pack_measurement,
        "device_preprocess": preprocess_measurement,
        "consumer": consumer_measurement,
    }


def _end_to_end(
    cupy: Any,
    slide: DicomSlide,
    decoder: NvImageCodecDecoder,
    weights: Any,
    coordinates: tuple[tuple[int, int], ...],
    config: GpuBenchmarkConfig,
    pinned: Any,
    pipeline: Pipeline,
) -> tuple[float, float]:
    stream = cupy.cuda.get_current_stream()
    stream.synchronize()
    cpu_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    if pipeline == "cpu_decode_pinned_h2d":
        _pack_host(slide, config.logical_level, coordinates, pinned)
        device_batch = cupy.empty(pinned.shape, dtype=cupy.uint8)
        device_batch.set(pinned, stream=stream)
    else:
        frames = tuple(
            slide.read_encoded_frame(config.logical_level, coordinate) for coordinate in coordinates
        )
        decoded = decode_dicom_frames_nvimagecodec(frames, decoder=decoder)
        device_batch = cupy.stack(tuple(cupy.asarray(image) for image in decoded.images))
    prepared = _preprocess(cupy, device_batch, config.output_size)
    _consume(prepared, weights)
    stream.synchronize()
    return (
        (time.perf_counter_ns() - wall_start) / 1_000_000,
        (time.process_time_ns() - cpu_start) / 1_000_000,
    )


def _run_case(
    cupy: Any,
    slide: DicomSlide,
    decoder: NvImageCodecDecoder,
    weights: Any,
    config: GpuBenchmarkConfig,
    coordinates: tuple[tuple[int, int], ...],
    tile_size: tuple[int, int],
    pipeline: Pipeline,
    access_pattern: Literal["contiguous", "random"],
) -> tuple[PipelineCaseResult, PipelineCaseResult]:
    pinned = _pinned_batch(cupy, (len(coordinates), tile_size[1], tile_size[0], 3))

    def sample() -> tuple[dict[str, StageMeasurement], float, float]:
        wall, cpu = _end_to_end(
            cupy, slide, decoder, weights, coordinates, config, pinned, pipeline
        )
        if pipeline == "cpu_decode_pinned_h2d":
            stages = _cpu_pipeline_stages(
                cupy,
                slide,
                weights,
                coordinates,
                config.logical_level,
                config.output_size,
                pinned,
            )
        else:
            stages = _device_pipeline_stages(
                cupy,
                slide,
                decoder,
                weights,
                coordinates,
                config.logical_level,
                config.output_size,
                tile_size,
            )
        return stages, wall, cpu

    memory_pool = cupy.get_default_memory_pool()
    memory_pool.free_all_blocks()
    first_stages, first_wall, first_cpu = sample()
    first_result = PipelineCaseResult(
        pipeline=pipeline,
        access_pattern=access_pattern,
        batch_size=len(coordinates),
        runtime_state="first_call",
        repetitions=1,
        stages=summarize_stages((first_stages,)),
        median_end_to_end_wall_milliseconds=first_wall,
        median_end_to_end_process_cpu_milliseconds=first_cpu,
        peak_cupy_pool_reserved_bytes=int(memory_pool.total_bytes()),
        peak_host_rss_bytes=_peak_rss_bytes(),
    )
    for _ in range(config.warmup_repetitions):
        sample()
    memory_pool.free_all_blocks()
    steady_samples = tuple(sample() for _ in range(config.measured_repetitions))
    steady_result = PipelineCaseResult(
        pipeline=pipeline,
        access_pattern=access_pattern,
        batch_size=len(coordinates),
        runtime_state="steady_state",
        repetitions=len(steady_samples),
        stages=summarize_stages(tuple(item[0] for item in steady_samples)),
        median_end_to_end_wall_milliseconds=statistics.median(item[1] for item in steady_samples),
        median_end_to_end_process_cpu_milliseconds=statistics.median(
            item[2] for item in steady_samples
        ),
        peak_cupy_pool_reserved_bytes=int(memory_pool.total_bytes()),
        peak_host_rss_bytes=_peak_rss_bytes(),
    )
    return first_result, steady_result


def _pixel_agreement(
    cupy: Any,
    slide: DicomSlide,
    decoder: NvImageCodecDecoder,
    coordinates: tuple[tuple[int, int], ...],
    config: GpuBenchmarkConfig,
) -> PixelAgreement:
    frames = tuple(slide.read_encoded_frame(config.logical_level, value) for value in coordinates)
    decoded = decode_dicom_frames_nvimagecodec(frames, decoder=decoder)
    candidate = cupy.asnumpy(cupy.stack(tuple(cupy.asarray(image) for image in decoded.images)))
    expected_images: list[np.ndarray[Any, np.dtype[np.uint8]]] = []
    for value in coordinates:
        tile = slide.read_host_tile(config.logical_level, value)
        with tile.image:
            expected_images.append(np.asarray(tile.image, dtype=np.uint8).copy())
    expected = np.stack(expected_images)
    absolute = np.abs(candidate.astype(np.int16) - expected.astype(np.int16))
    maximum = int(absolute.max())
    return PixelAgreement(
        samples=len(coordinates),
        maximum_absolute_error=maximum,
        mean_absolute_error=float(absolute.mean()),
        tolerance=config.pixel_absolute_tolerance,
        passed=maximum <= config.pixel_absolute_tolerance,
    )


def _viewer_cpu(
    slide: DicomSlide,
    coordinate: tuple[int, int],
    config: GpuBenchmarkConfig,
) -> ViewerCpuResult:
    decode_samples: list[float] = []
    encode_samples: list[float] = []
    sizes: list[int] = []
    decoder = "unknown"
    for _ in range(config.measured_repetitions):
        tile, decode = _measure_cpu(lambda: slide.read_host_tile(config.logical_level, coordinate))
        decoder = tile.decoder
        target = io.BytesIO()
        with tile.image:
            _, encode = _measure_cpu(
                lambda selected=tile, output=target: selected.image.save(output, format="PNG")
            )
        decode_samples.append(decode.wall_milliseconds)
        encode_samples.append(encode.wall_milliseconds)
        sizes.append(target.tell())
    return ViewerCpuResult(
        decoder=decoder,
        median_decode_milliseconds=statistics.median(decode_samples),
        median_png_encode_milliseconds=statistics.median(encode_samples),
        median_png_bytes=int(statistics.median(sizes)),
    )


def run_gpu_decode_benchmark(config: GpuBenchmarkConfig) -> GpuDecodeBenchmarkReport:
    cupy = cast(Any, import_module("cupy"))
    if cupy.cuda.runtime.getDeviceCount() < 1:
        raise RuntimeError("CUDA is unavailable; run this benchmark in the Vector GPU job image")
    decoder = NvImageCodecDecoder()
    weights = _consumer_weights(cupy)
    cases: list[PipelineCaseResult] = []
    with DicomSlide.open(
        config.fixture_root,
        decoded_frame_cache_size=0,
        encoded_frame_cache_size=0,
    ) as slide:
        selected_level = next(
            (
                level
                for level in slide.metadata.levels
                if level.logical_level == config.logical_level
            ),
            None,
        )
        if selected_level is None:
            raise ValueError(f"fixture does not contain logical level {config.logical_level}")
        if config.output_size > min(selected_level.tile_size):
            raise ValueError(
                f"output size {config.output_size} exceeds tile size {selected_level.tile_size}"
            )
        all_coordinates = complete_tile_coordinates(
            selected_level.dimensions, selected_level.tile_size
        )
        agreement_coordinates = select_coordinates(
            all_coordinates,
            access_pattern="random",
            batch_size=config.correctness_samples,
            seed=config.random_seed,
        )
        agreement = _pixel_agreement(cupy, slide, decoder, agreement_coordinates, config)
        if not agreement.passed:
            raise ValueError(
                f"device decode pixel error {agreement.maximum_absolute_error} exceeds "
                f"tolerance {agreement.tolerance}"
            )
        viewer = _viewer_cpu(slide, agreement_coordinates[0], config)
        for access_pattern in config.access_patterns:
            for batch_size in config.batch_sizes:
                coordinates = select_coordinates(
                    all_coordinates,
                    access_pattern=access_pattern,
                    batch_size=batch_size,
                    seed=config.random_seed + batch_size,
                )
                for pipeline in cast(
                    tuple[Pipeline, ...],
                    ("cpu_decode_pinned_h2d", "nvimagecodec_device_decode"),
                ):
                    cases.extend(
                        _run_case(
                            cupy,
                            slide,
                            decoder,
                            weights,
                            config,
                            coordinates,
                            selected_level.tile_size,
                            pipeline,
                            access_pattern,
                        )
                    )
        sample_frame = slide.read_encoded_frame(config.logical_level, agreement_coordinates[0])
        properties = cupy.cuda.runtime.getDeviceProperties(0)
        device_name = properties["name"]
        if isinstance(device_name, bytes):
            device_name = device_name.decode("utf-8")
        environment = BenchmarkEnvironment(
            cupy_version=str(cupy.__version__),
            cuda_runtime_version=str(cupy.cuda.runtime.runtimeGetVersion()),
            device_name=str(device_name),
            device_capability=f"{properties['major']}.{properties['minor']}",
            nvimagecodec_backend="nvimagecodec",
            fixture_root=str(config.fixture_root),
            fixture_transfer_syntax=sample_frame.transfer_syntax_uid,
            fixture_photometric_interpretation=sample_frame.photometric_interpretation,
            fixture_tile_size=selected_level.tile_size,
            fixture_microns_per_pixel=selected_level.microns_per_pixel,
            fixture_complete_tile_count=len(all_coordinates),
        )
    return GpuDecodeBenchmarkReport(
        config=config,
        environment=environment,
        pixel_agreement=agreement,
        viewer_cpu=viewer,
        cases=tuple(cases),
    )
