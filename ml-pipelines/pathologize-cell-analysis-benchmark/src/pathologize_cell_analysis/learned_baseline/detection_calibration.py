from __future__ import annotations

from pathlib import Path
from typing import Any

import fire

from ..data import SplitItem
from .config import PROJECT_ROOT
from .detection_calibration_contracts import (
    CALIBRATION_MARKDOWN_REPORT_FILE,
    CalibrationPredictionRecord,
    DetectionCalibrationConfig,
    filter_records,
    load_calibration_config,
    require_complete_records,
)

_filter_records = filter_records
_require_complete_records = require_complete_records


def _write_markdown_report(
    content: str,
    destination: Path = CALIBRATION_MARKDOWN_REPORT_FILE,
    reports_root: Path = PROJECT_ROOT / "reports",
) -> None:
    from .detection_calibration_reporting import write_markdown_report

    write_markdown_report(content, destination, reports_root)


def paired_slide_bootstrap(
    baseline_records: list[CalibrationPredictionRecord],
    candidate_records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    source_root: Path,
    resamples: int,
    seed: int,
    tolerance_pixels: float,
) -> dict[str, Any]:
    from .detection_calibration_statistics import paired_slide_bootstrap as calculate

    return calculate(
        baseline_records,
        candidate_records,
        items,
        source_root,
        resamples,
        seed,
        tolerance_pixels,
    )


__all__ = [
    "CalibrationPredictionRecord",
    "DetectionCalibrationConfig",
    "_filter_records",
    "_require_complete_records",
    "_write_markdown_report",
    "load_calibration_config",
    "paired_slide_bootstrap",
]


class CalibrationCommands:  # pragma: no cover
    def predict_validation(self) -> dict[str, object]:
        from .detection_calibration_inference import predict_detection_validation

        return predict_detection_validation()

    def evaluate_validation(self) -> dict[str, object]:
        from .detection_calibration_validation import calibrate_detection_validation

        return calibrate_detection_validation()

    def lock(self) -> dict[str, object]:
        from .detection_calibration_evaluation import lock_detection_calibration

        return lock_detection_calibration()

    def predict_test(self) -> dict[str, object]:
        from .detection_calibration_inference import predict_detection_test

        return predict_detection_test()

    def evaluate_test(self) -> dict[str, object]:
        from .detection_calibration_evaluation import evaluate_detection_test

        return evaluate_detection_test()

    def report(self) -> dict[str, object]:
        from .detection_calibration_reporting import report_detection_calibration

        return report_detection_calibration()


def main() -> None:  # pragma: no cover
    fire.Fire(CalibrationCommands)


if __name__ == "__main__":
    main()
