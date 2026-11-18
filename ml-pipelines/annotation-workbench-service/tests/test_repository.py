from __future__ import annotations

import fcntl
import hashlib
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest

import annotation_workbench_service.repository as repository_module
from annotation_workbench_service.contracts import ReviewBundle, ReviewEvent
from annotation_workbench_service.repository import ReviewRepository

PNG = b"\x89PNG\r\n\x1a\nsynthetic"


def _bundle(root: Path) -> Path:
    assets = root / "assets"
    assets.mkdir(parents=True)
    (assets / "source.png").write_bytes(PNG)
    (assets / "cellsam.png").write_bytes(PNG + b"cellsam")
    values = {
        "schema_version": "1.0.0",
        "batch_id": "synthetic-batch",
        "created_at": "2026-11-10T00:00:00Z",
        "provenance": {
            "producer": "test-adapter",
            "producer_version": "1",
            "producer_revision": "a" * 64,
            "dataset_id": "synthetic",
            "dataset_revision": "fixture-1",
            "derivation": "Synthetic test fixture",
        },
        "assets": [
            {
                "id": "source:item-1",
                "kind": "source",
                "path": "assets/source.png",
                "media_type": "image/png",
                "sha256": hashlib.sha256(PNG).hexdigest(),
                "width": 32,
                "height": 32,
            },
            {
                "id": "proposal:item-1:cellsam",
                "kind": "proposal",
                "path": "assets/cellsam.png",
                "media_type": "image/png",
                "sha256": hashlib.sha256(PNG + b"cellsam").hexdigest(),
                "width": 32,
                "height": 32,
            },
        ],
        "items": [
            {
                "id": "item-1",
                "source_asset_id": "source:item-1",
                "proposals": [
                    {
                        "id": "item-1:cellsam",
                        "asset_id": "proposal:item-1:cellsam",
                        "role": "primary",
                        "model_name": "CellSAM general",
                        "model_revision": "v1.2",
                        "model_license": "Modified-Apache-2.0-NonCommercial",
                        "source_box_clipped": True,
                    }
                ],
                "context": {
                    "dataset_id": "synthetic",
                    "source_item_id": "image-1",
                    "source_annotation_id": "box-1",
                    "split": "train",
                    "site_id": "fixture",
                    "class_name": "nucleus",
                    "bbox_xyxy": [4, 5, 20, 22],
                    "coordinate_space": "pixel_xyxy_inclusive",
                },
            }
        ],
    }
    path = root / "bundle.json"
    path.write_text(json.dumps(values), encoding="utf-8")
    return path


def _event(**changes: object) -> ReviewEvent:
    values: dict[str, object] = {
        "schema_version": "1.0.0",
        "event_id": "11111111-1111-4111-8111-111111111111",
        "batch_id": "synthetic-batch",
        "item_id": "item-1",
        "reviewer_id": "reviewer-a",
        "reviewer_kind": "human",
        "created_at": datetime(2026, 11, 10, tzinfo=UTC),
        "object_decision": "valid_nucleus",
        "mask_decision": "accept",
        "selected_proposal_id": "item-1:cellsam",
    }
    values.update(changes)
    return ReviewEvent.model_validate(values)


def test_bundle_rejects_escaping_asset_path(tmp_path: Path) -> None:
    path = _bundle(tmp_path)
    values = json.loads(path.read_text(encoding="utf-8"))
    values["assets"][0]["path"] = "../source.png"

    with pytest.raises(ValueError, match="confined relative"):
        ReviewBundle.model_validate(values)


@pytest.mark.parametrize(
    ("asset_index", "kind", "message"),
    [
        (0, "proposal", "source asset must have kind source"),
        (1, "source", "asset must have kind proposal"),
    ],
)
def test_bundle_rejects_asset_role_mismatches(
    tmp_path: Path,
    asset_index: int,
    kind: str,
    message: str,
) -> None:
    path = _bundle(tmp_path)
    values = json.loads(path.read_text(encoding="utf-8"))
    values["assets"][asset_index]["kind"] = kind

    with pytest.raises(ValueError, match=message):
        ReviewBundle.model_validate(values)


