from __future__ import annotations

import hashlib
from importlib import metadata
from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar, cast

import numpy as np
import pytest
from numpy.typing import DTypeLike
from openslide import OpenSlide
from PIL import Image

from pathologize_tiling_benchmark import tiff_gpu_benchmark as benchmark
from pathologize_tiling_benchmark.tiff_gpu_contracts import (
    ReaderGeometry,
    TiffBenchmarkEnvironment,
    TiffFixtureMember,
    TiffFixtureProbe,
    TiffGpuBenchmarkConfig,
    TiffPixelAgreement,
    TiffViewerCpuResult,
)


class FakeEvent:
    def record(self) -> None:
        return None

    def synchronize(self) -> None:
        return None


class FakeStream:
    def synchronize(self) -> None:
        return None


class FakeMemoryPool:
    def __init__(self) -> None:
        self.freed = 0

    def free_all_blocks(self) -> None:
        self.freed += 1

    def total_bytes(self) -> int:
        return 64


class FakeRuntime:
    def __init__(self, device_count: int = 1) -> None:
        self.device_count = device_count

    def getDeviceCount(self) -> int:  # noqa: N802 - mirrors the CUDA runtime API.
        return self.device_count

    def getDeviceProperties(  # noqa: N802 - mirrors the CUDA runtime API.
        self, _index: int
    ) -> dict[str, object]:
        return {
            "name": b"fake-gpu",
            "major": 8,
            "minor": 9,
            "totalGlobalMem": 1024,
        }

    def driverGetVersion(self) -> int:  # noqa: N802 - mirrors the CUDA runtime API.
        return 12090

    def runtimeGetVersion(self) -> int:  # noqa: N802 - mirrors the CUDA runtime API.
        return 12080


class FakeCuda:
    Event = FakeEvent

    def __init__(self, device_count: int = 1) -> None:
        self.runtime = FakeRuntime(device_count)
        self.stream = FakeStream()

    def get_current_stream(self) -> FakeStream:
        return self.stream

    def get_elapsed_time(self, _start: FakeEvent, _end: FakeEvent) -> float:
        return 1.25

    def alloc_pinned_memory(self, byte_count: int) -> bytearray:
        return bytearray(byte_count)


class FakeDeviceArray:
    def __init__(self, shape: tuple[int, ...]) -> None:
        self.values = np.zeros(shape, dtype=np.uint8)

    @property
    def shape(self) -> tuple[int, ...]:
        return tuple(int(value) for value in self.values.shape)

    @property
    def nbytes(self) -> int:
        return self.values.nbytes

    def set(self, source: np.ndarray[Any, Any], *, stream: FakeStream) -> None:
        stream.synchronize()
        np.copyto(self.values, source)


class FakeCupy:
    float32 = np.float32
    uint8 = np.uint8

    def __init__(self, device_count: int = 1) -> None:
        self.cuda = FakeCuda(device_count)
        self.pool = FakeMemoryPool()

    @staticmethod
    def asarray(value: object, dtype: DTypeLike | None = None) -> np.ndarray[Any, Any]:
        return np.asarray(value, dtype=dtype)

    @staticmethod
    def asnumpy(value: object) -> np.ndarray[Any, Any]:
        return np.asarray(value)

    @staticmethod
    def zeros(shape: tuple[int, ...], dtype: DTypeLike) -> np.ndarray[Any, Any]:
        return np.zeros(shape, dtype=dtype)

    @staticmethod
    def empty(shape: tuple[int, ...], dtype: DTypeLike) -> FakeDeviceArray:
        assert dtype == np.uint8
        return FakeDeviceArray(shape)

    def get_default_memory_pool(self) -> FakeMemoryPool:
        return self.pool


class FakeCudaBatch:
    __cuda_array_interface__: ClassVar[dict[str, object]] = {}

    def __init__(self, values: np.ndarray[Any, Any]) -> None:
        self.values = values

    @property
    def shape(self) -> tuple[int, ...]:
        return tuple(int(value) for value in self.values.shape)

    def __array__(self, dtype: DTypeLike | None = None) -> np.ndarray[Any, Any]:
        return np.asarray(self.values, dtype=dtype)


