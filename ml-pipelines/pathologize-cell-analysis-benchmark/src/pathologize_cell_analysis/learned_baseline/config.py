from __future__ import annotations

from pathlib import Path

from data_artifacts.files import read_yaml, resolve_under, sha256_file

from ..contracts import LearnedBaselineConfig

PARAMS_PATH = Path("params/nucls-learned.yaml")
OUTPUT_DIRECTORY = Path("outputs/public/nucls-ultralytics-yolo26n-v1")
JSON_REPORT = Path("reports/nucls-learned-baseline.json")
MARKDOWN_REPORT = Path("reports/nucls-learned-baseline.md")
PROJECT_ROOT = Path(__file__).resolve().parents[3]
PARAMS_FILE = PROJECT_ROOT / PARAMS_PATH
OUTPUT_ROOT = PROJECT_ROOT / OUTPUT_DIRECTORY
JSON_REPORT_FILE = PROJECT_ROOT / JSON_REPORT
MARKDOWN_REPORT_FILE = PROJECT_ROOT / MARKDOWN_REPORT


def load_config(path: Path = PARAMS_FILE) -> LearnedBaselineConfig:
    document = read_yaml(path)
    if not isinstance(document, dict):
        raise TypeError("learned-baseline parameters must be a YAML object")
    return LearnedBaselineConfig.model_validate(document)


def project_root(params_path: Path) -> Path:
    return params_path.resolve().parents[1]


def output_root(root: Path, config: LearnedBaselineConfig) -> Path:
    expected = OUTPUT_DIRECTORY.as_posix()
    if config.output_directory != expected:
        raise ValueError(f"Ultralytics output directory must be {expected}")
    return resolve_under(root, config.output_directory)


def parameters_sha256(path: Path = PARAMS_FILE) -> str:
    return sha256_file(path)