def test_bundle_rejects_reference_asset_role_mismatch(tmp_path: Path) -> None:
    path = _bundle(tmp_path)
    values = json.loads(path.read_text(encoding="utf-8"))
    reference = values["assets"][0] | {
        "id": "reference:item-1",
        "kind": "source",
    }
    values["assets"].append(reference)
    values["items"][0]["reference_asset_id"] = reference["id"]

    with pytest.raises(ValueError, match="reference asset must have kind reference"):
        ReviewBundle.model_validate(values)


def test_review_decisions_keep_object_and_mask_states_coherent() -> None:
    with pytest.raises(ValueError, match="cannot receive a mask decision"):
        _event(object_decision="non_nucleus", mask_decision="accept")

    with pytest.raises(ValueError, match="require a selected proposal"):
        _event(selected_proposal_id=None)


def test_repository_verifies_assets_and_appends_revisions(tmp_path: Path) -> None:
    repository = ReviewRepository(_bundle(tmp_path))
    first = _event()
    repository.append(first)
    second = _event(
        event_id="22222222-2222-4222-8222-222222222222",
        supersedes_event_id=first.event_id,
        mask_decision="refine",
        notes="Boundary needs one correction.",
    )
    repository.append(second)

    session = repository.session()

    assert session.latest_reviews == (second,)
    assert len(repository.read_events()) == 2
    assert repository.resolve_asset("source:item-1")[1] == "image/png"


def test_repository_rejects_stale_and_unknown_reviews(tmp_path: Path) -> None:
    repository = ReviewRepository(_bundle(tmp_path))
    repository.append(_event())

    stale_event = _event(event_id="33333333-3333-4333-8333-333333333333")
    with pytest.raises(ValueError, match="does not supersede"):
        repository.append(stale_event)

    unknown_proposal_event = _event(
        event_id=UUID("44444444-4444-4444-8444-444444444444"),
        supersedes_event_id=UUID("11111111-1111-4111-8111-111111111111"),
        selected_proposal_id="item-1:missing",
    )
    with pytest.raises(ValueError, match="unknown proposal"):
        repository.append(unknown_proposal_event)


def test_repository_detects_changed_asset(tmp_path: Path) -> None:
    bundle = _bundle(tmp_path)
    (tmp_path / "assets/source.png").write_bytes(b"changed")

    with pytest.raises(ValueError, match="differs from its pinned digest"):
        ReviewRepository(bundle)


def test_repository_revalidates_events_written_after_startup(tmp_path: Path) -> None:
    repository = ReviewRepository(_bundle(tmp_path))
    repository.append(_event())
    invalid = _event(event_id="22222222-2222-4222-8222-222222222222")
    with repository.events_path.open("a", encoding="utf-8") as target:
        target.write(invalid.model_dump_json() + "\n")

    with pytest.raises(ValueError, match="does not supersede"):
        repository.session()


def test_repository_reader_waits_for_exclusive_writer_lock(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository = ReviewRepository(_bundle(tmp_path))
    event = repository.append(_event())
    shared_lock_attempted = threading.Event()
    real_flock = fcntl.flock

    def tracked_flock(descriptor: int, operation: int) -> None:
        if operation == fcntl.LOCK_SH:
            shared_lock_attempted.set()
        real_flock(descriptor, operation)

    descriptor = os.open(repository.events_path, os.O_RDONLY)
    with (
        os.fdopen(descriptor, encoding="utf-8") as writer,
        ThreadPoolExecutor(max_workers=1) as executor,
    ):
        real_flock(writer.fileno(), fcntl.LOCK_EX)
        try:
            monkeypatch.setattr(repository_module.fcntl, "flock", tracked_flock)
            read = executor.submit(repository.read_events)
            assert shared_lock_attempted.wait(timeout=1)
            with pytest.raises(FutureTimeoutError):
                read.result(timeout=0.05)
        finally:
            real_flock(writer.fileno(), fcntl.LOCK_UN)
        assert read.result(timeout=1) == [event]
