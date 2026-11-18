from __future__ import annotations

from pathlib import Path
from typing import Any

import fire

from .annotation_foundation_models import (
    ComparisonOptions,
    acquire_cellsam_weights,
    compare_foundation_models,
)
from .annotation_pilot import PilotOptions, run_annotation_pilot
from .contracts import StrictModel
from .experiment import report, run
from .learned_baseline.conversion import acquire_model_artifacts, prepare_training_layout
from .learned_baseline.evaluation import evaluate_learned_baseline
from .learned_baseline.prediction import predict_learned_baseline
from .learned_baseline.reporting import report_learned_baseline
from .learned_baseline.training import train_learned_baseline


class RunOptions(StrictModel):
    params: Path


class ReportOptions(RunOptions):
    json_output: Path
    markdown_output: Path


class LearnedCommands:
    def acquire_artifacts(self) -> dict[str, Any]:
        return acquire_model_artifacts()

    def prepare(self) -> dict[str, Any]:
        return prepare_training_layout()

    def train(self) -> dict[str, Any]:
        return train_learned_baseline()

    def predict(self) -> dict[str, Any]:
        return predict_learned_baseline()

    def evaluate(self) -> dict[str, Any]:
        return evaluate_learned_baseline()

    def report(self) -> dict[str, Any]:
        return report_learned_baseline()


class AnnotationCommands:
    def acquire_cellsam(
        self,
        params: str = "params/nucls-annotation-pilot.yaml",
        output: str = "models/annotation/cellsam-v1.2/cellsam_general.pt",
    ) -> dict[str, Any]:
        return acquire_cellsam_weights(Path(params), Path(output))

    def pilot(
        self,
        output: str = "outputs/annotation-pilot",
        maximum_polygon_evaluations: int = 2000,
        review_items: int = 12,
        random_seed: int = 20261109,
    ) -> dict[str, Any]:
        options = PilotOptions.model_validate(
            {
                "output": output,
                "maximum_polygon_evaluations": maximum_polygon_evaluations,
                "review_items": review_items,
                "random_seed": random_seed,
            }
        )
        return run_annotation_pilot(options)

    def compare(
        self,
        params: str = "params/nucls-annotation-pilot.yaml",
        pilot_output: str = "outputs/annotation-pilot",
        output: str = "outputs/annotation-foundation-models",
        cellsam_weights: str = "models/annotation/cellsam-v1.2/cellsam_general.pt",
        device: str = "cuda:0",
    ) -> dict[str, Any]:
        options = ComparisonOptions.model_validate(
            {
                "params": params,
                "pilot_output": pilot_output,
                "output": output,
                "cellsam_weights": cellsam_weights,
                "device": device,
            }
        )
        return compare_foundation_models(options)


class Commands:
    annotation = AnnotationCommands()
    learned = LearnedCommands()

    def run(
        self,
        params: str = "params/nucls-public.yaml",
    ) -> dict[str, Any]:
        options = RunOptions.model_validate({"params": params})
        return run(options.params)

    def report(
        self,
        params: str = "params/nucls-public.yaml",
        json_output: str = "reports/nucls-public-baseline.json",
        markdown_output: str = "reports/nucls-public-baseline.md",
    ) -> dict[str, Any]:
        options = ReportOptions.model_validate(
            {
                "params": params,
                "json_output": json_output,
                "markdown_output": markdown_output,
            }
        )
        return report(options.params, options.json_output, options.markdown_output)


def main() -> None:
    fire.Fire(Commands)
