from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from pathologize_data_registry.models import (
    AssetManifest,
    CollectionManifest,
    RegistryIndex,
    SlideRecord,
    SubsetManifest,
)

SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "asset-manifest.schema.json": AssetManifest,
    "collection-manifest.schema.json": CollectionManifest,
    "registry.schema.json": RegistryIndex,
    "slide-record.schema.json": SlideRecord,
    "subset-manifest.schema.json": SubsetManifest,
}


class SchemaDriftError(RuntimeError):
    pass


def schema_payload(model: type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), indent=2, sort_keys=True) + "\n"


def write_schemas(output_dir: Path, *, check: bool) -> list[Path]:
    written: list[Path] = []
    for name, model in sorted(SCHEMA_MODELS.items()):
        path = output_dir / name
        expected = schema_payload(model)
        if check:
            actual = path.read_text(encoding="utf-8") if path.is_file() else None
            if actual != expected:
                raise SchemaDriftError(f"{path} differs from the generated schema")
        else:
            output_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(expected, encoding="utf-8")
        written.append(path)
    return written