class FakeSlide:
    def __init__(self, _path: Path | None = None) -> None:
        self.level_count = 1
        self.level_dimensions = ((64, 64),)
        self.level_downsamples = (1.0,)
        self.properties = {
            "openslide.vendor": "aperio",
            "openslide.mpp-x": "0.5",
            "openslide.mpp-y": "0.5",
            "openslide.level[0].tile-width": "16",
            "openslide.level[0].tile-height": "16",
        }
        self.associated_images: dict[str, object] = {}

    def __enter__(self) -> FakeSlide:
        return self

    def __exit__(self, *_arguments: object) -> None:
        return None

    def read_region(
        self,
        _location: tuple[int, int],
        _level: int,
        size: tuple[int, int],
    ) -> Image.Image:
        return Image.fromarray(np.zeros((size[1], size[0], 4), dtype=np.uint8), mode="RGBA")


class FakeCuImage:
    def __init__(self, _path: str) -> None:
        self.resolutions = {
            "level_dimensions": ((64, 64),),
            "level_downsamples": (1.0,),
            "level_tile_sizes": ((16, 16),),
        }
        self.metadata = {"vendor": "aperio"}
        self.associated_images: tuple[str, ...] = ()
        self.closed = False

    @staticmethod
    def spacing(_axes: str) -> tuple[float, float]:
        return (0.5, 0.5)

    @staticmethod
    def read_region(**arguments: object) -> FakeCudaBatch:
        size = arguments["size"]
        assert isinstance(size, tuple)
        locations = arguments["location"]
        batch_size = len(locations) if isinstance(locations, list) else 1
        return FakeCudaBatch(np.zeros((batch_size, size[1], size[0], 4), dtype=np.uint8))

    def close(self) -> None:
        self.closed = True


class FakeTiffFile:
    def __init__(self, _path: Path) -> None:
        page = SimpleNamespace(
            compression=SimpleNamespace(name="JPEG"),
            is_tiled=True,
            tilewidth=16,
            tilelength=16,
        )
        self.pages = (page,)

    def __enter__(self) -> FakeTiffFile:
        return self

    def __exit__(self, *_arguments: object) -> None:
        return None


def geometry(**updates: object) -> ReaderGeometry:
    values: dict[str, object] = {
        "vendor": "aperio",
        "level_dimensions": ((64, 64),),
        "level_downsamples": (1.0,),
        "level_tile_sizes": ((16, 16),),
        "microns_per_pixel": (0.5, 0.5),
        "associated_images": (),
    }
    values.update(updates)
    return ReaderGeometry.model_validate(values)


def fixture_member(path: str, contents: bytes) -> TiffFixtureMember:
    return TiffFixtureMember(
        path=path,
        bytes=len(contents),
        sha256=hashlib.sha256(contents).hexdigest(),
        format="aperio_svs",
        codec="jpeg",
        license_spdx="CC0-1.0",
    )


def probe(path: str, **updates: object) -> TiffFixtureProbe:
    reader_geometry = geometry()
    values: dict[str, object] = {
        "path": path,
        "expected_format": "aperio_svs",
        "expected_codec": "jpeg",
        "expected_bytes": 1,
        "sha256": "0" * 64,
        "sha256_verified": True,
        "tiff_compression": "jpeg",
        "tiff_is_tiled": True,
        "tiff_tile_size": (16, 16),
        "openslide_supported": True,
        "openslide_error": None,
        "openslide_geometry": reader_geometry,
        "cucim_supported": True,
        "cucim_error": None,
        "cucim_geometry": reader_geometry,
        "cucim_device_output": True,
        "device_output_shape": (1, 32, 32, 4),
        "pyramid_geometry_match": True,
        "microns_per_pixel_match": True,
        "associated_images_match": True,
        "semantic_geometry_match": True,
        "accelerator_eligible": True,
        "measurement_eligible": True,
        "selection_reason": "eligible",
        "decoder_evidence": "device decode",
        "remaining_host_work": (),
    }
    values.update(updates)
    return TiffFixtureProbe.model_validate(values)


def config(root: Path, path: str = "slide.svs", **updates: object) -> TiffGpuBenchmarkConfig:
    values: dict[str, object] = {
        "fixture_root": root,
        "fixture_manifest": root / "manifest.json",
        "benchmark_fixture_paths": (path,),
        "region_size": 32,
        "output_size": 32,
        "batch_sizes": (1,),
        "access_patterns": ("contiguous",),
        "warmup_repetitions": 0,
        "measured_repetitions": 1,
        "correctness_samples": 1,
    }
    values.update(updates)
    return TiffGpuBenchmarkConfig.model_validate(values)


