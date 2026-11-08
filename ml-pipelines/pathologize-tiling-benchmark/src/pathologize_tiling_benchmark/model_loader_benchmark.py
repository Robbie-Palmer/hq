from __future__ import annotations

import hashlib
import json
import os
import platform
import queue
import socket
import statistics
import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass
from importlib import import_module, metadata
from pathlib import Path
from typing import Any, cast

import numpy as np
from pathologize_tiler import DicomSlide, NvImageCodecDecoder, decode_dicom_frames_nvimagecodec
from pathologize_tiler.dicom import EncodedDicomFrame

from .gpu_benchmark import complete_tile_coordinates
from .model_loader_contracts import (
    AccessPattern,
    DependencyVersion,
    FixtureAsset,
    LoaderBenchmarkEnvironment,
    ModelLoaderBenchmarkConfig,
    ModelLoaderBenchmarkReport,
    ModelLoaderCaseResult,
    Pipeline,
    RuntimeMeasurement,
    StageSummary,
    Workload,
)


def parse_positive_integers(value: int | str | tuple[int, ...]) -> tuple[int, ...]:
    if isinstance(value, tuple):
        return value
    if isinstance(value, int):
        return (value,)
    try:
        return tuple(int(part.strip()) for part in value.split(",") if part.strip())
    except ValueError as error:
        raise ValueError("value must be a comma-separated list of integers") from error


def plan_coordinate_batches(
    coordinates: tuple[tuple[int, int], ...],
    *,
    access_pattern: AccessPattern,
    batch_size: int,
    batch_count: int,
    seed: int,
) -> tuple[tuple[tuple[int, int], ...], ...]:
    if not coordinates:
        raise ValueError("at least one complete tile is required")
    if batch_size > len(coordinates):
        raise ValueError(f"batch size {batch_size} exceeds {len(coordinates)} complete tiles")
    selected: list[tuple[int, int]] = []
    cycle_index = 0
    while len(selected) < batch_size * batch_count:
        cycle = list(coordinates)
        if access_pattern == "random":
            # Hash ranking is reproducible and carries no security semantics.
            cycle.sort(
                key=lambda coordinate: hashlib.sha256(
                    f"{seed}:{cycle_index}:{coordinate[0]}:{coordinate[1]}".encode()
                ).digest()
            )
        else:
            offset = seed % len(cycle)
            cycle = cycle[offset:] + cycle[:offset]
        selected.extend(cycle)
        cycle_index += 1
    selected = selected[: batch_size * batch_count]
    return tuple(
        tuple(selected[start : start + batch_size]) for start in range(0, len(selected), batch_size)
    )


@dataclass(frozen=True, slots=True)
class _LoadRequest:
    index: int
    coordinates: tuple[tuple[int, int], ...]
    pinned: Any | None


@dataclass(frozen=True, slots=True)
class _PreparedBatch:
    index: int
    pinned: Any | None
    frames: tuple[EncodedDicomFrame, ...]
    producer_wall_milliseconds: float
    producer_cpu_milliseconds: float
    ready_ns: int
    compressed_bytes: int
    uncompressed_bytes: int


@dataclass(frozen=True, slots=True)
class _StageSample:
    name: str
    wall_milliseconds: float
    process_cpu_milliseconds: float
    cuda_milliseconds: float | None = None
    counts_as_work: bool = True


@dataclass(frozen=True, slots=True)
class _CudaStage:
    name: str
    start: Any
    end: Any


