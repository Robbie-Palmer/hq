from __future__ import annotations

from pathlib import Path
from typing import Any

import fire

from .data import acquire_dataset
from .experiment import report, run


class Commands:
    def acquire(
        self,
        manifest: str = "sources/nucls-corrected-single-rater.json",
        output: str = "data/nucls-corrected-single-rater",
    ) -> dict[str, Any]:
        return acquire_dataset(Path(manifest), Path(output)).model_dump(mode="json")

    def run(
        self,
        experiment: str = "experiments/nucls-public-baseline.json",
    ) -> dict[str, Any]:
        return run(Path(experiment))

    def report(
        self,
        experiment: str = "experiments/nucls-public-baseline.json",
        json_output: str = "reports/nucls-public-baseline.json",
        markdown_output: str = "reports/nucls-public-baseline.md",
    ) -> dict[str, Any]:
        return report(Path(experiment), Path(json_output), Path(markdown_output))


def main() -> None:
    fire.Fire(Commands)