def test_timing_hash_and_scalar_helpers(tmp_path: Path) -> None:
    assert benchmark.parse_batch_sizes((1, 2)) == (1, 2)
    assert benchmark.parse_batch_sizes(4) == (4,)
    assert benchmark.complete_region_locations((16, 16), region_size=32, downsample=1) == ()

    value, cpu_measurement = benchmark._measure_cpu(lambda: 3, host_bytes=2)
    assert value == 3
    assert cpu_measurement.host_bytes == 2
    _, cuda_measurement = benchmark._measure_cuda(FakeCupy(), lambda: None, device_bytes=4)
    assert cuda_measurement.cuda_milliseconds == 1.25
    assert cuda_measurement.device_bytes == 4
    assert benchmark._peak_rss_bytes() > 0

    target = tmp_path / "hash.txt"
    target.write_bytes(b"public fixture")
    assert benchmark._sha256(target) == hashlib.sha256(b"public fixture").hexdigest()
    assert benchmark._optional_float(None) is None
    assert benchmark._optional_float("0.5") == 0.5
    assert benchmark._optional_float(object()) is None


def test_geometry_and_tiff_inspection_helpers() -> None:
    slide_geometry = benchmark._openslide_geometry(cast(OpenSlide, FakeSlide()))
    image_geometry = benchmark._cucim_geometry(FakeCuImage("slide.svs"))
    assert slide_geometry == image_geometry
    assert benchmark._pyramid_matches(slide_geometry, image_geometry)
    assert benchmark._mpp_matches(slide_geometry, image_geometry)
    assert benchmark._associated_images_match(slide_geometry, image_geometry)
    assert benchmark._requested_level_matches(slide_geometry, image_geometry, 0)

    assert not benchmark._pyramid_matches(None, image_geometry)
    assert not benchmark._pyramid_matches(
        slide_geometry,
        geometry(level_dimensions=((32, 32),)),
    )
    assert not benchmark._pyramid_matches(
        slide_geometry,
        geometry(level_downsamples=(1.0, 2.0)),
    )
    assert not benchmark._mpp_matches(
        slide_geometry,
        geometry(microns_per_pixel=(None, 0.5)),
    )
    assert not benchmark._mpp_matches(
        slide_geometry,
        geometry(microns_per_pixel=(0.75, 0.5)),
    )
    assert not benchmark._associated_images_match(
        slide_geometry,
        geometry(associated_images=("thumbnail",)),
    )
    assert not benchmark._requested_level_matches(slide_geometry, image_geometry, 1)

    tifffile = SimpleNamespace(TiffFile=FakeTiffFile, TiffFileError=RuntimeError)
    assert benchmark._inspect_tiff(tifffile, Path("slide.svs")) == (
        "jpeg",
        True,
        (16, 16),
    )
    broken_tifffile = SimpleNamespace(
        TiffFile=lambda _path: (_ for _ in ()).throw(OSError("broken")),
        TiffFileError=RuntimeError,
    )
    assert benchmark._inspect_tiff(broken_tifffile, Path("broken.tiff")) == (
        None,
        None,
        None,
    )


def test_decoder_evidence_and_fixture_probe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contents = b"fixture"
    path = tmp_path / "slide.svs"
    path.write_bytes(contents)
    member = fixture_member(path.name, contents)
    assert benchmark._decoder_evidence(member, False) == "no CUDA array output was produced"
    for codec in ("jpeg", "jpeg2000", "lzw", "none"):
        assert "cuCIM cuslide2" in benchmark._decoder_evidence(
            member.model_copy(update={"codec": codec}), True
        )

    monkeypatch.setattr(benchmark, "OpenSlide", FakeSlide)
    tifffile = SimpleNamespace(TiffFile=FakeTiffFile, TiffFileError=RuntimeError)
    probe_cupy = FakeCupy()
    monkeypatch.setattr(probe_cupy, "asarray", lambda value: value)
    result = benchmark._probe_fixture(
        probe_cupy,
        SimpleNamespace(CuImage=FakeCuImage),
        tifffile,
        tmp_path,
        member,
        32,
        0,
    )
    assert result.sha256_verified
    assert result.accelerator_eligible
    assert result.measurement_eligible
    assert result.cucim_device_output
    assert result.remaining_host_work

    class FailingCuImage:
        def __init__(self, _path: str) -> None:
            raise RuntimeError("unsupported")

    unsupported = benchmark._probe_fixture(
        probe_cupy,
        SimpleNamespace(CuImage=FailingCuImage),
        tifffile,
        tmp_path,
        member,
        32,
        0,
    )
    assert not unsupported.cucim_device_output
    assert unsupported.selection_reason == "cuCIM did not return a CUDA-resident region"