class _ConcurrentLoader:
    def __init__(
        self,
        *,
        fixture_root: Path,
        logical_level: int,
        pipeline: Pipeline,
        concurrency: int,
        output_queue_depth: int,
        tile_size: tuple[int, int],
    ) -> None:
        self._fixture_root = fixture_root
        self._logical_level = logical_level
        self._pipeline = pipeline
        self._tile_size = tile_size
        self._requests: queue.Queue[_LoadRequest | None] = queue.Queue()
        self._results: queue.Queue[_PreparedBatch | BaseException] = queue.Queue(
            maxsize=output_queue_depth
        )
        self._threads = tuple(
            threading.Thread(
                target=self._worker,
                name=f"pathologize-loader-{index}",
                daemon=True,
            )
            for index in range(concurrency)
        )
        for thread in self._threads:
            thread.start()

    def _worker(self) -> None:
        try:
            with DicomSlide.open(
                self._fixture_root,
                decoded_frame_cache_size=0,
                encoded_frame_cache_size=0,
            ) as slide:
                while (request := self._requests.get()) is not None:
                    wall_start = time.perf_counter_ns()
                    cpu_start = time.thread_time_ns()
                    frames: tuple[EncodedDicomFrame, ...] = ()
                    compressed_bytes = 0
                    if self._pipeline == "cpu_decode_pinned_h2d":
                        destination = _require_pinned(request).numpy()
                        for index, coordinate in enumerate(request.coordinates):
                            tile = slide.read_host_tile(self._logical_level, coordinate)
                            with tile.image:
                                np.copyto(
                                    destination[index], np.asarray(tile.image, dtype=np.uint8)
                                )
                    else:
                        frames = tuple(
                            slide.read_encoded_frame(self._logical_level, coordinate)
                            for coordinate in request.coordinates
                        )
                        compressed_bytes = sum(len(frame.payload) for frame in frames)
                    cpu_elapsed = time.thread_time_ns() - cpu_start
                    wall_elapsed = time.perf_counter_ns() - wall_start
                    uncompressed_bytes = (
                        int(request.pinned.numel())
                        if request.pinned is not None
                        else len(request.coordinates) * self._tile_size[0] * self._tile_size[1] * 3
                    )
                    self._results.put(
                        _PreparedBatch(
                            index=request.index,
                            pinned=request.pinned,
                            frames=frames,
                            producer_wall_milliseconds=wall_elapsed / 1_000_000,
                            producer_cpu_milliseconds=cpu_elapsed / 1_000_000,
                            ready_ns=time.perf_counter_ns(),
                            compressed_bytes=compressed_bytes,
                            uncompressed_bytes=uncompressed_bytes,
                        )
                    )
        except BaseException as error:
            self._results.put(error)

    def submit(self, requests: Iterable[_LoadRequest]) -> None:
        for request in requests:
            self._requests.put(request)

    def next(self) -> tuple[_PreparedBatch, float]:
        wait_start = time.perf_counter_ns()
        result = self._results.get()
        consumer_wait = (time.perf_counter_ns() - wait_start) / 1_000_000
        if isinstance(result, BaseException):
            raise result
        return result, consumer_wait

    def close(self) -> None:
        for _ in self._threads:
            self._requests.put(None)
        for thread in self._threads:
            thread.join()

    def __enter__(self) -> _ConcurrentLoader:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


def _require_pinned(request: _LoadRequest) -> Any:
    if request.pinned is None:
        raise RuntimeError("the CPU pipeline requires a pinned batch")
    return request.pinned


class _GpuMemorySampler:
    def __init__(self, pynvml: Any, interval_milliseconds: int) -> None:
        self._pynvml = pynvml
        self._interval_seconds = interval_milliseconds / 1000
        self._device = pynvml.nvmlDeviceGetHandleByIndex(0)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sample, daemon=True)
        self.peak_bytes = 0

    def _sample(self) -> None:
        process_id = os.getpid()
        while not self._stop.is_set():
            processes = self._pynvml.nvmlDeviceGetComputeRunningProcesses(self._device)
            for process in processes:
                if process.pid == process_id and process.usedGpuMemory is not None:
                    self.peak_bytes = max(self.peak_bytes, int(process.usedGpuMemory))
            self._stop.wait(self._interval_seconds)

    def __enter__(self) -> _GpuMemorySampler:
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        self._thread.join()
        self._sample_once()

    def _sample_once(self) -> None:
        process_id = os.getpid()
        processes = self._pynvml.nvmlDeviceGetComputeRunningProcesses(self._device)
        for process in processes:
            if process.pid == process_id and process.usedGpuMemory is not None:
                self.peak_bytes = max(self.peak_bytes, int(process.usedGpuMemory))


