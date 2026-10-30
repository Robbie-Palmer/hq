from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import duckdb
from pydantic import Field, ValidationError

from work_graph_analytics.manifest import DatasetError, NonEmptyString, StrictModel
from work_graph_analytics.publication import (
    PublicationManifest,
    PublicationScopeSnapshot,
    PublishedModel,
)

REQUIRED_REPORT_MODELS = (
    "fct_events.parquet",
    "fct_scopes.parquet",
    "fct_tickets.parquet",
    "fct_wait_episodes.parquet",
)
INFERENCE_LIMITS = (
    "A missing work note is a failed-handoff proxy; it does not prove the handoff failed.",
    "An attention resolution does not prove that a human intervened.",
)


class ReportPeriod(StrictModel):
    start: NonEmptyString
    end: NonEmptyString


class ReportScope(StrictModel):
    basis: str = "current_assignment"
    project_id: str | None = Field(default=None, serialization_alias="projectId")
    initiative_id: str | None = Field(default=None, serialization_alias="initiativeId")


class ReportSourceCoverage(StrictModel):
    manifest_keys: list[NonEmptyString] = Field(serialization_alias="manifestKeys")
    through_sequence: int = Field(serialization_alias="throughSequence", ge=1)


class ReportScopeSnapshot(StrictModel):
    manifest_keys: list[NonEmptyString] = Field(serialization_alias="manifestKeys")
    object_keys: list[NonEmptyString] = Field(serialization_alias="objectKeys")
    captured_at: str | None = Field(serialization_alias="capturedAt")
    event_watermark: int = Field(serialization_alias="eventWatermark", ge=1)


class ReportFreshness(StrictModel):
    latest_event_at: str = Field(serialization_alias="latestEventAt")
    scope_captured_at: str | None = Field(serialization_alias="scopeCapturedAt")


class ReportProvenance(StrictModel):
    model_version: NonEmptyString = Field(serialization_alias="modelVersion")
    manifest_schema_version: int = Field(serialization_alias="manifestSchemaVersion")
    source_coverage: ReportSourceCoverage = Field(serialization_alias="sourceCoverage")
    scope_snapshot: ReportScopeSnapshot = Field(serialization_alias="scopeSnapshot")
    freshness: ReportFreshness


class ReportMetric(StrictModel):
    project_id: str | None = Field(serialization_alias="projectId")
    initiative_id: str | None = Field(serialization_alias="initiativeId")
    cause: NonEmptyString
    episodes: int = Field(ge=0)
    recurring_work_items: int = Field(serialization_alias="recurringWorkItems", ge=0)
    wait_milliseconds: int = Field(serialization_alias="waitMilliseconds", ge=0)
    open_at_end: int = Field(serialization_alias="openAtEnd", ge=0)
    intervention_requests: int = Field(serialization_alias="interventionRequests", ge=0)
    resolutions: int = Field(ge=0)
    stale_takeovers: int = Field(serialization_alias="staleTakeovers", ge=0)
    failed_handoff_proxies: int = Field(serialization_alias="failedHandoffProxies", ge=0)


class OperationalReport(StrictModel):
    report_schema_version: int = Field(default=1, serialization_alias="reportSchemaVersion")
    period: ReportPeriod
    scope: ReportScope
    provenance: ReportProvenance
    inference_limits: tuple[str, ...] = Field(serialization_alias="inferenceLimits")
    metrics: list[ReportMetric]


