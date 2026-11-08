from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from pathologize_tiling_benchmark.tiff_gpu_benchmark import (
    _Measurement,
    _read_cucim_batch,
    complete_region_locations,
    fixture_members,
    load_fixture_manifest,
    parse_batch_sizes,
    select_region_locations,
    summarize_stages,
)
from pathologize_tiling_benchmark.tiff_gpu_cli import main
from pathologize_tiling_benchmark.tiff_gpu_contracts import TiffGpuBenchmarkConfig

PROJECT_ROOT = Path(__file__).parents[1]
FIXTURE_MANIFEST = PROJECT_ROOT / "fixtures" / "tiff-gpu-manifest.json"


def test_public_tiff_fixture_manifest_is_strict_and_unique() -> None:
    manifest = load_fixture_manifest(FIXTURE_MANIFEST)
    members = fixture_members(manifest)

    assert manifest.schema_version == "pathologize.tiff-gpu-fixtures.v1"
    assert len(members) == 7
    assert len({member.path for member in members}) == len(members)
    assert {member.codec for member in members} == {"jpeg", "jpeg2000", "lzw", "none"}
    assert all(len(member.sha256) == 64 for member in members)

    payload = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    payload["unexpected"] = True
    with pytest.raises(ValueError, match="unexpected"):
        type(manifest).model_validate(payload)


def test_tiff_gpu_config_and_coordinate_selection_are_deterministic() -> None:
    config = TiffGpuBenchmarkConfig(
        fixture_root=Path("fixtures"),
        fixture_manifest=Path("manifest.json"),
    )
    assert config.batch_sizes == (1, 8, 32, 128)
    assert parse_batch_sizes("1,8, 32") == (1, 8, 32)
    with pytest.raises(ValueError, match="comma-separated"):
        parse_batch_sizes("one")
    with pytest.raises(ValueError, match="duplicates"):
        TiffGpuBenchmarkConfig(
            fixture_root=Path("fixtures"),
            fixture_manifest=Path("manifest.json"),
            batch_sizes=(1, 1),
        )

    locations = complete_region_locations((1024, 768), region_size=256, downsample=4.0)
    assert locations == (
        (0, 0),
        (1024, 0),
        (2048, 0),
        (3072, 0),
        (0, 1024),
        (1024, 1024),
        (2048, 1024),
        (3072, 1024),
        (0, 2048),
        (1024, 2048),
        (2048, 2048),
        (3072, 2048),
    )
    assert (
        select_region_locations(locations, access_pattern="contiguous", batch_size=4, seed=1)
        == locations[4:8]
    )
    first = select_region_locations(locations, access_pattern="random", batch_size=4, seed=17)
    second = select_region_locations(locations, access_pattern="random", batch_size=4, seed=17)
    assert first == second
    with pytest.raises(ValueError, match="exceeds"):
        select_region_locations(locations, access_pattern="random", batch_size=13, seed=1)


def test_tiff_stage_summary_preserves_cuda_and_copy_measurements() -> None:
    samples = (
        {
            "decode": _Measurement(
                wall_milliseconds=2.0,
                process_cpu_milliseconds=1.0,
                cuda_milliseconds=None,
                host_bytes=10,
                device_bytes=20,
            ),
            "copy": _Measurement(
                wall_milliseconds=1.0,
                process_cpu_milliseconds=0.5,
                cuda_milliseconds=0.25,
                host_bytes=20,
                device_bytes=20,
            ),
        },
        {
            "decode": _Measurement(
                wall_milliseconds=4.0,
                process_cpu_milliseconds=3.0,
                cuda_milliseconds=None,
                host_bytes=10,
                device_bytes=20,
            ),
            "copy": _Measurement(
                wall_milliseconds=3.0,
                process_cpu_milliseconds=1.5,
                cuda_milliseconds=0.75,
                host_bytes=20,
                device_bytes=20,
            ),
        },
    )
    summary = summarize_stages(samples)

    assert summary["decode"].median_wall_milliseconds == 3.0
    assert summary["decode"].median_cuda_milliseconds is None
    assert summary["copy"].median_cuda_milliseconds == 0.5
    assert summary["copy"].host_bytes == 20

    with pytest.raises(ValueError, match="at least one"):
        summarize_stages(())
    with pytest.raises(ValueError, match="names and order"):
        summarize_stages((samples[0], {"other": samples[1]["decode"]}))


def test_cucim_batch_reader_preserves_the_decoder_batch_axis() -> None:
    decoded = np.zeros((2, 16, 16, 4), dtype=np.uint8)

    class FakeIterator:
        def __iter__(self) -> object:
            return iter((decoded,))

    class FakeImage:
        def read_region(self, **_arguments: object) -> FakeIterator:
            return FakeIterator()

    cupy = SimpleNamespace(asarray=np.asarray)

    batch = _read_cucim_batch(cupy, FakeImage(), ((0, 0), (16, 0)), 0, 16)

    assert batch.shape == (2, 16, 16, 3)


def test_tiff_gpu_cli_reports_missing_cuda_without_a_traceback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(_config: TiffGpuBenchmarkConfig) -> None:
        raise RuntimeError("CUDA is unavailable")

    monkeypatch.setattr(
        "pathologize_tiling_benchmark.tiff_gpu_cli.run_tiff_gpu_decode_benchmark",
        fail,
    )

    assert (
        main(
            [
                "run",
                "--fixture-root=fixtures",
                "--fixture-manifest=manifest.json",
                "--batch-sizes=1",
            ]
        )
        == 2
    )
