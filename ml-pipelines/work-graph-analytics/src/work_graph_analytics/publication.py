from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import duckdb

from work_graph_analytics.manifest import DatasetError

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
    models: list[dict[str, object]] = []
    for filename in MODEL_FILES:
        path = version_root / filename
        if not path.is_file():
            raise DatasetError(f"missing model output: {filename}")
        body = path.read_bytes()
        rows = duckdb.sql("select count(*) from read_parquet(?)", params=[str(path)]).fetchone()
        if rows is None:
            raise DatasetError(f"cannot count model output: {filename}")
        models.append(
            {
                "key": f"{version}/{filename}",
                "rows": rows[0],
                "bytes": len(body),
                "checksumSha256": hashlib.sha256(body).hexdigest(),
            }
        )
    manifest = {
        "complete": True,
        "manifestSchemaVersion": 1,
        "modelVersion": version,
        "source": {
            "manifestKeys": source_manifest_keys,
            "throughSequence": source_watermark,
        },
        "models": models,
    }
    destination = version_root / "manifest.json"
    if destination.exists():
        raise DatasetError(f"publication manifest already exists for {version}")
    destination.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")))
    return destination
