from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import cast

import fire
from pydantic import ValidationError

from .model_loader_benchmark import parse_positive_integers, run_model_loader_benchmark
from .model_loader_contracts import (
    AccessPattern,
    ModelLoaderBenchmarkConfig,
    Workload,
)


def _parse_strings(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


class ModelLoaderBenchmarkApplication:
    def run(
        self,
        fixture_root: str,
        fixture_manifest: str,
        fixture_collection_manifest: str,
        batch_sizes: int | str = "8,32,64",
        loader_concurrency: int | str = "1,2,4",
        access_patterns: str = "random",
        workloads: str = "inference,training",
        warmup_batches: int = 4,
        measured_batches: int = 16,
        random_seed: int = 1729,
        output_path: str | None = None,
    ) -> None:
        config = ModelLoaderBenchmarkConfig(
            fixture_root=Path(fixture_root).resolve(),
            fixture_manifest=Path(fixture_manifest).resolve(),
            fixture_collection_manifest=Path(fixture_collection_manifest).resolve(),
            batch_sizes=parse_positive_integers(batch_sizes),
            loader_concurrency=parse_positive_integers(loader_concurrency),
            access_patterns=cast(tuple[AccessPattern, ...], _parse_strings(access_patterns)),
            workloads=cast(tuple[Workload, ...], _parse_strings(workloads)),
            warmup_batches=warmup_batches,
            measured_batches=measured_batches,
            random_seed=random_seed,
        )
        report = run_model_loader_benchmark(config)
        serialized = report.model_dump_json(indent=2)
        if output_path is None:
            print(serialized)
            return
        selected_output = Path(output_path).resolve()
        selected_output.parent.mkdir(parents=True, exist_ok=True)
        selected_output.write_text(f"{serialized}\n", encoding="utf-8")
        print(selected_output)


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(
            ModelLoaderBenchmarkApplication,
            command=list(command) if command is not None else None,
        )
    except (ImportError, OSError, RuntimeError, ValidationError, ValueError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
