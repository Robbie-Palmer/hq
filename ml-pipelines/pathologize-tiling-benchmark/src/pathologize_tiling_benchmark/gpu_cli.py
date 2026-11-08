from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from .gpu_benchmark import parse_batch_sizes, run_gpu_decode_benchmark
from .gpu_contracts import GpuBenchmarkConfig


class GpuDecodeBenchmarkApplication:
    def run(
        self,
        fixture_root: str,
        batch_sizes: int | str = "1,8,32,128",
        warmup_repetitions: int = 1,
        measured_repetitions: int = 5,
        random_seed: int = 1729,
    ) -> None:
        config = GpuBenchmarkConfig(
            fixture_root=Path(fixture_root).resolve(),
            batch_sizes=parse_batch_sizes(batch_sizes),
            warmup_repetitions=warmup_repetitions,
            measured_repetitions=measured_repetitions,
            random_seed=random_seed,
        )
        report = run_gpu_decode_benchmark(config)
        print(report.model_dump_json(indent=2))


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(
            GpuDecodeBenchmarkApplication,
            command=list(command) if command is not None else None,
        )
    except (ImportError, OSError, RuntimeError, ValidationError, ValueError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