def _summarize_stages(samples: tuple[_StageSample, ...]) -> dict[str, StageSummary]:
    grouped: dict[str, list[_StageSample]] = {}
    for sample in samples:
        grouped.setdefault(sample.name, []).append(sample)
    summaries: dict[str, StageSummary] = {}
    for name, values in grouped.items():
        cuda_values = tuple(
            value.cuda_milliseconds for value in values if value.cuda_milliseconds is not None
        )
        summaries[name] = StageSummary(
            samples=len(values),
            median_wall_milliseconds=statistics.median(value.wall_milliseconds for value in values),
            total_wall_milliseconds=sum(value.wall_milliseconds for value in values),
            median_process_cpu_milliseconds=statistics.median(
                value.process_cpu_milliseconds for value in values
            ),
            total_process_cpu_milliseconds=sum(value.process_cpu_milliseconds for value in values),
            median_cuda_milliseconds=(statistics.median(cuda_values) if cuda_values else None),
            total_cuda_milliseconds=sum(cuda_values) if cuda_values else None,
        )
    return summaries


def _event(torch: Any) -> Any:
    return torch.cuda.Event(enable_timing=True)


def _record_cuda_stage(
    torch: Any,
    stream: Any,
    name: str,
    operation: Any,
) -> tuple[Any, _CudaStage]:
    start = _event(torch)
    end = _event(torch)
    with torch.cuda.stream(stream):
        start.record()
        result = operation()
        end.record()
    return result, _CudaStage(name=name, start=start, end=end)


def _preprocess(torch: Any, batch: Any, output_size: int) -> Any:
    height, width = batch.shape[1:3]
    top = (height - output_size) // 2
    left = (width - output_size) // 2
    cropped = batch[:, top : top + output_size, left : left + output_size, :]
    tensor = cropped.permute(0, 3, 1, 2).to(dtype=torch.float32).div_(255.0)
    mean = torch.tensor((0.485, 0.456, 0.406), device=batch.device).view(1, 3, 1, 1)
    std = torch.tensor((0.229, 0.224, 0.225), device=batch.device).view(1, 3, 1, 1)
    return tensor.sub_(mean).div_(std)


