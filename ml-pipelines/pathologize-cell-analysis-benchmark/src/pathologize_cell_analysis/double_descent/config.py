from __future__ import annotations

from pathlib import Path

from data_artifacts.files import read_yaml

from ..contracts import DoubleDescentConfig
from ..learned_baseline.config import load_config as load_baseline_config

PARAMS_PATH = Path("params/nucls-double-descent.yaml")
OUTPUT_DIRECTORY = Path("outputs/nucls-double-descent")
REPORT_JSON = Path("reports/nucls-double-descent.json")
REPORT_MARKDOWN = Path("reports/nucls-double-descent.md")
PROJECT_ROOT = Path(__file__).resolve().parents[3]
PARAMS_FILE = PROJECT_ROOT / PARAMS_PATH
OUTPUT_ROOT = PROJECT_ROOT / OUTPUT_DIRECTORY
REPORT_JSON_FILE = PROJECT_ROOT / REPORT_JSON
REPORT_MARKDOWN_FILE = PROJECT_ROOT / REPORT_MARKDOWN


def _require_merged_baseline(config: DoubleDescentConfig) -> None:
    baseline = load_baseline_config()
    if config.package != baseline.package:
        raise ValueError("double-descent package pin differs from the merged baseline")
    if config.model != baseline.models["detect"]:
        raise ValueError("double-descent detector pin differs from the merged baseline")
    if config.inference != baseline.inference:
        raise ValueError("double-descent inference settings differ from the merged baseline")
    if config.localization_tolerance_pixels != baseline.localization_tolerance_pixels:
        raise ValueError("double-descent localization tolerance differs from the merged baseline")
    if config.maximum_border_clip_pixels != baseline.maximum_border_clip_pixels:
        raise ValueError("double-descent conversion tolerance differs from the merged baseline")
    restored_training = config.training.model_copy(
        update={"epochs": baseline.training.epochs, "patience": baseline.training.patience}
    )
    if restored_training != baseline.training:
        raise ValueError("double-descent training settings change more than horizon and patience")


def load_config(path: Path = PARAMS_FILE) -> DoubleDescentConfig:
    document = read_yaml(path)
    if not isinstance(document, dict):
        raise TypeError("double-descent parameters must be a YAML object")
    config = DoubleDescentConfig.model_validate(document)
    _require_merged_baseline(config)
    return config


def seed_output(seed: int) -> Path:
    return OUTPUT_ROOT / "training" / str(seed)


def seed_evaluation(seed: int) -> Path:
    return OUTPUT_ROOT / "curves" / str(seed)
