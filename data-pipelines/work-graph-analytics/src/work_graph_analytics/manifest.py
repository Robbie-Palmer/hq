from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

ATTENTION_REQUESTED_EVENT = "attention.requested"
NOTE_CREATED_EVENT = "note.created"
EVENT_TYPES = frozenset(
    {
        ATTENTION_REQUESTED_EVENT,
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
        NOTE_CREATED_EVENT,
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


class DatasetError(ValueError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, populate_by_name=True)


def _timestamp(value: str) -> str:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("must be an ISO-8601 timestamp") from error
    return value


NonEmptyString = Annotated[str, Field(min_length=1)]
Timestamp = Annotated[NonEmptyString, AfterValidator(_timestamp)]
Checksum = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class Descriptor(StrictModel):
    key: NonEmptyString
    rows: int = Field(ge=0)
    size: int = Field(validation_alias="bytes", ge=0)
    checksum: Checksum = Field(validation_alias="checksumSha256")
    schema_version: Literal[1] = Field(validation_alias="schemaVersion")


class RawManifest(StrictModel):
    batch_id: NonEmptyString = Field(validation_alias="batchId")
    manifest_schema_version: Literal[1] = Field(validation_alias="manifestSchemaVersion")
    complete: Literal[True]
    start: int = Field(validation_alias="fromSequenceExclusive", ge=0)
    end: int = Field(validation_alias="throughSequence", ge=1)
    source_upper_watermark: int = Field(validation_alias="sourceUpperWatermark", ge=1)
    event: Descriptor = Field(validation_alias="eventObject")
    scope: Descriptor = Field(validation_alias="scopeObject")

    @model_validator(mode="after")
    def validate_sequence_range(self) -> RawManifest:
        if (
            self.end <= self.start
            or self.source_upper_watermark < self.end
            or self.batch_id != f"{self.start + 1}-{self.end}"
        ):
            raise ValueError("invalid sequence range")
        return self


class Manifest(StrictModel):
    key: NonEmptyString
    batch_id: NonEmptyString
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    source_upper_watermark: int = Field(ge=1)
    event: Descriptor
    scope: Descriptor


class EmptyEventData(StrictModel):
    pass


class AttentionRequestedData(StrictModel):
    attention_request_id: NonEmptyString = Field(validation_alias="attentionRequestId")
    kind: Literal[
        "decision",
        "ambiguity",
        "authority",
        "access",
        "failure",
        "review",
        "approval",
        "scope",
        "other",
    ]
    blocking: bool


class AttentionResolvedData(StrictModel):
    attention_request_id: NonEmptyString = Field(validation_alias="attentionRequestId")


class LeaseData(StrictModel):
    lease_id: NonEmptyString = Field(validation_alias="leaseId")
    expires_at: Timestamp = Field(validation_alias="expiresAt")


class EndedLeaseData(StrictModel):
    lease_id: NonEmptyString = Field(validation_alias="leaseId")
    outcome: Literal["released", "cancelled", "decomposed", "attention_requested", "expired"]


class NoteData(StrictModel):
    lease_id: NonEmptyString | None = Field(validation_alias="leaseId")
    kind: Literal["work", "post_release"]


EventData = (
    EmptyEventData
    | AttentionRequestedData
    | AttentionResolvedData
    | LeaseData
    | EndedLeaseData
    | NoteData
)


class EventEnvelope(StrictModel):
    schema_version: Literal[1] = Field(validation_alias="schemaVersion")
    sequence: int = Field(ge=1)
    event_type: NonEmptyString = Field(validation_alias="type")
    work_item_id: NonEmptyString = Field(validation_alias="workItemId")
    occurred_at: Timestamp = Field(validation_alias="occurredAt")
    data: dict[str, Any]

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, value: str) -> str:
        if value not in EVENT_TYPES:
            raise ValueError("unsupported event type")
        return value


class ScopeRow(StrictModel):
    work_item_id: NonEmptyString = Field(validation_alias="workItemId")
    project_id: NonEmptyString | None = Field(validation_alias="projectId")
    initiative_id: NonEmptyString | None = Field(validation_alias="initiativeId")


class ScopeDocument(StrictModel):
    schema_version: Literal[1] = Field(validation_alias="schemaVersion")
    captured_at: Timestamp = Field(validation_alias="capturedAt")
    event_watermark: int = Field(validation_alias="eventWatermark", ge=1)
    scope_basis: Literal["current_assignment"] = Field(validation_alias="scopeBasis")
    rows: list[ScopeRow]


class StagedEvent(StrictModel):
    schema_version: Literal[1] = 1
    sequence: int = Field(ge=1)
    event_type: NonEmptyString
    work_item_id: NonEmptyString
    occurred_at: Timestamp
    attention_request_id: NonEmptyString | None = None
    attention_kind: NonEmptyString | None = None
    blocking: bool | None = None
    lease_id: NonEmptyString | None = None
    lease_expires_at: Timestamp | None = None
    lease_outcome: NonEmptyString | None = None
    note_kind: NonEmptyString | None = None
    manifest_key: NonEmptyString
    source_upper_watermark: int = Field(ge=1)


class StagedScope(StrictModel):
    work_item_id: NonEmptyString
    project_id: NonEmptyString | None
    initiative_id: NonEmptyString | None
    captured_at: Timestamp
    event_watermark: int = Field(ge=1)
    manifest_key: NonEmptyString
    scope_object_key: NonEmptyString


class StagedManifest(StrictModel):
    manifest_key: NonEmptyString
    manifest_schema_version: Literal[1] = 1
    batch_id: NonEmptyString
    from_sequence_exclusive: int = Field(ge=0)
    through_sequence: int = Field(ge=1)
    source_upper_watermark: int = Field(ge=1)
    captured_at: Timestamp
    event_object_key: NonEmptyString
    event_rows: int = Field(ge=0)
    event_checksum_sha256: Checksum
    scope_object_key: NonEmptyString
    scope_rows: int = Field(ge=0)
    scope_checksum_sha256: Checksum


class StageSummary(StrictModel):
    manifests: int = Field(ge=1)
    events: int = Field(ge=1)
    scopes: int = Field(ge=0)
    watermark: int = Field(ge=1)


def _validated[ModelType: BaseModel](model: type[ModelType], value: Any, label: str) -> ModelType:
    try:
        return model.model_validate(value)
    except ValidationError as error:
        raise DatasetError(f"{label} violates its schema: {error}") from error


def _validated_json[ModelType: BaseModel](
    model: type[ModelType], value: str | bytes, label: str
) -> ModelType:
    try:
        return model.model_validate_json(value)
    except ValidationError as error:
        raise DatasetError(f"{label} violates its schema: {error}") from error


def _validate_object_key(descriptor: Descriptor, prefix: str, label: str) -> None:
    object_key = PurePosixPath(descriptor.key)
    if (
        not descriptor.key.startswith(prefix)
        or object_key.is_absolute()
        or ".." in object_key.parts
    ):
        raise DatasetError(f"{label}.key must start with {prefix} and stay within it")


def _parse_manifest(path: Path, root: Path) -> Manifest:
    try:
        body = path.read_bytes()
    except OSError as error:
        raise DatasetError(f"cannot read manifest {path}") from error
    raw = _validated_json(RawManifest, body, path.as_posix())
    _validate_object_key(raw.event, "work-state/v1/events/", "eventObject")
    _validate_object_key(raw.scope, "work-state/v1/scopes/", "scopeObject")
    return Manifest(
        key=path.relative_to(root).as_posix(),
        batch_id=raw.batch_id,
        start=raw.start,
        end=raw.end,
        source_upper_watermark=raw.source_upper_watermark,
        event=raw.event,
        scope=raw.scope,
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


def _event_data(event_type: str, value: dict[str, Any], label: str) -> EventData:
    model: type[EventData]
    if event_type == ATTENTION_REQUESTED_EVENT:
        model = AttentionRequestedData
    elif event_type == "attention.resolved":
        model = AttentionResolvedData
    elif event_type in {"lease.claimed", "lease.renewed"}:
        model = LeaseData
    elif event_type == "lease.ended":
        model = EndedLeaseData
    elif event_type == NOTE_CREATED_EVENT:
        model = NoteData
    else:
        model = EmptyEventData
    return _validated(model, value, label)


def _events(root: Path, manifest: Manifest) -> list[StagedEvent]:
    body = _verified_bytes(root, manifest.event)
    rows: list[StagedEvent] = []
    previous = manifest.start
    for line_number, line in enumerate(body.splitlines(), start=1):
        label = f"{manifest.event.key}:{line_number}"
        event = _validated_json(EventEnvelope, line, label)
        if event.sequence <= previous or event.sequence > manifest.end:
            raise DatasetError(f"{label} has an invalid sequence")
        previous = event.sequence
        data = _event_data(event.event_type, event.data, f"{label}.data")
        values = data.model_dump()
        rows.append(
            StagedEvent(
                sequence=event.sequence,
                event_type=event.event_type,
                work_item_id=event.work_item_id,
                occurred_at=event.occurred_at,
                attention_request_id=values.get("attention_request_id"),
                attention_kind=(
                    values.get("kind") if event.event_type == ATTENTION_REQUESTED_EVENT else None
                ),
                blocking=values.get("blocking"),
                lease_id=values.get("lease_id"),
                lease_expires_at=values.get("expires_at"),
                lease_outcome=values.get("outcome"),
                note_kind=values.get("kind") if event.event_type == NOTE_CREATED_EVENT else None,
                manifest_key=manifest.key,
                source_upper_watermark=manifest.source_upper_watermark,
            )
        )
    if len(rows) != manifest.event.rows or not rows or rows[-1].sequence != manifest.end:
        raise DatasetError(f"row count or terminal sequence mismatch for {manifest.event.key}")
    return rows


def _scopes(root: Path, manifest: Manifest) -> tuple[list[StagedScope], str]:
    body = _verified_bytes(root, manifest.scope)
    document = _validated_json(ScopeDocument, body, manifest.scope.key)
    if document.event_watermark != manifest.end:
        raise DatasetError(f"scope metadata mismatch for {manifest.scope.key}")
    rows: list[StagedScope] = []
    seen: set[str] = set()
    for scope in document.rows:
        if scope.work_item_id in seen:
            raise DatasetError(
                f"duplicate scope identity {scope.work_item_id} in {manifest.scope.key}"
            )
        seen.add(scope.work_item_id)
        rows.append(
            StagedScope(
                work_item_id=scope.work_item_id,
                project_id=scope.project_id,
                initiative_id=scope.initiative_id,
                captured_at=document.captured_at,
                event_watermark=manifest.end,
                manifest_key=manifest.key,
                scope_object_key=manifest.scope.key,
            )
        )
    if len(rows) != manifest.scope.rows:
        raise DatasetError(f"row count mismatch for {manifest.scope.key}")
    return rows, document.captured_at


def _write_ndjson(path: Path, rows: list[StrictModel]) -> None:
    body = "".join(row.model_dump_json() + "\n" for row in rows)
    path.write_text(body)


def stage_dataset(raw_root: Path, staging_root: Path) -> StageSummary:
    manifest_paths = list((raw_root / "work-state/v1/manifests").glob("*.json"))
    if not manifest_paths:
        raise DatasetError("the raw dataset contains no manifests")
    manifests = sorted(
        (_parse_manifest(path, raw_root) for path in manifest_paths), key=lambda item: item.start
    )
    events: list[StagedEvent] = []
    scopes: list[StagedScope] = []
    manifest_rows: list[StagedManifest] = []
    expected_start = 0
    for manifest in manifests:
        if manifest.start != expected_start:
            raise DatasetError("manifest sequence coverage is not contiguous")
        batch_events = _events(raw_root, manifest)
        batch_scopes, captured_at = _scopes(raw_root, manifest)
        events.extend(batch_events)
        scopes.extend(batch_scopes)
        manifest_rows.append(
            StagedManifest(
                manifest_key=manifest.key,
                batch_id=manifest.batch_id,
                from_sequence_exclusive=manifest.start,
                through_sequence=manifest.end,
                source_upper_watermark=manifest.source_upper_watermark,
                captured_at=captured_at,
                event_object_key=manifest.event.key,
                event_rows=manifest.event.rows,
                event_checksum_sha256=manifest.event.checksum,
                scope_object_key=manifest.scope.key,
                scope_rows=manifest.scope.rows,
                scope_checksum_sha256=manifest.scope.checksum,
            )
        )
        expected_start = manifest.end
    staging_root.mkdir(parents=True, exist_ok=True)
    _write_ndjson(staging_root / "events.ndjson", events)
    _write_ndjson(staging_root / "scopes.ndjson", scopes)
    _write_ndjson(staging_root / "manifests.ndjson", manifest_rows)
    return StageSummary(
        manifests=len(manifests),
        events=len(events),
        scopes=len(scopes),
        watermark=expected_start,
    )