def _run_window(
    *,
    torch: Any,
    cupy: Any,
    pynvml: Any,
    loader: _ConcurrentLoader,
    requests: tuple[_LoadRequest, ...],
    decoder: NvImageCodecDecoder,
    model: Any,
    pipeline: Pipeline,
    workload: Workload,
    config: ModelLoaderBenchmarkConfig,
    runtime_state: str,
) -> RuntimeMeasurement:
    input_stream = torch.cuda.Stream()
    compute_stream = torch.cuda.Stream()
    stages: list[_StageSample] = []
    cuda_stages: list[_CudaStage] = []
    in_flight: list[tuple[Any, tuple[Any, ...]]] = []
    transfer_bytes = 0
    compressed_bytes = 0
    uncompressed_bytes = 0
    cupy_peak = int(cupy.get_default_memory_pool().total_bytes())
    model.zero_grad(set_to_none=True)
    torch.cuda.reset_peak_memory_stats()
    torch.cuda.synchronize()
    process_start = time.process_time_ns()
    wall_start = time.perf_counter_ns()
    with _GpuMemorySampler(pynvml, config.memory_sample_interval_milliseconds) as memory_sampler:
        loader.submit(requests)
        for _ in requests:
            prepared, consumer_wait = loader.next()
            dequeued_ns = time.perf_counter_ns()
            producer_name = (
                "host_decode_and_pack"
                if pipeline == "cpu_decode_pinned_h2d"
                else "encoded_frame_lookup"
            )
            stages.append(
                _StageSample(
                    name=producer_name,
                    wall_milliseconds=prepared.producer_wall_milliseconds,
                    process_cpu_milliseconds=prepared.producer_cpu_milliseconds,
                )
            )
            stages.append(
                _StageSample(
                    name="consumer_wait",
                    wall_milliseconds=consumer_wait,
                    process_cpu_milliseconds=0,
                    counts_as_work=False,
                )
            )
            stages.append(
                _StageSample(
                    name="queue_wait",
                    wall_milliseconds=max(0, dequeued_ns - prepared.ready_ns) / 1_000_000,
                    process_cpu_milliseconds=0,
                    counts_as_work=False,
                )
            )
            compressed_bytes += prepared.compressed_bytes
            uncompressed_bytes += prepared.uncompressed_bytes
            if pipeline == "cpu_decode_pinned_h2d":
                if prepared.pinned is None:
                    raise RuntimeError("the CPU pipeline returned no pinned batch")
                device_batch, transfer_stage = _record_cuda_stage(
                    torch,
                    input_stream,
                    "host_to_device",
                    lambda batch=prepared.pinned: batch.to("cuda", non_blocking=True),
                )
                cuda_stages.append(transfer_stage)
                transfer_bytes += prepared.uncompressed_bytes
            else:
                with cupy.cuda.ExternalStream(int(input_stream.cuda_stream)):
                    decoded, decode_stage = _record_cuda_stage(
                        torch,
                        input_stream,
                        "device_decode",
                        lambda frames=prepared.frames: decode_dicom_frames_nvimagecodec(
                            frames,
                            decoder=decoder,
                            cuda_stream=int(input_stream.cuda_stream),
                        ),
                    )
                    cuda_stages.append(decode_stage)

                    def stack_decoded(decoded_batch: Any = decoded) -> Any:
                        arrays = tuple(cupy.asarray(image) for image in decoded_batch.images)
                        packed = cupy.stack(arrays)
                        return torch.utils.dlpack.from_dlpack(packed)

                    device_batch, pack_stage = _record_cuda_stage(
                        torch, input_stream, "device_batch_pack", stack_decoded
                    )
                    cuda_stages.append(pack_stage)
                transfer_bytes += prepared.compressed_bytes
            prepared_tensor, preprocess_stage = _record_cuda_stage(
                torch,
                input_stream,
                "preprocess",
                lambda batch=device_batch: _preprocess(torch, batch, config.output_size),
            )
            cuda_stages.append(preprocess_stage)
            ready = torch.cuda.Event()
            with torch.cuda.stream(input_stream):
                ready.record()
            with torch.cuda.stream(compute_stream):
                compute_stream.wait_event(ready)
            output, forward_stage = _record_cuda_stage(
                torch, compute_stream, "forward", lambda tensor=prepared_tensor: model(tensor)
            )
            cuda_stages.append(forward_stage)
            loss = None
            if workload == "training":
                targets = torch.full(
                    (output.shape[0],),
                    prepared.index % config.model_classes,
                    dtype=torch.long,
                    device="cuda",
                )
                loss, backward_stage = _record_cuda_stage(
                    torch,
                    compute_stream,
                    "backward",
                    lambda prediction=output, labels=targets: torch.nn.functional.cross_entropy(
                        prediction, labels
                    ).backward(),
                )
                cuda_stages.append(backward_stage)
            done = torch.cuda.Event()
            with torch.cuda.stream(compute_stream):
                done.record()
            in_flight.append((done, (prepared, device_batch, prepared_tensor, output, loss)))
            if len(in_flight) > 2:
                in_flight[0][0].synchronize()
                del in_flight[0]
            cupy_peak = max(cupy_peak, int(cupy.get_default_memory_pool().total_bytes()))
        torch.cuda.synchronize()
    wall_milliseconds = (time.perf_counter_ns() - wall_start) / 1_000_000
    process_cpu_milliseconds = (time.process_time_ns() - process_start) / 1_000_000
    for stage in cuda_stages:
        elapsed = float(stage.start.elapsed_time(stage.end))
        stages.append(
            _StageSample(
                name=stage.name,
                wall_milliseconds=elapsed,
                process_cpu_milliseconds=0,
                cuda_milliseconds=elapsed,
            )
        )
    work_milliseconds = sum(sample.wall_milliseconds for sample in stages if sample.counts_as_work)
    hidden_milliseconds = max(0.0, work_milliseconds - wall_milliseconds)
    sample_count = len(requests) * int(
        requests[0].pinned.shape[0]
        if requests[0].pinned is not None
        else len(requests[0].coordinates)
    )
    return RuntimeMeasurement(
        runtime_state=cast(Any, runtime_state),
        batches=len(requests),
        samples=sample_count,
        end_to_end_wall_milliseconds=wall_milliseconds,
        process_cpu_milliseconds=process_cpu_milliseconds,
        mean_process_cpu_cores=process_cpu_milliseconds / wall_milliseconds,
        samples_per_second=sample_count / (wall_milliseconds / 1000),
        stages=_summarize_stages(tuple(stages)),
        host_to_device_bytes=transfer_bytes,
        compressed_input_bytes=compressed_bytes,
        uncompressed_sample_bytes=uncompressed_bytes,
        torch_peak_allocated_bytes=int(torch.cuda.max_memory_allocated()),
        torch_peak_reserved_bytes=int(torch.cuda.max_memory_reserved()),
        cupy_peak_reserved_bytes=cupy_peak,
        process_gpu_peak_bytes=memory_sampler.peak_bytes or None,
        summed_stage_work_milliseconds=work_milliseconds,
        hidden_stage_work_milliseconds=hidden_milliseconds,
        overlap_fraction=(hidden_milliseconds / work_milliseconds if work_milliseconds else 0.0),
    )