def test_array_preprocessing_and_reader_boundaries() -> None:
    cupy = FakeCupy()
    pinned = benchmark._pinned_batch(cupy, (1, 4, 4, 3))
    assert pinned.shape == (1, 4, 4, 3)

    weights = benchmark._consumer_weights(cupy)
    batch = np.zeros((1, 4, 4, 3), dtype=np.uint8)
    prepared = benchmark._preprocess(cupy, batch, 2)
    assert prepared.shape == (1, 3, 2, 2)
    assert benchmark._consume(prepared, weights).shape == (1, 8)
    benchmark._prime_shared_device_kernels(
        cupy,
        config(Path(), region_size=32, output_size=32),
        weights,
    )
    assert cupy.pool.freed == 1

    slide = FakeSlide()
    images = benchmark._read_openslide_batch(cast(OpenSlide, slide), ((0, 0),), 0, 4)
    benchmark._pack_openslide_rgb(images, pinned)
    assert not pinned.any()

    image = FakeCuImage("slide.svs")
    decoded = benchmark._read_cucim_batch(cupy, image, ((0, 0),), 0, 4)
    assert decoded.shape == (1, 4, 4, 3)

    class UnexpectedShapeImage:
        @staticmethod
        def read_region(**_arguments: object) -> FakeCudaBatch:
            return FakeCudaBatch(np.zeros((4, 4), dtype=np.uint8))

    coordinates = ((0, 0),)
    unexpected_shape_image = UnexpectedShapeImage()
    with pytest.raises(ValueError, match="unexpected batch shape"):
        benchmark._read_cucim_batch(cupy, unexpected_shape_image, coordinates, 0, 4)

    class MultipleBatchImage:
        @staticmethod
        def read_region(**_arguments: object) -> tuple[np.ndarray[Any, Any], ...]:
            batch = np.zeros((1, 4, 4, 4), dtype=np.uint8)
            return (batch, batch)

    multiple_batch_image = MultipleBatchImage()
    with pytest.raises(ValueError, match="2 completed batches"):
        benchmark._read_cucim_batch(cupy, multiple_batch_image, coordinates, 0, 4)


def test_pipeline_sampling_and_case_summaries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cupy = FakeCupy()
    selected_config = config(tmp_path)
    weights = benchmark._consumer_weights(cupy)
    pinned = np.zeros((1, 32, 32, 3), dtype=np.uint8)
    monkeypatch.setattr(
        benchmark,
        "_preprocess",
        lambda _cupy, batch, _size: np.zeros((batch.shape[0], 3, 2, 2), dtype=np.float32),
    )
    monkeypatch.setattr(
        benchmark,
        "_consume",
        lambda prepared, _weights: np.zeros((prepared.shape[0], 8), dtype=np.float32),
    )

    cpu_sample = benchmark._sample_cpu_pipeline(
        cupy,
        cast(OpenSlide, FakeSlide()),
        ((0, 0),),
        selected_config,
        pinned,
        weights,
    )
    assert tuple(cpu_sample[0]) == (
        "openslide_host_decode_rgba",
        "host_rgb_pack_pinned",
        "host_to_device",
        "device_preprocess",
        "consumer",
    )
    cuda_sample = benchmark._sample_cucim_pipeline(
        cupy,
        FakeCuImage("slide.svs"),
        ((0, 0),),
        selected_config,
        weights,
    )
    assert "cucim_nvimagecodec_device_decode_and_pack" in cuda_sample[0]

    case = benchmark._case_result(
        "slide.svs",
        "cucim_cuslide2_device",
        "random",
        1,
        "steady_state",
        (cuda_sample,),
        cupy,
    )
    assert case.repetitions == 1
    assert case.cupy_pool_reserved_bytes == 64

    monkeypatch.setattr(benchmark, "_sample_cpu_pipeline", lambda *_arguments: cpu_sample)
    monkeypatch.setattr(benchmark, "_sample_cucim_pipeline", lambda *_arguments: cuda_sample)
    cpu_cases = benchmark._run_case(
        cupy,
        cast(OpenSlide, FakeSlide()),
        FakeCuImage("slide.svs"),
        ((0, 0),),
        selected_config,
        weights,
        "slide.svs",
        "openslide_cpu_pinned_h2d",
        "contiguous",
    )
    cuda_cases = benchmark._run_case(
        cupy,
        cast(OpenSlide, FakeSlide()),
        FakeCuImage("slide.svs"),
        ((0, 0),),
        selected_config,
        weights,
        "slide.svs",
        "cucim_cuslide2_device",
        "contiguous",
    )
    assert len(cpu_cases) == len(cuda_cases) == 2


