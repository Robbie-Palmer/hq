from __future__ import annotations

from pathlib import Path

from data_artifacts.files import read_yaml, sha256_file
from nucleus_analysis_dataset import DATASET_ROOT, CohortEvidence, load_cohort, load_ontology_labels

from ..contracts import LearnedBaselineConfig

PARAMS_PATH = Path("params/nucls-learned.yaml")
LAYOUT_DIRECTORY = Path("data/derived/learned-layout")
WEIGHTS_DIRECTORY = Path("models/ultralytics/8.4.0")
OUTPUT_DIRECTORY = Path("outputs/learned-baseline")
TRANSPARENT_BASELINE_REPORT = Path("reports/nucls-public-baseline.json")
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
    del config
    return root / OUTPUT_DIRECTORY


def data_root() -> Path:
    return DATASET_ROOT


def cohort() -> CohortEvidence:
    return load_cohort()


def ontology_labels() -> list[str]:
    return load_ontology_labels()


def parameters_sha256(path: Path = PARAMS_FILE) -> str:
    return sha256_file(path)
