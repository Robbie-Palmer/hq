from __future__ import annotations

import hashlib
import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from pathologize_stain_provenance.models import MigrationMap, ProvenanceContract

PROJECT_DIR = Path(__file__).resolve().parents[2]
SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "migration-map.schema.json": MigrationMap,
    "provenance-contract.schema.json": ProvenanceContract,
}


class VerificationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    contract_count: int
    migration_count: int
    metadata_sha256: dict[str, str]


def load_contract(path: Path) -> ProvenanceContract:
    return ProvenanceContract.model_validate_json(path.read_text(encoding="utf-8"))


def load_migration(path: Path) -> MigrationMap:
    return MigrationMap.model_validate_json(path.read_text(encoding="utf-8"))


def _schema_text(model: type[BaseModel]) -> str:
    return json.dumps(model.model_json_schema(), indent=2, sort_keys=True) + "\n"


def write_schemas(root: Path = PROJECT_DIR, *, check: bool = False) -> None:
    schema_dir = root / "schemas"
    if not check:
        schema_dir.mkdir(parents=True, exist_ok=True)
    for filename, model in SCHEMA_MODELS.items():
        path = schema_dir / filename
        expected = _schema_text(model)
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                raise ValueError(f"schema drift: {path}")
        else:
            path.write_text(expected, encoding="utf-8")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_metadata(root: Path = PROJECT_DIR) -> VerificationSummary:
    contracts = sorted((root / "examples").glob("*.json"))
    migrations = sorted((root / "migrations").glob("*.json"))
    if not contracts or not migrations:
        raise ValueError("metadata verification requires contracts and migration maps")
    for path in contracts:
        load_contract(path)
    for path in migrations:
        load_migration(path)
    write_schemas(root, check=True)
    paths = [*contracts, *migrations, *(root / "schemas").glob("*.json")]
    checksums = {
        str(path.relative_to(root)): _sha256(path) for path in sorted(paths) if path.is_file()
    }
    return VerificationSummary(
        contract_count=len(contracts),
        migration_count=len(migrations),
        metadata_sha256=checksums,
    )
