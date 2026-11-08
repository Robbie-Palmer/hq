from __future__ import annotations

import json
from pathlib import Path

import pytest

from pathologize_tiling_benchmark.model_loader_benchmark import (
    _fixture_assets,
    _StageSample,
    _summarize_stages,
    parse_positive_integers,
    plan_coordinate_batches,
)
from pathologize_tiling_benchmark.model_loader_cli import _parse_strings, main
from pathologize_tiling_benchmark.model_loader_contracts import ModelLoaderBenchmarkConfig


def _config(tmp_path: Path, **updates: object) -> ModelLoaderBenchmarkConfig:
    values: dict[str, object] = {
        "fixture_root": tmp_path,
        "fixture_manifest": tmp_path / "assets.json",
        "fixture_collection_manifest": tmp_path / "collection.json",
    }
    values.update(updates)
    return ModelLoaderBenchmarkConfig.model_validate(values)


def test_model_loader_config_rejects_invalid_matrix_values(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="positive integers"):
        _config(tmp_path, batch_sizes=(0,))
    with pytest.raises(ValueError, match="duplicates"):
        _config(tmp_path, loader_concurrency=(1, 1))
    with pytest.raises(ValueError, match="must not be empty"):
        _config(tmp_path, workloads=())


def test_coordinate_batch_planning_is_deterministic_and_bounded() -> None:
    coordinates = tuple((index, 0) for index in range(6))
    first = plan_coordinate_batches(
        coordinates,
        access_pattern="random",
        batch_size=2,
        batch_count=6,
        seed=17,
    )
    second = plan_coordinate_batches(
        coordinates,
        access_pattern="random",
        batch_size=2,
        batch_count=6,
        seed=17,
    )
    different_seed = plan_coordinate_batches(
        coordinates,
        access_pattern="random",
        batch_size=2,
        batch_count=6,
        seed=18,
    )
    contiguous = plan_coordinate_batches(
        coordinates,
        access_pattern="contiguous",
        batch_size=3,
        batch_count=2,
        seed=1,
    )

    assert first == second
    assert first != different_seed
    assert first[:3] != first[3:]
    assert {coordinate for batch in first[:3] for coordinate in batch} == set(coordinates)
    assert {coordinate for batch in first[3:] for coordinate in batch} == set(coordinates)
    assert all(len(batch) == 2 for batch in first)
    assert contiguous == (((1, 0), (2, 0), (3, 0)), ((4, 0), (5, 0), (0, 0)))
    with pytest.raises(ValueError, match="at least one"):
        plan_coordinate_batches((), access_pattern="random", batch_size=1, batch_count=1, seed=1)
    with pytest.raises(ValueError, match="exceeds"):
        plan_coordinate_batches(
            coordinates,
            access_pattern="random",
            batch_size=7,
            batch_count=1,
            seed=1,
        )


def test_stage_summary_keeps_cpu_and_cuda_totals() -> None:
    summary = _summarize_stages(
        (
            _StageSample("forward", 2.0, 0.1, 1.5),
            _StageSample("forward", 4.0, 0.3, 2.5),
        )
    )["forward"]

    assert summary.samples == 2
    assert summary.median_wall_milliseconds == 3.0
    assert summary.total_wall_milliseconds == 6.0
    assert summary.median_process_cpu_milliseconds == 0.2
    assert summary.total_cuda_milliseconds == 4.0


def test_fixture_manifest_verification_rejects_changed_public_bytes(tmp_path: Path) -> None:
    fixture = tmp_path / "fixture.dcm"
    fixture.write_bytes(b"public fixture")
    digest = "f05927da84e8f868dc61a86b97c2dfeda6c6d689e86045ec8860196e86ded5c0"
    manifest = tmp_path / "assets.json"
    manifest.write_text(
        json.dumps(
            {
                "asset_manifest_id": "fixture-assets",
                "assets": [
                    {
                        "relative_path": fixture.name,
                        "bytes": len(b"public fixture"),
                        "sha256": digest,
                        "source_url": "https://example.test/fixture.dcm",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    config = _config(tmp_path, fixture_manifest=manifest)

    manifest_id, assets = _fixture_assets(config)

    assert manifest_id == "fixture-assets"
    assert assets[0].sha256 == digest
    fixture.write_bytes(b"changed")
    with pytest.raises(ValueError, match="byte count differs"):
        _fixture_assets(config)


def test_parse_positive_integers_and_cli_error_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert parse_positive_integers("1, 2,4") == (1, 2, 4)
    assert parse_positive_integers(3) == (3,)
    assert _parse_strings("inference, training") == ("inference", "training")
    with pytest.raises(ValueError, match="comma-separated"):
        parse_positive_integers("one")

    def fail(_config: ModelLoaderBenchmarkConfig) -> None:
        raise RuntimeError("CUDA is unavailable")

    monkeypatch.setattr(
        "pathologize_tiling_benchmark.model_loader_cli.run_model_loader_benchmark", fail
    )
    assert (
        main(
            [
                "run",
                f"--fixture-root={tmp_path}",
                f"--fixture-manifest={tmp_path / 'assets.json'}",
                f"--fixture-collection-manifest={tmp_path / 'collection.json'}",
                "--batch-sizes=8",
                "--loader-concurrency=1",
            ]
        )
        == 2
    )
