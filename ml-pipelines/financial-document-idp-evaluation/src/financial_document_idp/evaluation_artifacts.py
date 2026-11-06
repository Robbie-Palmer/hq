from __future__ import annotations

from pathlib import Path
from typing import Any

from ml_evaluation.artifacts import (
    canonical_bytes,
    load_model,
    pretty_bytes,
    read_json,
    read_jsonl,
    resolve_under,
    sha256_bytes,
    sha256_file,
    sha256_tree,
    write_json,
    write_jsonl,
)

__all__ = [
    "canonical_bytes",
    "code_revision",
    "load_model",
    "load_params",
    "pretty_bytes",
    "project_root",
    "read_json",
    "read_jsonl",
    "resolve_under",
    "sha256_bytes",
    "sha256_file",
    "sha256_tree",
    "write_json",
    "write_jsonl",
]


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_params(root: Path) -> dict[str, Any]:
    """params.yaml uses JSON syntax, which is valid YAML and needs no loose parser."""
    value = read_json(root / "params.yaml")
    if not isinstance(value, dict):
        raise TypeError("params.yaml must contain an object")
    return value


def code_revision(root: Path) -> dict[str, str]:
    project_paths = [
        *sorted((root / "src").rglob("*.py")),
        root / "pyproject.toml",
        root / "uv.lock",
    ]
    shared_root = root.parents[1] / "packages/ml-evaluation"
    shared_paths = sorted((shared_root / "src").rglob("*.py"))
    value = sha256_bytes(
        canonical_bytes(
            {
                "project": sha256_tree(project_paths, root=root),
                "ml_evaluation": sha256_tree(shared_paths, root=shared_root),
            }
        )
    )
    return {
        "kind": "content_sha256",
        "value": value,
    }