def _timestamp(value: str, label: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise DatasetError(f"{label} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise DatasetError(f"{label} must include a timezone")
    return parsed.astimezone(UTC)


def _isoformat(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _is_r2(path: str) -> bool:
    return path.startswith("r2://")


def _validate_r2_root(version_root: str) -> str:
    root = version_root.rstrip("/")
    parsed = urlsplit(root)
    parts = PurePosixPath(parsed.path).parts
    if (
        parsed.scheme != "r2"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parts
        or ".." in parts
        or any(character in root for character in "*?[")
    ):
        raise DatasetError("R2 model version must be a concrete r2:// bucket path")
    return root


def _configure_r2(connection: duckdb.DuckDBPyConnection) -> None:
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not account_id or not access_key or not secret_key:
        raise DatasetError(
            "R2 reports require CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY"
        )
    previous_access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    previous_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    os.environ["AWS_ACCESS_KEY_ID"] = access_key
    os.environ["AWS_SECRET_ACCESS_KEY"] = secret_key
    try:
        connection.execute("INSTALL httpfs")
        connection.execute("LOAD httpfs")
        connection.execute(
            """
            create secret work_graph_analytics_r2 (
              type r2,
              provider credential_chain,
              account_id ?
            )
            """,
            [account_id],
        )
    except duckdb.Error as error:
        raise DatasetError("cannot configure the temporary DuckDB R2 credential") from error
    finally:
        if previous_access_key is None:
            os.environ.pop("AWS_ACCESS_KEY_ID", None)
        else:
            os.environ["AWS_ACCESS_KEY_ID"] = previous_access_key
        if previous_secret_key is None:
            os.environ.pop("AWS_SECRET_ACCESS_KEY", None)
        else:
            os.environ["AWS_SECRET_ACCESS_KEY"] = previous_secret_key


def _read_manifest(
    connection: duckdb.DuckDBPyConnection, version_root: str
) -> tuple[PublicationManifest, str | Path]:
    if _is_r2(version_root):
        root: str | Path = _validate_r2_root(version_root)
        manifest_path = f"{root}/manifest.json"
        try:
            row = connection.execute("select content from read_text(?)", [manifest_path]).fetchone()
        except duckdb.Error as error:
            raise DatasetError("cannot read the R2 publication manifest") from error
        if row is None:
            raise DatasetError("the R2 publication manifest is empty")
        body = row[0]
    else:
        root = Path(version_root).resolve()
        if not root.is_dir():
            raise DatasetError("local model version does not exist")
        try:
            body = (root / "manifest.json").read_text()
        except OSError as error:
            raise DatasetError("cannot read the local publication manifest") from error
    try:
        manifest = PublicationManifest.model_validate_json(body)
    except ValidationError as error:
        raise DatasetError("publication manifest is incomplete or invalid") from error
    root_name = root.rsplit("/", 1)[-1] if isinstance(root, str) else root.name
    if root_name != manifest.model_version:
        raise DatasetError("model version path does not match the publication manifest")
    return manifest, root


def _model_paths(
    manifest: PublicationManifest, version_root: str | Path
) -> dict[str, tuple[str | Path, PublishedModel]]:
    descriptors: dict[str, PublishedModel] = {}
    for descriptor in manifest.models:
        key = PurePosixPath(descriptor.key)
        if (
            key.is_absolute()
            or ".." in key.parts
            or len(key.parts) != 2
            or key.parts[0] != manifest.model_version
            or key.name in descriptors
            or any(character in descriptor.key for character in "*?[")
        ):
            raise DatasetError("publication manifest contains an unsafe or duplicate model key")
        descriptors[key.name] = descriptor

    missing = sorted(set(REQUIRED_REPORT_MODELS) - descriptors.keys())
    if missing:
        raise DatasetError(f"publication manifest omits required report model: {missing[0]}")

    paths: dict[str, tuple[str | Path, PublishedModel]] = {}
    if isinstance(version_root, str):
        parent = version_root.rsplit("/", 1)[0]
        for filename in REQUIRED_REPORT_MODELS:
            descriptor = descriptors[filename]
            paths[filename] = (f"{parent}/{descriptor.key}", descriptor)
    else:
        parent = version_root.parent.resolve()
        for filename in REQUIRED_REPORT_MODELS:
            descriptor = descriptors[filename]
            path = (parent / descriptor.key).resolve()
            if not path.is_relative_to(parent) or path.parent != version_root:
                raise DatasetError("manifest-listed model escapes its version directory")
            paths[filename] = (path, descriptor)
    return paths


def _object_bytes(connection: duckdb.DuckDBPyConnection, path: str | Path) -> bytes:
    if isinstance(path, Path):
        try:
            return path.read_bytes()
        except OSError as error:
            raise DatasetError(f"cannot read manifest-listed model {path.name}") from error
    try:
        row = connection.execute("select content from read_blob(?)", [path]).fetchone()
    except duckdb.Error as error:
        raise DatasetError("cannot read a manifest-listed R2 model") from error
    if row is None:
        raise DatasetError("manifest-listed R2 model is empty")
    return bytes(row[0])


def _verify_models(
    connection: duckdb.DuckDBPyConnection,
    paths: dict[str, tuple[str | Path, PublishedModel]],
) -> None:
    for filename, (path, descriptor) in paths.items():
        body = _object_bytes(connection, path)
        if len(body) != descriptor.size or hashlib.sha256(body).hexdigest() != descriptor.checksum:
            raise DatasetError(f"manifest verification failed for {filename}")
        try:
            row = connection.execute("select count(*) from read_parquet(?)", [str(path)]).fetchone()
        except duckdb.Error as error:
            raise DatasetError(f"cannot query manifest-listed model {filename}") from error
        if row is None or row[0] != descriptor.rows:
            raise DatasetError(f"row count mismatch for {filename}")


def _scope_snapshot(
    connection: duckdb.DuckDBPyConnection,
    path: str | Path,
    manifest_snapshot: PublicationScopeSnapshot | None,
    fallback_watermark: int,
) -> ReportScopeSnapshot:
    if manifest_snapshot is not None:
        return ReportScopeSnapshot(
            manifest_keys=[manifest_snapshot.manifest_key],
            object_keys=[manifest_snapshot.object_key],
            captured_at=manifest_snapshot.captured_at,
            event_watermark=manifest_snapshot.event_watermark,
        )
    row = connection.execute(
        """
        select
          list_sort(list(distinct manifest_key)),
          list_sort(list(distinct scope_object_key)),
          max(captured_at),
          max(source_watermark)
        from read_parquet(?)
        """,
        [str(path)],
    ).fetchone()
    if row is None:
        raise DatasetError("cannot read scope snapshot provenance")
    return ReportScopeSnapshot(
        manifest_keys=list(row[0] or []),
        object_keys=list(row[1] or []),
        captured_at=_isoformat(row[2]) if row[2] is not None else None,
        event_watermark=int(row[3] or fallback_watermark),
    )


REPORT_QUERY = (
    resources.files("work_graph_analytics")
    .joinpath("queries/operational_report.sql")
    .read_text()
)


def _metrics(
    connection: duckdb.DuckDBPyConnection,
    paths: dict[str, tuple[str | Path, PublishedModel]],
    *,
    start: datetime,
    end: datetime,
    project_id: str | None,
    initiative_id: str | None,
) -> list[ReportMetric]:
    rows = connection.execute(
        REPORT_QUERY,
        [
            start,
            end,
            str(paths["fct_wait_episodes.parquet"][0]),
            str(paths["fct_events.parquet"][0]),
            str(paths["fct_scopes.parquet"][0]),
            project_id,
            project_id,
            initiative_id,
            initiative_id,
        ],
    ).fetchall()
    return [
        ReportMetric(
            project_id=row[0],
            initiative_id=row[1],
            cause=row[2],
            episodes=int(row[3]),
            recurring_work_items=int(row[4]),
            wait_milliseconds=int(row[5]),
            open_at_end=int(row[6]),
            intervention_requests=int(row[7]),
            resolutions=int(row[8]),
            stale_takeovers=int(row[9]),
            failed_handoff_proxies=int(row[10]),
        )
        for row in rows
    ]


def operational_report(
    version_root: str,
    *,
    start: str,
    end: str,
    project_id: str | None = None,
    initiative_id: str | None = None,
) -> OperationalReport:
    period_start = _timestamp(start, "report start")
    period_end = _timestamp(end, "report end")
    if period_start >= period_end:
        raise DatasetError("report start must be before report end")
    if project_id == "" or initiative_id == "":
        raise DatasetError("scope filters must not be empty")

    connection = duckdb.connect(":memory:")
    try:
        if _is_r2(version_root):
            _configure_r2(connection)
        manifest, root = _read_manifest(connection, version_root)
        paths = _model_paths(manifest, root)
        _verify_models(connection, paths)
        scope_snapshot = _scope_snapshot(
            connection,
            paths["fct_scopes.parquet"][0],
            manifest.source.scope_snapshot,
            manifest.source.through_sequence,
        )
        latest_event = connection.execute(
            "select max(occurred_at) from read_parquet(?)",
            [str(paths["fct_events.parquet"][0])],
        ).fetchone()
        if latest_event is None or latest_event[0] is None:
            raise DatasetError("event facts do not contain freshness metadata")
        metrics = _metrics(
            connection,
            paths,
            start=period_start,
            end=period_end,
            project_id=project_id,
            initiative_id=initiative_id,
        )
    except duckdb.Error as error:
        raise DatasetError("DuckDB could not execute the operational report") from error
    finally:
        connection.close()

    return OperationalReport(
        period=ReportPeriod(start=_isoformat(period_start), end=_isoformat(period_end)),
        scope=ReportScope(project_id=project_id, initiative_id=initiative_id),
        provenance=ReportProvenance(
            model_version=manifest.model_version,
            manifest_schema_version=manifest.manifest_schema_version,
            source_coverage=ReportSourceCoverage(
                manifest_keys=manifest.source.manifest_keys,
                through_sequence=manifest.source.through_sequence,
            ),
            scope_snapshot=scope_snapshot,
            freshness=ReportFreshness(
                latest_event_at=_isoformat(latest_event[0]),
                scope_captured_at=scope_snapshot.captured_at,
            ),
        ),
        inference_limits=INFERENCE_LIMITS,
        metrics=metrics,
    )