def test_pixel_viewer_and_environment_results(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selected_config = config(tmp_path)
    cupy = FakeCupy()
    agreement = benchmark._pixel_agreement(
        cupy,
        cast(OpenSlide, FakeSlide()),
        FakeCuImage("slide.svs"),
        ((0, 0),),
        selected_config,
        "slide.svs",
    )
    assert agreement.passed
    assert agreement.maximum_absolute_error == 0

    viewer = benchmark._viewer_cpu(
        cast(OpenSlide, FakeSlide()),
        (0, 0),
        selected_config,
        "slide.svs",
    )
    assert viewer.median_png_bytes > 0
    missing = tmp_path / "missing"
    assert benchmark._read_first_value(missing, "model name") == "unknown"
    cpuinfo = tmp_path / "cpuinfo"
    cpuinfo.write_text("model name: public-cpu\n", encoding="utf-8")
    assert benchmark._read_first_value(cpuinfo, "model name") == "public-cpu"
    assert benchmark._read_first_value(cpuinfo, "other") == "unknown"

    monkeypatch.setattr(metadata, "version", lambda package: f"{package}-version")
    environment = benchmark._environment(cupy, SimpleNamespace(__version__="1.0"))
    assert environment.gpu_name == "fake-gpu"
    assert environment.gpu_compute_capability == "8.9"


def test_fixture_selection_and_report_entrypoint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "slide.svs"
    contents = b"fixture"
    path.write_bytes(contents)
    member = fixture_member(path.name, contents)
    selected_config = config(tmp_path)
    selected_probe = probe(path.name)
    cupy = FakeCupy()

    monkeypatch.setattr(benchmark, "OpenSlide", FakeSlide)
    monkeypatch.setattr(benchmark, "_consumer_weights", lambda _cupy: object())
    monkeypatch.setattr(benchmark, "_prime_shared_device_kernels", lambda *_arguments: None)
    monkeypatch.setattr(
        benchmark,
        "_pixel_agreement",
        lambda *_arguments: TiffPixelAgreement(
            fixture_path=path.name,
            samples=1,
            maximum_absolute_error=0,
            mean_absolute_error=0,
            tolerance=3,
            passed=True,
        ),
    )
    monkeypatch.setattr(
        benchmark,
        "_viewer_cpu",
        lambda *_arguments: TiffViewerCpuResult(
            fixture_path=path.name,
            median_decode_milliseconds=1,
            median_png_encode_milliseconds=1,
            median_png_bytes=1,
        ),
    )
    monkeypatch.setattr(benchmark, "_run_fixture_cases", lambda *_arguments: ([], []))
    selected = benchmark._run_selected_fixtures(
        cupy,
        SimpleNamespace(CuImage=FakeCuImage),
        selected_config,
        (selected_probe,),
    )
    assert selected[1][0].passed
    assert selected[2][0].fixture_path == path.name

    omitted = benchmark._run_selected_fixtures(
        cupy,
        SimpleNamespace(CuImage=FakeCuImage),
        selected_config,
        (selected_probe.model_copy(update={"measurement_eligible": False}),),
    )
    assert omitted[3] == (f"{path.name}: eligible",)

    environment = TiffBenchmarkEnvironment(
        host_kernel="test",
        cpu_model="test",
        cpu_logical_count=1,
        host_memory_bytes=1,
        gpu_name="test",
        gpu_uuid="test",
        gpu_compute_capability="8.9",
        gpu_memory_bytes=1,
        driver_version="test",
        cuda_runtime_version="test",
        python_version="test",
        cucim_version="test",
        nvimagecodec_version="test",
        cupy_version="test",
        openslide_python_version="test",
        openslide_library_version="test",
        tifffile_version="test",
    )
    manifest = SimpleNamespace(sources=(SimpleNamespace(members=(member,)),))
    monkeypatch.setenv("ENABLE_CUSLIDE2", "1")
    monkeypatch.setattr(benchmark, "import_module", lambda _name: cupy)
    monkeypatch.setattr(benchmark, "load_fixture_manifest", lambda _path: manifest)
    monkeypatch.setattr(benchmark, "_probe_fixture", lambda *_arguments: selected_probe)
    monkeypatch.setattr(benchmark, "_environment", lambda *_arguments: environment)
    monkeypatch.setattr(
        benchmark,
        "_run_selected_fixtures",
        lambda *_arguments: ((), (), (), ()),
    )
    report = benchmark.run_tiff_gpu_decode_benchmark(selected_config)
    assert report.probes == (selected_probe,)

    monkeypatch.setattr(benchmark, "import_module", lambda _name: FakeCupy(device_count=0))
    with pytest.raises(RuntimeError, match="CUDA is unavailable"):
        benchmark.run_tiff_gpu_decode_benchmark(selected_config)
