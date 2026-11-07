from __future__ import annotations

from pathlib import Path
from typing import Any

import fire

from .contracts import StrictModel
from .data import acquire_dataset
from .experiment import report, run
from .ultralytics_conversion import acquire_ultralytics_artifacts, prepare_ultralytics_layout
from .ultralytics_evaluation import evaluate_ultralytics
from .ultralytics_prediction import predict_ultralytics
from .ultralytics_reporting import report_ultralytics
from .ultralytics_training import train_ultralytics


class AcquireOptions(StrictModel):
    manifest: Path
    output: Path


class RunOptions(StrictModel):
    experiment: Path


class ReportOptions(RunOptions):
    json_output: Path
    markdown_output: Path


class Commands:
    def acquire(
        self,
        manifest: str = "sources/nucls-corrected-single-rater.json",
        output: str = "data/nucls-corrected-single-rater",
    ) -> dict[str, Any]:
        options = AcquireOptions.model_validate({"manifest": manifest, "output": output})
        return acquire_dataset(options.manifest, options.output).model_dump(mode="json")

    def run(
        self,
        experiment: str = "experiments/nucls-public-baseline.json",
    ) -> dict[str, Any]:
        options = RunOptions.model_validate({"experiment": experiment})
        return run(options.experiment)

    def report(
        self,
        experiment: str = "experiments/nucls-public-baseline.json",
        json_output: str = "reports/nucls-public-baseline.json",
        markdown_output: str = "reports/nucls-public-baseline.md",
    ) -> dict[str, Any]:
        options = ReportOptions.model_validate(
            {
                "experiment": experiment,
                "json_output": json_output,
                "markdown_output": markdown_output,
            }
        )
        return report(options.experiment, options.json_output, options.markdown_output)

    def acquire_ultralytics(self) -> dict[str, Any]:
        return acquire_ultralytics_artifacts()

    def prepare_ultralytics(self) -> dict[str, Any]:
        return prepare_ultralytics_layout()

    def train_ultralytics(self) -> dict[str, Any]:
        return train_ultralytics()

    def predict_ultralytics(self) -> dict[str, Any]:
        return predict_ultralytics()

    def evaluate_ultralytics(self) -> dict[str, Any]:
        return evaluate_ultralytics()

    def report_ultralytics(self) -> dict[str, Any]:
        return report_ultralytics()


def main() -> None:
    fire.Fire(Commands)
