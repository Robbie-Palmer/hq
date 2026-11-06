from __future__ import annotations

from pathlib import Path
from typing import Any

from data_artifacts.files import (
    canonical_bytes,
    read_json,
    sha256_bytes,
    sha256_tree,
)

__all__ = [
    "code_revision",
    "load_params",
    "project_root",
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
    evaluation_root = root.parents[1] / "packages/ml-evaluation"
    evaluation_paths = sorted((evaluation_root / "src").rglob("*.py"))
    artifacts_root = root.parents[1] / "packages/data-artifacts"
    artifact_paths = sorted((artifacts_root / "src").rglob("*.py"))
    value = sha256_bytes(
        canonical_bytes(
            {
                "project": sha256_tree(project_paths, root=root),
                "data_artifacts": sha256_tree(artifact_paths, root=artifacts_root),
                "ml_evaluation": sha256_tree(evaluation_paths, root=evaluation_root),
            }
        )
    )
    return {
        "kind": "content_sha256",
        "value": value,
    }
