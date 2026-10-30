from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Literal

import duckdb
from pydantic import Field

from work_graph_analytics.manifest import Checksum, DatasetError, NonEmptyString, StrictModel

MODEL_FILES = (
    "fct_events.parquet",
    "fct_scopes.parquet",
    "fct_tickets.parquet",
    "fct_wait_episodes.parquet",
    "mart_operational_metrics.parquet",
    "mart_interventions.parquet",
    "mart_stale_leases.parquet",
    "mart_handoffs.parquet",
)
VERSION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


class PublishedModel(StrictModel):
    key: NonEmptyString
    rows: int = Field(ge=0)
    size: int = Field(serialization_alias="bytes", ge=0)
    checksum: Checksum = Field(serialization_alias="checksumSha256")


class PublicationSource(StrictModel):
    manifest_keys: list[NonEmptyString] = Field(serialization_alias="manifestKeys", min_length=1)
    through_sequence: int = Field(serialization_alias="throughSequence", ge=1)


class PublicationManifest(StrictModel):
    complete: Literal[True] = True
    manifest_schema_version: Literal[1] = Field(
        default=1, serialization_alias="manifestSchemaVersion"
    )
    model_version: NonEmptyString = Field(serialization_alias="modelVersion")
    source: PublicationSource
    models: list[PublishedModel] = Field(min_length=1)


def ensure_new_version(output_root: Path, version: str) -> Path:
    if not VERSION_PATTERN.fullmatch(version):
        raise DatasetError("model version must be a safe, non-empty identifier")
    version_root = output_root / version
    if version_root.exists():
        raise DatasetError(f"model version already exists: {version}")
    version_root.mkdir(parents=True)
    return version_root


def publish_manifest(
    output_root: Path,
    version: str,
    *,
    source_manifest_keys: list[str],
    source_watermark: int,
) -> Path:
    version_root = output_root / version
    if not version_root.is_dir():
        raise DatasetError(f"model version does not exist: {version}")
    if not source_manifest_keys or source_watermark < 1:
        raise DatasetError("publication requires source manifests and a positive watermark")
    models: list[PublishedModel] = []
    for filename in MODEL_FILES:
        path = version_root / filename
        if not path.is_file():
            raise DatasetError(f"missing model output: {filename}")
        body = path.read_bytes()
        row = duckdb.sql("select count(*) from read_parquet(?)", params=[str(path)]).fetchone()
        if row is None:
            raise DatasetError(f"cannot count model output: {filename}")
        models.append(
            PublishedModel(
                key=f"{version}/{filename}",
                rows=row[0],
                size=len(body),
                checksum=hashlib.sha256(body).hexdigest(),
            )
        )
    manifest = PublicationManifest(
        model_version=version,
        source=PublicationSource(
            manifest_keys=source_manifest_keys,
            through_sequence=source_watermark,
        ),
        models=models,
    )
    destination = version_root / "manifest.json"
    if destination.exists():
        raise DatasetError(f"publication manifest already exists for {version}")
    destination.write_text(manifest.model_dump_json(by_alias=True))
    return destination
