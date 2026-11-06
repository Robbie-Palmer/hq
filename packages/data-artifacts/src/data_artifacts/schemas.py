from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from pydantic import BaseModel

from .files import read_json, write_json


def write_schemas(
    models: Mapping[str, type[BaseModel]], *, root: Path, check: bool = False
) -> None:
    for filename, model in models.items():
        path = root / "schemas" / filename
        content = model.model_json_schema(mode="validation")
        if check:
            if read_json(path) != content:
                raise ValueError(f"JSON Schema drift: {filename}")
        else:
            write_json(path, content)
