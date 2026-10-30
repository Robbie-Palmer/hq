"""Deterministic artifact I/O and content hashing."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from pydantic import BaseModel


def canonical_bytes(value: Any) -> bytes:
    """Serialize JSON with stable ordering and no platform-specific whitespace."""
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()


def pretty_bytes(value: Any) -> bytes:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pretty_bytes(value))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_model[ModelT: BaseModel](path: Path, model_type: type[ModelT]) -> ModelT:
    return model_type.model_validate(read_json(path))


def write_jsonl(path: Path, values: Iterable[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        for value in values:
            output.write(canonical_bytes(value))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def sha256_tree(paths: Iterable[Path], *, root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.as_posix()):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def resolve_under(root: Path, relative: str | Path) -> Path:
    """Resolve an artifact path and reject escapes from its declared root."""
    root = root.resolve()
    relative = Path(relative)
    if relative.is_absolute():
        raise ValueError("artifact path must be relative")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError("artifact path escapes its declared root") from error
    return candidate


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def load_params(root: Path) -> dict[str, Any]:
    """params.yaml uses JSON syntax, which is valid YAML and needs no loose parser."""
    value = read_json(root / "params.yaml")
    if not isinstance(value, dict):
        raise TypeError("params.yaml must contain an object")
    return value


def code_revision(root: Path) -> dict[str, str]:
    source_paths = [
        *sorted((root / "src").rglob("*.py")),
        root / "pyproject.toml",
        root / "uv.lock",
    ]
    return {
        "kind": "content_sha256",
        "value": sha256_tree(source_paths, root=root),
    }
