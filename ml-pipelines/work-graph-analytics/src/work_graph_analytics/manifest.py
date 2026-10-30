from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any

EVENT_TYPES = frozenset(
    {
        "attention.requested",
        "attention.resolved",
        "dependency.added",
        "dependency.removed",
        "context.put",
        "knowledge_scope.put",
        "knowledge_scope.archived",
        "knowledge_scope.restored",
        "knowledge_scope_relationship.added",
        "knowledge_scope_relationship.removed",
        "reference.put",
        "pull_request.linked",
        "pull_request.refreshed",
        "lease.claimed",
        "lease.ended",
        "lease.renewed",
        "note.created",
        "work_item.created",
        "work_item.decomposed",
        "work_item.expedited",
        "work_item.priority_moved",
        "work_item.lifecycle_changed",
        "work_item.reparented",
        "work_item.scheduling_scope_changed",
        "work_item.unexpedited",
        "knowledge_scope.priority_moved",
    }
)
ATTENTION_KINDS = frozenset(
    {
        "decision",
        "ambiguity",
        "authority",
        "access",
        "failure",
        "review",
        "approval",
        "scope",
        "other",
    }
)
LEASE_OUTCOMES = frozenset(
    {"released", "cancelled", "decomposed", "attention_requested", "expired"}
)
HEX_CHARS = frozenset("0123456789abcdef")


class DatasetError(ValueError):
    """The raw analytics dataset is incomplete or violates its schema."""


@dataclass(frozen=True)
class Descriptor:
    key: str
    rows: int
    size: int
    checksum: str
    schema_version: int


@dataclass(frozen=True)
class Manifest:
    key: str
    batch_id: str
    start: int
    end: int
    source_upper_watermark: int
    event: Descriptor
    scope: Descriptor


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DatasetError(f"{label} must be a JSON object")
    return value


