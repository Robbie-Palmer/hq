from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from work_graph_analytics.manifest import DatasetError, stage_dataset

FIXTURE = Path(__file__).parents[1] / "fixtures/raw"


def copied_fixture(tmp_path: Path) -> Path:
    destination = tmp_path / "raw"
    shutil.copytree(FIXTURE, destination)
    return destination


def rewrite_descriptor(root: Path, manifest_name: str, object_kind: str, body: bytes) -> None:
    path = root / f"work-state/v1/manifests/{manifest_name}"
    manifest = json.loads(path.read_text())
    descriptor = manifest[object_kind]
    object_path = root / descriptor["key"]
    object_path.write_bytes(body)
    descriptor["bytes"] = len(body)
    descriptor["checksumSha256"] = hashlib.sha256(body).hexdigest()
    path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")))


def test_stages_complete_manifest_chain_deterministically(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    expected = {"manifests": 2, "events": 14, "scopes": 10, "watermark": 14}

    assert stage_dataset(FIXTURE, first).model_dump() == expected
    assert stage_dataset(FIXTURE, second).model_dump() == expected
    assert sorted(path.name for path in first.iterdir()) == [
        "events.ndjson",
        "manifests.ndjson",
        "scopes.ndjson",
    ]
    for path in first.iterdir():
        assert path.read_bytes() == (second / path.name).read_bytes()


def test_rejects_checksum_mismatch(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    event_path = root / "work-state/v1/events/1-9.ndjson"
    event_path.write_text(event_path.read_text() + "{}\n")

    with pytest.raises(DatasetError, match="byte count mismatch"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_private_or_unknown_event_fields(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    event_path = root / "work-state/v1/events/1-9.ndjson"
    rows = event_path.read_text().splitlines()
    event = json.loads(rows[0])
    event["data"]["question"] = "private text"
    rows[0] = json.dumps(event, sort_keys=True, separators=(",", ":"))
    rewrite_descriptor(root, "1-9.json", "eventObject", ("\n".join(rows) + "\n").encode())

    with pytest.raises(DatasetError, match="violates its schema"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_incomplete_manifest_chain(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    (root / "work-state/v1/manifests/1-9.json").unlink()

    with pytest.raises(DatasetError, match="not contiguous"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_scope_count_mismatch(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    scope_path = root / "work-state/v1/scopes/14.json"
    scope = json.loads(scope_path.read_text())
    scope["rows"].pop()
    rewrite_descriptor(
        root,
        "10-14.json",
        "scopeObject",
        json.dumps(scope, sort_keys=True, separators=(",", ":")).encode(),
    )

    with pytest.raises(DatasetError, match="row count mismatch"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_unreadable_manifest_json(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    (root / "work-state/v1/manifests/1-9.json").write_text("not-json")

    with pytest.raises(DatasetError, match="violates its schema"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_invalid_event_ndjson(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    rewrite_descriptor(root, "1-9.json", "eventObject", b"not-json\n")

    with pytest.raises(DatasetError, match="violates its schema"):
        stage_dataset(root, tmp_path / "staged")


def test_rejects_manifest_object_path_traversal(tmp_path: Path) -> None:
    root = copied_fixture(tmp_path)
    path = root / "work-state/v1/manifests/1-9.json"
    manifest = json.loads(path.read_text())
    manifest["eventObject"]["key"] = "work-state/v1/events/../../outside.ndjson"
    path.write_text(json.dumps(manifest, sort_keys=True, separators=(",", ":")))

    with pytest.raises(DatasetError, match="must start"):
        stage_dataset(root, tmp_path / "staged")
