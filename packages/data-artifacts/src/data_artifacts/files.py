from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel


def canonical_bytes(value: Any) -> bytes:
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
    with path.open("wb") as destination:
        destination.write(pretty_bytes(value))


def write_jsonl(path: Path, values: Iterable[Any]) -> int:
    content = b"".join(canonical_bytes(value) for value in values)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as destination:
        destination.write(content)
    return len(content)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def load_model[ModelT: BaseModel](path: Path, model_type: type[ModelT]) -> ModelT:
    return model_type.model_validate(read_json(path))


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def content_address(prefix: str, value: Any) -> str:
    return f"{prefix}:sha256:{sha256_bytes(canonical_bytes(value))}"


def sha256_tree(paths: Iterable[Path], *, root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.as_posix()):
        relative = path.relative_to(root).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def source_fingerprint(source: Path) -> str:
    source = source.resolve()
    paths = sorted(source.rglob("*.py"))
    if not paths:
        raise ValueError("source fingerprint requires at least one Python file")
    return sha256_tree(paths, root=source)


def resolve_under(root: Path, relative: str | Path) -> Path:
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