def _requests_for_batches(
    torch: Any,
    batches: tuple[tuple[tuple[int, int], ...], ...],
    *,
    pipeline: Pipeline,
    tile_size: tuple[int, int],
    start_index: int,
) -> tuple[_LoadRequest, ...]:
    requests: list[_LoadRequest] = []
    for offset, coordinates in enumerate(batches):
        pinned = None
        if pipeline == "cpu_decode_pinned_h2d":
            pinned = torch.empty(
                (len(coordinates), tile_size[1], tile_size[0], 3),
                dtype=torch.uint8,
                pin_memory=True,
            )
        requests.append(
            _LoadRequest(
                index=start_index + offset,
                coordinates=coordinates,
                pinned=pinned,
            )
        )
    return tuple(requests)


def _model_state_sha256(model: Any) -> str:
    digest = hashlib.sha256()
    for name, tensor in model.state_dict().items():
        digest.update(name.encode("utf-8"))
        digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def _benchmark_case(
    *,
    torch: Any,
    torchvision: Any,
    cupy: Any,
    pynvml: Any,
    config: ModelLoaderBenchmarkConfig,
    coordinates: tuple[tuple[int, int], ...],
    tile_size: tuple[int, int],
    pipeline: Pipeline,
    workload: Workload,
    access_pattern: AccessPattern,
    batch_size: int,
    concurrency: int,
) -> ModelLoaderCaseResult:
    torch.cuda.empty_cache()
    cupy.get_default_memory_pool().free_all_blocks()
    setup_start = time.perf_counter_ns()
    torch.manual_seed(config.random_seed)
    torch.cuda.manual_seed_all(config.random_seed)
    model = torchvision.models.resnet18(weights=None, num_classes=config.model_classes).cuda()
    if workload == "training":
        model.train()
    else:
        model.eval()
    decoder = NvImageCodecDecoder()
    torch.cuda.synchronize()
    total_batches = 1 + config.warmup_batches + config.measured_batches
    planned = plan_coordinate_batches(
        coordinates,
        access_pattern=access_pattern,
        batch_size=batch_size,
        batch_count=total_batches,
        seed=config.random_seed + batch_size * 101 + concurrency * 1009,
    )
    requests = _requests_for_batches(
        torch,
        planned,
        pipeline=pipeline,
        tile_size=tile_size,
        start_index=0,
    )
    setup_milliseconds = (time.perf_counter_ns() - setup_start) / 1_000_000
    with _ConcurrentLoader(
        fixture_root=config.fixture_root,
        logical_level=config.logical_level,
        pipeline=pipeline,
        concurrency=concurrency,
        output_queue_depth=concurrency * config.queue_depth_factor,
        tile_size=tile_size,
    ) as loader:
        cold = _run_window(
            torch=torch,
            cupy=cupy,
            pynvml=pynvml,
            loader=loader,
            requests=requests[:1],
            decoder=decoder,
            model=model,
            pipeline=pipeline,
            workload=workload,
            config=config,
            runtime_state="application_cold",
        )
        if config.warmup_batches:
            _run_window(
                torch=torch,
                cupy=cupy,
                pynvml=pynvml,
                loader=loader,
                requests=requests[1 : 1 + config.warmup_batches],
                decoder=decoder,
                model=model,
                pipeline=pipeline,
                workload=workload,
                config=config,
                runtime_state="steady_state",
            )
        steady = _run_window(
            torch=torch,
            cupy=cupy,
            pynvml=pynvml,
            loader=loader,
            requests=requests[1 + config.warmup_batches :],
            decoder=decoder,
            model=model,
            pipeline=pipeline,
            workload=workload,
            config=config,
            runtime_state="steady_state",
        )
    return ModelLoaderCaseResult(
        pipeline=pipeline,
        workload=workload,
        access_pattern=access_pattern,
        batch_size=batch_size,
        loader_concurrency=concurrency,
        setup_milliseconds=setup_milliseconds,
        cold=cold,
        steady=steady,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fixture_assets(config: ModelLoaderBenchmarkConfig) -> tuple[str, tuple[FixtureAsset, ...]]:
    manifest = json.loads(config.fixture_manifest.read_text(encoding="utf-8"))
    assets: list[FixtureAsset] = []
    for record in manifest["assets"]:
        path = config.fixture_root / record["relative_path"]
        if path.stat().st_size != record["bytes"]:
            raise ValueError(f"fixture byte count differs for {path}")
        observed = _sha256(path)
        if observed != record["sha256"]:
            raise ValueError(f"fixture SHA-256 differs for {path}")
        assets.append(
            FixtureAsset(
                relative_path=record["relative_path"],
                bytes=record["bytes"],
                sha256=record["sha256"],
                source_url=record["source_url"],
            )
        )
    return str(manifest["asset_manifest_id"]), tuple(assets)


def _cpu_model() -> str:
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.exists():
        for line in cpuinfo.read_text(encoding="utf-8").splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return platform.processor() or "unknown"


def _total_memory_bytes() -> int:
    meminfo = Path("/proc/meminfo")
    for line in meminfo.read_text(encoding="utf-8").splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) * 1024
    raise RuntimeError("/proc/meminfo does not report MemTotal")


