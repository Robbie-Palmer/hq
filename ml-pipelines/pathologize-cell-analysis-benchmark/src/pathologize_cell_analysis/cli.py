from __future__ import annotations

from pathlib import Path
from typing import Any

import fire

from .contracts import StrictModel
from .double_descent.analysis import analyze as analyze_double_descent
from .double_descent.evaluation import evaluate as evaluate_double_descent
from .double_descent.reporting import report as report_double_descent
from .double_descent.test_evaluation import evaluate_test as evaluate_double_descent_test
from .double_descent.training import train as train_double_descent
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


class DoubleDescentCommands:
    def train(self, seed: int) -> dict[str, Any]:
        return train_double_descent(seed)

    def curve(self, seed: int) -> dict[str, Any]:
        return evaluate_double_descent(seed)

    def analyze(self) -> dict[str, Any]:
        return analyze_double_descent()

    def test(self) -> dict[str, Any]:
        return evaluate_double_descent_test()

    def report(self) -> dict[str, Any]:
        return report_double_descent()


class Commands:
    learned = LearnedCommands()
    double_descent = DoubleDescentCommands()

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
