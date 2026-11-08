from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from pathologize_tiling_benchmark import gpu_benchmark
from pathologize_tiling_benchmark.gpu_benchmark import (
    _peak_rss_bytes,
    _reset_peak_rss,
    complete_tile_coordinates,
    parse_batch_sizes,
    select_coordinates,
    summarize_stages,
)
from pathologize_tiling_benchmark.gpu_cli import main
from pathologize_tiling_benchmark.gpu_contracts import GpuBenchmarkConfig, StageMeasurement


def test_gpu_benchmark_config_rejects_duplicate_or_invalid_batches() -> None:
    with pytest.raises(ValueError, match="positive integers"):
        GpuBenchmarkConfig(fixture_root=Path("fixture"), batch_sizes=(0,))
    with pytest.raises(ValueError, match="duplicates"):
        GpuBenchmarkConfig(fixture_root=Path("fixture"), batch_sizes=(1, 1))
    with pytest.raises(ValueError, match="access_patterns must not be empty"):
        GpuBenchmarkConfig(fixture_root=Path("fixture"), access_patterns=())


def test_parse_batch_sizes_and_coordinate_selection_are_deterministic() -> None:
    assert parse_batch_sizes("1, 8,32") == (1, 8, 32)
    assert parse_batch_sizes((2, 4)) == (2, 4)
    with pytest.raises(ValueError, match="comma-separated"):
        parse_batch_sizes("one")

    coordinates = tuple((value, 0) for value in range(10))
    assert select_coordinates(coordinates, access_pattern="contiguous", batch_size=4, seed=1) == (
        (3, 0),
        (4, 0),
        (5, 0),
        (6, 0),
    )
    first = select_coordinates(coordinates, access_pattern="random", batch_size=4, seed=17)
    second = select_coordinates(coordinates, access_pattern="random", batch_size=4, seed=17)
    assert first == second
    assert len(set(first)) == 4
    with pytest.raises(ValueError, match="exceeds"):
        select_coordinates(coordinates, access_pattern="random", batch_size=11, seed=1)


def test_complete_tile_coordinates_exclude_partial_edges() -> None:
    assert complete_tile_coordinates((769, 513), (256, 256)) == (
        (0, 0),
        (1, 0),
        (2, 0),
        (0, 1),
        (1, 1),
        (2, 1),
    )


def test_stage_summary_preserves_transfer_counts_and_cuda_timing() -> None:
    samples = (
        {
            "decode": StageMeasurement(
                wall_milliseconds=2.0,
                process_cpu_milliseconds=1.0,
                cuda_milliseconds=0.5,
                host_bytes=10,
                device_bytes=20,
            )
        },
        {
            "decode": StageMeasurement(
                wall_milliseconds=4.0,
                process_cpu_milliseconds=3.0,
                cuda_milliseconds=1.5,
                host_bytes=10,
                device_bytes=20,
            )
        },
    )
    summary = summarize_stages(samples)["decode"]

    assert summary.median_wall_milliseconds == 3.0
    assert summary.median_process_cpu_milliseconds == 2.0
    assert summary.median_cuda_milliseconds == 1.0
    assert summary.host_bytes == 10
    assert summary.device_bytes == 20

    with pytest.raises(ValueError, match="at least one"):
        summarize_stages(())
    with pytest.raises(ValueError, match="names and order"):
        summarize_stages((samples[0], {"other": samples[1]["decode"]}))


def test_peak_rss_reset_and_platform_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    writes: list[tuple[Path, str, str]] = []

    def record_write(path: Path, value: str, *, encoding: str) -> int:
        writes.append((path, value, encoding))
        return len(value)

    monkeypatch.setattr(Path, "write_text", record_write)
    _reset_peak_rss()
    assert writes == [(Path("/proc/self/clear_refs"), "5\n", "ascii")]

    monkeypatch.setattr(Path, "exists", lambda _path: False)
    monkeypatch.setattr(
        gpu_benchmark.resource,
        "getrusage",
        lambda _who: SimpleNamespace(ru_maxrss=7),
    )
    monkeypatch.setattr(gpu_benchmark.sys, "platform", "darwin")
    assert _peak_rss_bytes() == 7
    monkeypatch.setattr(gpu_benchmark.sys, "platform", "linux")
    assert _peak_rss_bytes() == 7 * 1024


def test_gpu_cli_reports_missing_cuda_without_a_traceback(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(_config: GpuBenchmarkConfig) -> None:
        raise RuntimeError("CUDA is unavailable")

    monkeypatch.setattr("pathologize_tiling_benchmark.gpu_cli.run_gpu_decode_benchmark", fail)

    assert main(["run", "--fixture-root=fixture", "--batch-sizes=1"]) == 2
