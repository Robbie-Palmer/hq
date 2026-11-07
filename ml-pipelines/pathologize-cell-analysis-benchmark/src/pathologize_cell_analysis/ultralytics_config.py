from __future__ import annotations

from pathlib import Path

from data_artifacts.files import read_yaml, resolve_under, sha256_file

from .contracts import UltralyticsConfig

ULTRALYTICS_PARAMS_PATH = Path("params/nucls-ultralytics.yaml")
ULTRALYTICS_OUTPUT_DIRECTORY = Path("outputs/public/nucls-ultralytics-yolo26n-v1")
ULTRALYTICS_JSON_REPORT = Path("reports/nucls-ultralytics-baseline.json")
ULTRALYTICS_MARKDOWN_REPORT = Path("reports/nucls-ultralytics-baseline.md")
ULTRALYTICS_PROJECT_ROOT = Path(__file__).resolve().parents[2]
ULTRALYTICS_PARAMS_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_PARAMS_PATH
ULTRALYTICS_OUTPUT_ROOT = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_OUTPUT_DIRECTORY
ULTRALYTICS_JSON_REPORT_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_JSON_REPORT
ULTRALYTICS_MARKDOWN_REPORT_FILE = ULTRALYTICS_PROJECT_ROOT / ULTRALYTICS_MARKDOWN_REPORT


def load_ultralytics_config(path: Path = ULTRALYTICS_PARAMS_FILE) -> UltralyticsConfig:
    document = read_yaml(path)
    if not isinstance(document, dict):
        raise TypeError("Ultralytics parameters must be a YAML object")
    return UltralyticsConfig.model_validate(document)


def project_root(params_path: Path) -> Path:
    return params_path.resolve().parents[1]


def output_root(root: Path, config: UltralyticsConfig) -> Path:
    expected = ULTRALYTICS_OUTPUT_DIRECTORY.as_posix()
    if config.output_directory != expected:
        raise ValueError(f"Ultralytics output directory must be {expected}")
    return resolve_under(root, config.output_directory)


def parameters_sha256(path: Path = ULTRALYTICS_PARAMS_FILE) -> str:
    return sha256_file(path)