def _integer(value: Any, label: str, *, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise DatasetError(f"{label} must be an integer greater than or equal to {minimum}")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise DatasetError(f"{label} must be a non-empty string")
    return value


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise DatasetError(f"{label} has unknown or missing fields")


def _timestamp(value: Any, label: str) -> str:
    text = _string(value, label)
    try:
        datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise DatasetError(f"{label} must be an ISO-8601 timestamp") from error
    return text


def _descriptor(value: Any, label: str, prefix: str) -> Descriptor:
    raw = _object(value, label)
    _exact_keys(raw, {"key", "rows", "bytes", "checksumSha256", "schemaVersion"}, label)
    key = _string(raw["key"], f"{label}.key")
    checksum = _string(raw["checksumSha256"], f"{label}.checksumSha256")
    object_key = PurePosixPath(key)
    if not key.startswith(prefix) or object_key.is_absolute() or ".." in object_key.parts:
        raise DatasetError(f"{label}.key must start with {prefix}")
    if len(checksum) != 64 or not set(checksum) <= HEX_CHARS:
        raise DatasetError(f"{label}.checksumSha256 must be lowercase SHA-256")
    schema_version = _integer(raw["schemaVersion"], f"{label}.schemaVersion", minimum=1)
    if schema_version != 1:
        raise DatasetError(f"{label}.schemaVersion is unsupported")
    return Descriptor(
        key=key,
        rows=_integer(raw["rows"], f"{label}.rows"),
        size=_integer(raw["bytes"], f"{label}.bytes"),
        checksum=checksum,
        schema_version=schema_version,
    )


def _parse_manifest(path: Path, root: Path) -> Manifest:
    try:
        raw = _object(json.loads(path.read_text()), path.as_posix())
    except (json.JSONDecodeError, OSError) as error:
        raise DatasetError(f"cannot read manifest {path}") from error
    _exact_keys(
        raw,
        {
            "batchId",
            "manifestSchemaVersion",
            "complete",
            "fromSequenceExclusive",
            "throughSequence",
            "sourceUpperWatermark",
            "eventObject",
            "scopeObject",
        },
        path.as_posix(),
    )
    if raw["manifestSchemaVersion"] != 1 or raw["complete"] is not True:
        raise DatasetError(f"manifest {path} is incomplete or unsupported")
    start = _integer(raw["fromSequenceExclusive"], "fromSequenceExclusive")
    end = _integer(raw["throughSequence"], "throughSequence", minimum=1)
    upper = _integer(raw["sourceUpperWatermark"], "sourceUpperWatermark", minimum=1)
    batch_id = _string(raw["batchId"], "batchId")
    if end <= start or upper < end or batch_id != f"{start + 1}-{end}":
        raise DatasetError(f"manifest {path} has an invalid sequence range")
    return Manifest(
        key=path.relative_to(root).as_posix(),
        batch_id=batch_id,
        start=start,
        end=end,
        source_upper_watermark=upper,
        event=_descriptor(raw["eventObject"], "eventObject", "work-state/v1/events/"),
        scope=_descriptor(raw["scopeObject"], "scopeObject", "work-state/v1/scopes/"),
    )


def _verified_bytes(root: Path, descriptor: Descriptor) -> bytes:
    resolved_root = root.resolve()
    path = (resolved_root / descriptor.key).resolve()
    if not path.is_relative_to(resolved_root):
        raise DatasetError(f"manifest-listed object escapes the raw root: {descriptor.key}")
    try:
        body = path.read_bytes()
    except OSError as error:
        raise DatasetError(f"cannot read manifest-listed object {descriptor.key}") from error
    if len(body) != descriptor.size:
        raise DatasetError(f"byte count mismatch for {descriptor.key}")
    if hashlib.sha256(body).hexdigest() != descriptor.checksum:
        raise DatasetError(f"checksum mismatch for {descriptor.key}")
    return body


def _event_data(event_type: str, value: Any, label: str) -> dict[str, Any]:
    data = _object(value, label)
    expected: set[str]
    if event_type == "attention.requested":
        expected = {"attentionRequestId", "kind", "blocking"}
        _string(data.get("attentionRequestId"), f"{label}.attentionRequestId")
        if data.get("kind") not in ATTENTION_KINDS or not isinstance(data.get("blocking"), bool):
            raise DatasetError(f"{label} has an invalid attention request")
    elif event_type == "attention.resolved":
        expected = {"attentionRequestId"}
        _string(data.get("attentionRequestId"), f"{label}.attentionRequestId")
    elif event_type in {"lease.claimed", "lease.renewed"}:
        expected = {"leaseId", "expiresAt"}
        _string(data.get("leaseId"), f"{label}.leaseId")
        _timestamp(data.get("expiresAt"), f"{label}.expiresAt")
    elif event_type == "lease.ended":
        expected = {"leaseId", "outcome"}
        _string(data.get("leaseId"), f"{label}.leaseId")
        if data.get("outcome") not in LEASE_OUTCOMES:
            raise DatasetError(f"{label}.outcome is invalid")
    elif event_type == "note.created":
        expected = {"leaseId", "kind"}
        lease_id = data.get("leaseId")
        if lease_id is not None and (not isinstance(lease_id, str) or not lease_id):
            raise DatasetError(f"{label}.leaseId is invalid")
        if data.get("kind") not in {"work", "post_release"}:
            raise DatasetError(f"{label}.kind is invalid")
    else:
        expected = set()
    _exact_keys(data, expected, label)
    return data


def _events(root: Path, manifest: Manifest) -> list[dict[str, Any]]:
    body = _verified_bytes(root, manifest.event)
    rows: list[dict[str, Any]] = []
    previous = manifest.start
    for line_number, line in enumerate(body.splitlines(), start=1):
        try:
            event = _object(json.loads(line), f"{manifest.event.key}:{line_number}")
        except json.JSONDecodeError as error:
            raise DatasetError(f"invalid NDJSON at {manifest.event.key}:{line_number}") from error
        label = f"{manifest.event.key}:{line_number}"
        _exact_keys(
            event, {"schemaVersion", "sequence", "type", "workItemId", "occurredAt", "data"}, label
        )
        if event["schemaVersion"] != 1:
            raise DatasetError(f"{label} has an unsupported schema")
        sequence = _integer(event["sequence"], f"{label}.sequence", minimum=1)
        event_type = _string(event["type"], f"{label}.type")
        work_item_id = _string(event["workItemId"], f"{label}.workItemId")
        occurred_at = _timestamp(event["occurredAt"], f"{label}.occurredAt")
        if event_type not in EVENT_TYPES or sequence <= previous or sequence > manifest.end:
            raise DatasetError(f"{label} has an invalid type or sequence")
        previous = sequence
        data = _event_data(event_type, event["data"], f"{label}.data")
        rows.append(
            {
                "schema_version": 1,
                "sequence": sequence,
                "event_type": event_type,
                "work_item_id": work_item_id,
                "occurred_at": occurred_at,
                "attention_request_id": data.get("attentionRequestId"),
                "attention_kind": data.get("kind") if event_type == "attention.requested" else None,
                "blocking": data.get("blocking"),
                "lease_id": data.get("leaseId"),
                "lease_expires_at": data.get("expiresAt"),
                "lease_outcome": data.get("outcome"),
                "note_kind": data.get("kind") if event_type == "note.created" else None,
                "manifest_key": manifest.key,
                "source_upper_watermark": manifest.source_upper_watermark,
            }
        )
    if len(rows) != manifest.event.rows or not rows or rows[-1]["sequence"] != manifest.end:
        raise DatasetError(f"row count or terminal sequence mismatch for {manifest.event.key}")
    return rows


def _scopes(root: Path, manifest: Manifest) -> tuple[list[dict[str, Any]], str]:
    body = _verified_bytes(root, manifest.scope)
    try:
        document = _object(json.loads(body), manifest.scope.key)
    except json.JSONDecodeError as error:
        raise DatasetError(f"invalid JSON in {manifest.scope.key}") from error
    _exact_keys(
        document,
        {"schemaVersion", "capturedAt", "eventWatermark", "scopeBasis", "rows"},
        manifest.scope.key,
    )
    if (
        document["schemaVersion"] != 1
        or document["eventWatermark"] != manifest.end
        or document["scopeBasis"] != "current_assignment"
        or not isinstance(document["rows"], list)
    ):
        raise DatasetError(f"scope metadata mismatch for {manifest.scope.key}")
    captured_at = _timestamp(document["capturedAt"], f"{manifest.scope.key}.capturedAt")
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, value in enumerate(document["rows"]):
        scope = _object(value, f"{manifest.scope.key}.rows[{index}]")
        _exact_keys(
            scope,
            {"workItemId", "projectId", "initiativeId"},
            f"{manifest.scope.key}.rows[{index}]",
        )
        work_item_id = _string(scope["workItemId"], "workItemId")
        if work_item_id in seen:
            raise DatasetError(f"duplicate scope identity {work_item_id} in {manifest.scope.key}")
        seen.add(work_item_id)
        for field in ("projectId", "initiativeId"):
            if scope[field] is not None and (not isinstance(scope[field], str) or not scope[field]):
                raise DatasetError(f"{field} is invalid in {manifest.scope.key}")
        rows.append(
            {
                "work_item_id": work_item_id,
                "project_id": scope["projectId"],
                "initiative_id": scope["initiativeId"],
                "captured_at": captured_at,
                "event_watermark": manifest.end,
                "manifest_key": manifest.key,
                "scope_object_key": manifest.scope.key,
            }
        )
    if len(rows) != manifest.scope.rows:
        raise DatasetError(f"row count mismatch for {manifest.scope.key}")
    return rows, captured_at


def _write_ndjson(path: Path, rows: list[dict[str, Any]]) -> None:
    body = "".join(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n" for row in rows)
    path.write_text(body)


def stage_dataset(raw_root: Path, staging_root: Path) -> dict[str, int]:
    manifest_paths = list((raw_root / "work-state/v1/manifests").glob("*.json"))
    if not manifest_paths:
        raise DatasetError("the raw dataset contains no manifests")
    manifests = sorted(
        (_parse_manifest(path, raw_root) for path in manifest_paths), key=lambda item: item.start
    )
    events: list[dict[str, Any]] = []
    scopes: list[dict[str, Any]] = []
    manifest_rows: list[dict[str, Any]] = []
    expected_start = 0
    for manifest in manifests:
        if manifest.start != expected_start:
            raise DatasetError("manifest sequence coverage is not contiguous")
        batch_events = _events(raw_root, manifest)
        batch_scopes, captured_at = _scopes(raw_root, manifest)
        events.extend(batch_events)
        scopes.extend(batch_scopes)
        manifest_rows.append(
            {
                "manifest_key": manifest.key,
                "manifest_schema_version": 1,
                "batch_id": manifest.batch_id,
                "from_sequence_exclusive": manifest.start,
                "through_sequence": manifest.end,
                "source_upper_watermark": manifest.source_upper_watermark,
                "captured_at": captured_at,
                "event_object_key": manifest.event.key,
                "event_rows": manifest.event.rows,
                "event_checksum_sha256": manifest.event.checksum,
                "scope_object_key": manifest.scope.key,
                "scope_rows": manifest.scope.rows,
                "scope_checksum_sha256": manifest.scope.checksum,
            }
        )
        expected_start = manifest.end
    staging_root.mkdir(parents=True, exist_ok=True)
    _write_ndjson(staging_root / "events.ndjson", events)
    _write_ndjson(staging_root / "scopes.ndjson", scopes)
    _write_ndjson(staging_root / "manifests.ndjson", manifest_rows)
    return {
        "manifests": len(manifests),
        "events": len(events),
        "scopes": len(scopes),
        "watermark": expected_start,
    }