def _cgroup_cpu_limit() -> tuple[float | None, str]:
    cpu_max = Path("/sys/fs/cgroup/cpu.max").read_text(encoding="utf-8").split()
    quota = None if cpu_max[0] == "max" else int(cpu_max[0]) / int(cpu_max[1])
    cpuset = Path("/sys/fs/cgroup/cpuset.cpus.effective").read_text(encoding="utf-8")
    return quota, cpuset.strip()


def _cgroup_memory_limit() -> int | None:
    value = Path("/sys/fs/cgroup/memory.max").read_text(encoding="utf-8").strip()
    return None if value == "max" else int(value)


def _dependency_versions() -> tuple[DependencyVersion, ...]:
    names = (
        "cupy-cuda12x",
        "nvidia-cuda-runtime-cu12",
        "nvidia-cudnn-cu12",
        "nvidia-nvimgcodec-cu12",
        "nvidia-nvjpeg2k-cu12",
        "nvidia-ml-py",
        "pydicom",
        "pylibjpeg-openjpeg",
        "torch",
        "torchvision",
        "wsidicom",
    )
    versions: list[DependencyVersion] = []
    for name in names:
        try:
            version = metadata.version(name)
        except metadata.PackageNotFoundError:
            version = "not-installed-as-distribution"
        versions.append(DependencyVersion(name=name, version=version))
    return tuple(versions)


def _power_limit_milliwatts(pynvml: Any, device: Any) -> int | None:
    try:
        return int(pynvml.nvmlDeviceGetPowerManagementLimit(device))
    except pynvml.NVMLError_NotSupported:
        return None


