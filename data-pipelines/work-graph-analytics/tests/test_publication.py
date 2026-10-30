from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from work_graph_analytics.manifest import DatasetError
from work_graph_analytics.publication import (
    MODEL_FILES,
    PublicationScopeSnapshot,
    ensure_new_version,
    publish_manifest,
)


def write_models(version_root: Path) -> None:
    for index, filename in enumerate(MODEL_FILES):
        escaped = (version_root / filename).as_posix().replace("'", "''")
        duckdb.sql(f"copy (select {index} as value) to '{escaped}' (format parquet)")


def test_publishes_complete_immutable_version_manifest(tmp_path: Path) -> None:
    version_root = ensure_new_version(tmp_path, "version-1")
    write_models(version_root)
    path = publish_manifest(
        tmp_path,
        "version-1",
        source_manifest_keys=["work-state/v1/manifests/1-9.json"],
        source_watermark=9,
        scope_snapshot=PublicationScopeSnapshot(
            manifest_key="work-state/v1/manifests/1-9.json",
            object_key="work-state/v1/scopes/9.json",
            captured_at="2026-10-01T03:05:00.000Z",
            event_watermark=9,
        ),
    )
    manifest = json.loads(path.read_text())

    assert manifest["complete"] is True
    assert manifest["modelVersion"] == "version-1"
    assert manifest["source"]["throughSequence"] == 9
    assert manifest["source"]["scopeSnapshot"]["objectKey"] == ("work-state/v1/scopes/9.json")
    assert [model["key"] for model in manifest["models"]] == [
        f"version-1/{filename}" for filename in MODEL_FILES
    ]
    assert all(model["rows"] == 1 for model in manifest["models"])
    assert all(len(model["checksumSha256"]) == 64 for model in manifest["models"])

    with pytest.raises(DatasetError, match="already exists"):
        publish_manifest(
            tmp_path,
            "version-1",
            source_manifest_keys=["manifest"],
            source_watermark=9,
        )
    with pytest.raises(DatasetError, match="already exists"):
        ensure_new_version(tmp_path, "version-1")


@pytest.mark.parametrize("version", ["", "../escape", "Uppercase", "contains space"])
def test_rejects_unsafe_versions(tmp_path: Path, version: str) -> None:
    with pytest.raises(DatasetError, match="safe"):
        ensure_new_version(tmp_path, version)


def test_rejects_incomplete_publications(tmp_path: Path) -> None:
    ensure_new_version(tmp_path, "missing")
    with pytest.raises(DatasetError, match="source manifests"):
        publish_manifest(tmp_path, "missing", source_manifest_keys=[], source_watermark=0)
    with pytest.raises(DatasetError, match="missing model output"):
        publish_manifest(
            tmp_path,
            "missing",
            source_manifest_keys=["manifest"],
            source_watermark=1,
        )
    with pytest.raises(DatasetError, match="does not exist"):
        publish_manifest(
            tmp_path,
            "absent",
            source_manifest_keys=["manifest"],
            source_watermark=1,
        )
