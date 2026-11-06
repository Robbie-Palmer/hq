from pathlib import Path

from ml_evaluation.artifacts import (
    canonical_bytes,
    load_model,
    pretty_bytes,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_bytes,
    sha256_file,
    write_json,
    write_jsonl,
)

__all__ = [
    "canonical_bytes",
    "contract_root",
    "load_model",
    "pretty_bytes",
    "project_root",
    "read_json",
    "read_jsonl",
    "resolve_under",
    "sha256_bytes",
    "sha256_file",
    "write_json",
    "write_jsonl",
]


def project_root() -> Path:
    return Path.cwd().resolve()


def contract_root() -> Path:
    return Path(__file__).resolve().parents[2]
