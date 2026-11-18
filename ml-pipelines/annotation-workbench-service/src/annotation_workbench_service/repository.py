from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from .contracts import Asset, ReviewBundle, ReviewEvent, ReviewSession


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class ReviewRepository:
    def __init__(self, bundle_path: Path, events_path: Path | None = None) -> None:
        self.bundle_path = bundle_path.resolve()
        self.root = self.bundle_path.parent
        self.events_path = (events_path or self.root / "reviews" / "events.jsonl").resolve()
        self.bundle = ReviewBundle.model_validate_json(self.bundle_path.read_text(encoding="utf-8"))
        self._assets = {asset.id: asset for asset in self.bundle.assets}
        self._items = {item.id: item for item in self.bundle.items}
        self._verify_assets()
        self._validate_events(self.read_events())

    def _asset_path(self, asset: Asset) -> Path:
        path = (self.root / asset.path).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"asset {asset.id} escapes the bundle root")
        return path

    def _verify_assets(self) -> None:
        for asset in self.bundle.assets:
            path = self._asset_path(asset)
            if not path.is_file():
                raise ValueError(f"asset {asset.id} is missing")
            if _sha256(path) != asset.sha256:
                raise ValueError(f"asset {asset.id} differs from its pinned digest")

    def resolve_asset(self, asset_id: str) -> tuple[Path, str]:
        asset = self._assets.get(asset_id)
        if asset is None:
            raise KeyError(asset_id)
        return self._asset_path(asset), asset.media_type

    def read_events(self) -> list[ReviewEvent]:
        if not self.events_path.exists():
            return []
        return [
            ReviewEvent.model_validate_json(line)
            for line in self.events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def _validate_events(self, events: list[ReviewEvent]) -> None:
        seen: set[str] = set()
        latest: dict[tuple[str, str], ReviewEvent] = {}
        for event in events:
            event_id = str(event.event_id)
            if event_id in seen:
                raise ValueError(f"duplicate review event {event_id}")
            seen.add(event_id)
            if event.batch_id != self.bundle.batch_id:
                raise ValueError(f"review event {event_id} belongs to another batch")
            item = self._items.get(event.item_id)
            if item is None:
                raise ValueError(f"review event {event_id} references an unknown item")
            proposal_ids = {proposal.id for proposal in item.proposals}
            if event.selected_proposal_id not in proposal_ids | {None}:
                raise ValueError(f"review event {event_id} selects an unknown proposal")
            key = (event.item_id, event.reviewer_id)
            previous = latest.get(key)
            expected = previous.event_id if previous else None
            if event.supersedes_event_id != expected:
                raise ValueError(f"review event {event_id} does not supersede the latest review")
            latest[key] = event

    def session(self) -> ReviewSession:
        latest: dict[tuple[str, str], ReviewEvent] = {}
        for event in self.read_events():
            latest[(event.item_id, event.reviewer_id)] = event
        return ReviewSession(bundle=self.bundle, latest_reviews=tuple(latest.values()))

    def append(self, event: ReviewEvent) -> ReviewEvent:
        self.events_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.events_path, os.O_APPEND | os.O_CREAT | os.O_RDWR, 0o600)
        try:
            with os.fdopen(descriptor, "r+", encoding="utf-8") as target:
                fcntl.flock(target.fileno(), fcntl.LOCK_EX)
                target.seek(0)
                events = [
                    ReviewEvent.model_validate_json(line)
                    for line in target.read().splitlines()
                    if line.strip()
                ]
                self._validate_events([*events, event])
                target.seek(0, os.SEEK_END)
                target.write(_canonical_json(event.model_dump(mode="json")) + "\n")
                target.flush()
                os.fsync(target.fileno())
                fcntl.flock(target.fileno(), fcntl.LOCK_UN)
        except Exception:
            if not self.events_path.exists():
                raise
            raise
        return event