def _environment(
    *,
    torch: Any,
    pynvml: Any,
    config: ModelLoaderBenchmarkConfig,
    model_state_sha256: str,
) -> tuple[LoaderBenchmarkEnvironment, tuple[tuple[int, int], ...], tuple[int, int]]:
    manifest_id, assets = _fixture_assets(config)
    collection = json.loads(config.fixture_collection_manifest.read_text(encoding="utf-8"))
    with DicomSlide.open(
        config.fixture_root,
        decoded_frame_cache_size=0,
        encoded_frame_cache_size=0,
    ) as slide:
        level = next(
            (
                candidate
                for candidate in slide.metadata.levels
                if candidate.logical_level == config.logical_level
            ),
            None,
        )
        if level is None:
            raise ValueError(f"fixture does not contain logical level {config.logical_level}")
        if config.output_size > min(level.tile_size):
            raise ValueError(f"output size {config.output_size} exceeds {level.tile_size}")
        coordinates = complete_tile_coordinates(level.dimensions, level.tile_size)
        frame = slide.read_encoded_frame(config.logical_level, coordinates[0])
    properties = torch.cuda.get_device_properties(0)
    pynvml.nvmlInit()
    driver = pynvml.nvmlSystemGetDriverVersion()
    if isinstance(driver, bytes):
        driver = driver.decode("utf-8")
    nvml_device = pynvml.nvmlDeviceGetHandleByIndex(0)
    pci_bus_id = pynvml.nvmlDeviceGetPciInfo(nvml_device).busId
    if isinstance(pci_bus_id, bytes):
        pci_bus_id = pci_bus_id.decode("utf-8")
    cpu_quota, cpuset = _cgroup_cpu_limit()
    environment = LoaderBenchmarkEnvironment(
        hostname=socket.gethostname(),
        operating_system=platform.platform(),
        python_version=platform.python_version(),
        cpu_model=_cpu_model(),
        logical_cpu_count=os.cpu_count() or 1,
        cgroup_cpu_quota_cores=cpu_quota,
        cgroup_cpuset=cpuset,
        total_host_memory_bytes=_total_memory_bytes(),
        cgroup_memory_limit_bytes=_cgroup_memory_limit(),
        gpu_name=properties.name,
        gpu_capability=f"{properties.major}.{properties.minor}",
        gpu_memory_bytes=int(properties.total_memory),
        gpu_pci_bus_id=str(pci_bus_id),
        gpu_power_limit_milliwatts=_power_limit_milliwatts(pynvml, nvml_device),
        nvidia_driver_version=str(driver),
        cuda_runtime_version=str(torch.version.cuda),
        dependencies=_dependency_versions(),
        image_reference=os.getenv("PATHOLOGIZE_BENCHMARK_IMAGE_REFERENCE"),
        fixture_manifest_id=manifest_id,
        fixture_manifest_sha256=_sha256(config.fixture_manifest),
        fixture_collection=str(collection["collection_id"]),
        fixture_citation=str(collection["citation"]),
        fixture_license=str(collection["license"]["spdx_id"]),
        fixture_assets=assets,
        fixture_total_bytes=sum(asset.bytes for asset in assets),
        fixture_transfer_syntax=frame.transfer_syntax_uid,
        fixture_photometric_interpretation=frame.photometric_interpretation,
        fixture_dimensions=level.dimensions,
        fixture_tile_size=level.tile_size,
        fixture_microns_per_pixel=level.microns_per_pixel,
        fixture_complete_tile_count=len(coordinates),
        model_state_sha256=model_state_sha256,
    )
    return environment, coordinates, level.tile_size


def run_model_loader_benchmark(
    config: ModelLoaderBenchmarkConfig,
) -> ModelLoaderBenchmarkReport:
    torch = cast(Any, import_module("torch"))
    torchvision = cast(Any, import_module("torchvision"))
    cupy = cast(Any, import_module("cupy"))
    pynvml = cast(Any, import_module("pynvml"))
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable")
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.manual_seed(config.random_seed)
    reference_model = torchvision.models.resnet18(weights=None, num_classes=config.model_classes)
    model_state_sha256 = _model_state_sha256(reference_model)
    del reference_model
    environment, coordinates, tile_size = _environment(
        torch=torch,
        pynvml=pynvml,
        config=config,
        model_state_sha256=model_state_sha256,
    )
    cases: list[ModelLoaderCaseResult] = []
    for workload in config.workloads:
        for access_pattern in config.access_patterns:
            for batch_size in config.batch_sizes:
                for concurrency in config.loader_concurrency:
                    for pipeline in cast(
                        tuple[Pipeline, ...],
                        ("cpu_decode_pinned_h2d", "nvimagecodec_device_decode"),
                    ):
                        cases.append(
                            _benchmark_case(
                                torch=torch,
                                torchvision=torchvision,
                                cupy=cupy,
                                pynvml=pynvml,
                                config=config,
                                coordinates=coordinates,
                                tile_size=tile_size,
                                pipeline=pipeline,
                                workload=workload,
                                access_pattern=access_pattern,
                                batch_size=batch_size,
                                concurrency=concurrency,
                            )
                        )
    return ModelLoaderBenchmarkReport(
        config=config,
        environment=environment,
        cases=tuple(cases),
    )
