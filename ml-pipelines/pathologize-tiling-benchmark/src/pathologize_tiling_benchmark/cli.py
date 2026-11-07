from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from .experiment import prepare_inputs, run_experiment, verify_experiment


class TilingExperimentApplication:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else Path.cwd()

    def prepare(self) -> None:
        manifest = prepare_inputs(self.root)
        print(f"Prepared {manifest['derived_image']} from the pinned public slide.")

    def run(self) -> None:
        result = run_experiment(self.root)
        print(f"Recorded {len(result.adapters[0].cases)} physical-scale perturbation cases.")

    def verify(self, write_report: bool = False) -> None:
        report = verify_experiment(self.root, write_report=write_report)
        print(f"Verified {report['case_count']} cases; requested-scale echo control was rejected.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(
            TilingExperimentApplication,
            command=list(command) if command is not None else None,
        )
    except (OSError, ValidationError, ValueError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
