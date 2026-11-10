from __future__ import annotations

from pathlib import Path
from typing import Any

from data_artifacts.files import read_json, write_json

from .config import PROJECT_ROOT
from .detection_calibration_contracts import (
    CALIBRATION_JSON_REPORT_FILE,
    CALIBRATION_MARKDOWN_REPORT_FILE,
    EVIDENCE_FILENAME,
    TEST_ROOT,
    VALIDATION_ROOT,
)


def _number(value: float | int) -> str:  # pragma: no cover
    return f"{value:.4f}" if isinstance(value, float) else f"{value:,}"


def report_markdown(  # pragma: no cover
    validation: dict[str, Any], test: dict[str, Any]
) -> str:
    selected = validation["selected"]
    baseline = test["baseline"]
    calibrated = test["calibrated"]
    class_rows = "\n".join(
        f"| `{label}` | {_number(baseline['per_class'][label]['f1'])} | {_number(values['f1'])} |"
        for label, values in calibrated["per_class"].items()
    )
    site_rows = "\n".join(
        f"| `{site}` | {_number(baseline['held_out_sites'][site]['f1'])} | "
        f"{_number(values['f1'])} |"
        for site, values in calibrated["held_out_sites"].items()
    )
    uncertainty = test["uncertainty"]["delta_intervals"]
    resources = test["resources"]
    return "\n".join(
        [
            "# NuCLS detection operating-point calibration",
            "",
            "This non-clinical experiment selected one confidence and NMS operating point on the "
            "frozen validation fold, then evaluated it once on the frozen test fold. Model "
            "weights, "
            "training parameters, folds, ontology, empty-image handling, ignored regions, and "
            "coordinate semantics did not change.",
            "",
            "## Locked operating point",
            "",
            "Validation passed with confidence "
            f"`{selected['operating_point']['confidence_threshold']:.2f}` "
            f"and NMS IoU `{selected['operating_point']['nms_iou_threshold']:.2f}`.",
            "",
            "## Frozen-test localization",
            "",
            "| Metric | Baseline | Calibrated | Delta |",
            "| --- | ---: | ---: | ---: |",
            *[
                f"| {key.capitalize()} | {_number(baseline['localization'][key])} | "
                f"{_number(calibrated['localization'][key])} | {_number(test['delta'][key])} |"
                for key in ("precision", "recall", "f1")
            ],
            "",
            "Paired slide-bootstrap 95% intervals for calibrated minus baseline were "
            f"precision [{uncertainty['precision']['lower']:.4f}, "
            f"{uncertainty['precision']['upper']:.4f}], recall "
            f"[{uncertainty['recall']['lower']:.4f}, {uncertainty['recall']['upper']:.4f}], "
            f"and F1 [{uncertainty['f1']['lower']:.4f}, {uncertainty['f1']['upper']:.4f}].",
            "",
            "## Per-class localization F1",
            "",
            "| Source class | Baseline | Calibrated |",
            "| --- | ---: | ---: |",
            class_rows,
            "",
            "## Held-out-site localization F1",
            "",
            "| Site | Baseline | Calibrated |",
            "| --- | ---: | ---: |",
            site_rows,
            "",
            "## Resources and failures",
            "",
            "Validation inference used "
            f"{resources['validation_inference']['wall_seconds']:.2f} wall "
            f"seconds and {resources['validation_inference']['gpu_seconds']:.2f} GPU seconds. "
            "The single test inference used "
            f"{resources['test_inference']['wall_seconds']:.2f} wall seconds and "
            f"{resources['test_inference']['gpu_seconds']:.2f} GPU seconds. Peak allocated VRAM "
            "across calibration inference was "
            f"{resources['calibration_total']['peak_vram_bytes']:,} bytes.",
            "",
            f"Prediction normalization rejected {len(test['failures']):,} test instances.",
            "",
            test["apparent_false_positive_interpretation"],
            "",
            "This experiment does not establish clinical validity.",
            "",
        ]
    )


def write_markdown_report(
    content: str,
    destination: Path = CALIBRATION_MARKDOWN_REPORT_FILE,
    reports_root: Path = PROJECT_ROOT / "reports",
) -> None:
    resolved_root = reports_root.resolve()
    resolved_destination = destination.resolve()
    if resolved_destination.parent != resolved_root:
        raise ValueError("calibration report destination must be inside the reports directory")
    resolved_destination.write_text(content, encoding="utf-8")  # NOSONAR - validated above.


def report_detection_calibration() -> dict[str, object]:  # pragma: no cover
    validation = read_json(VALIDATION_ROOT / EVIDENCE_FILENAME)
    test = read_json(TEST_ROOT / EVIDENCE_FILENAME)
    metrics: dict[str, object] = {
        "validation_passed": validation["passed"],
        "operating_point": validation["selected"]["operating_point"],
        "validation": {
            "baseline": validation["baseline"]["localization"],
            "selected": validation["selected"]["localization"],
            "delta": validation["selected"]["delta"],
            "uncertainty": validation["uncertainty"],
        },
        "test": {
            "baseline": test["baseline"],
            "calibrated": test["calibrated"],
            "delta": test["delta"],
            "uncertainty": test["uncertainty"],
        },
        "failure_count": len(test["failures"]),
        "resources": test["resources"],
    }
    write_json(CALIBRATION_JSON_REPORT_FILE, metrics)
    write_markdown_report(report_markdown(validation, test))
    return metrics
