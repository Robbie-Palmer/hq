from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from pydantic import Field

from work_graph_analytics.manifest import (
    DatasetError,
    RawManifest,
    StagedManifest,
    StrictModel,
    stage_dataset,
)
from work_graph_analytics.publication import (
    PublicationManifest,
    PublicationScopeSnapshot,
    ensure_new_version,
    publish_manifest,
)
from work_graph_analytics.reporting import operational_report

RAW_BUCKET = "work-graph-private-analytics"
MODEL_BUCKET = "work-graph-private-analytics-models"
CORRECTION_WINDOW_DAYS = 30
MAX_RAW_MANIFESTS = 1_000
MAX_RAW_BYTES = 512 * 1024 * 1024
DBT_RUNTIME_LIMIT_SECONDS = 30
REPORT_RUNTIME_LIMIT_SECONDS = 30
MODEL_BYTES_LIMIT = 64 * 1024 * 1024


class PipelineMetrics(StrictModel):
    status: str
    model_version: str = Field(serialization_alias="modelVersion")
    source_watermark: int = Field(serialization_alias="sourceWatermark", ge=1)
    source_manifests: int = Field(serialization_alias="sourceManifests", ge=1)
    raw_bytes: int = Field(serialization_alias="rawBytes", ge=1)
    dbt_duration_milliseconds: int = Field(serialization_alias="dbtDurationMilliseconds", ge=0)
    model_bytes: int = Field(serialization_alias="modelBytes", ge=1)
    report_duration_milliseconds: int = Field(
        serialization_alias="reportDurationMilliseconds", ge=0
    )
    report_scan_bytes: int = Field(serialization_alias="reportScanBytes", ge=1)
    raw_r2_requests: int = Field(serialization_alias="rawR2Requests", ge=1)
    model_r2_requests: int = Field(serialization_alias="modelR2Requests", ge=1)
    correction_window_days: int = Field(
        default=CORRECTION_WINDOW_DAYS, serialization_alias="correctionWindowDays"
    )


class RetentionStatus(StrictModel):
    correction_window_days: int = Field(
        default=CORRECTION_WINDOW_DAYS, serialization_alias="correctionWindowDays"
    )
    deletion_enabled: bool = Field(default=False, serialization_alias="deletionEnabled")
    reason: str = (
        "Raw deletion is disabled until a verified canonical seed can replace every selected "
        "raw manifest in future rebuilds."
    )


class DownloadedRaw(StrictModel):
    manifests: int = Field(ge=1)
    size: int = Field(ge=1)
    requests: int = Field(ge=1)


class R2Client:
    def __init__(self, access_key: str, secret_key: str, account_id: str, region: str) -> None:
        self.client: Any = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        self.requests = 0

    def list_keys(self, bucket: str, prefix: str) -> list[str]:
        keys: list[str] = []
        token: str | None = None
        while True:
            request: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1_000}
            if token is not None:
                request["ContinuationToken"] = token
            self.requests += 1
            response = self.client.list_objects_v2(**request)
            keys.extend(
                item["Key"]
                for item in response.get("Contents", [])
                if isinstance(item.get("Key"), str)
            )
            if not response.get("IsTruncated"):
                return keys
            token = response.get("NextContinuationToken")
            if not isinstance(token, str):
                raise DatasetError("R2 raw listing returned an invalid continuation token")

    def read(self, bucket: str, key: str) -> bytes:
        self.requests += 1
        response = self.client.get_object(Bucket=bucket, Key=key)
        return bytes(response["Body"].read())

    def put_immutable(self, bucket: str, key: str, body: bytes, content_type: str) -> None:
        self.requests += 1
        try:
            self.client.put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType=content_type,
                IfNoneMatch="*",
            )
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") != 412:
                raise DatasetError("R2 model publication failed") from None
        else:
            return
        if self.read(bucket, key) != body:
            raise DatasetError("R2 model publication conflicts with an existing immutable object")


def _required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise DatasetError(f"{name} is required")
    return value


def _clients() -> tuple[R2Client, R2Client]:
    account_id = _required_environment("CLOUDFLARE_ACCOUNT_ID")
    region = _required_environment("R2_REGION")
    return (
        R2Client(
            _required_environment("RAW_R2_ACCESS_KEY_ID"),
            _required_environment("RAW_R2_SECRET_ACCESS_KEY"),
            account_id,
            region,
        ),
        R2Client(
            _required_environment("MODEL_R2_ACCESS_KEY_ID"),
            _required_environment("MODEL_R2_SECRET_ACCESS_KEY"),
            account_id,
            region,
        ),
    )


def _safe_destination(root: Path, key: str) -> Path:
    relative = PurePosixPath(key)
    if relative.is_absolute() or ".." in relative.parts:
        raise DatasetError("R2 returned an unsafe object key")
    destination = root.joinpath(*relative.parts).resolve()
    if not destination.is_relative_to(root.resolve()):
        raise DatasetError("R2 returned an object key outside the raw cache")
    return destination


def _validate_raw_key(key: str, prefix: str) -> None:
    path = PurePosixPath(key)
    if not key.startswith(prefix) or path.is_absolute() or ".." in path.parts:
        raise DatasetError(f"R2 manifest object key must stay within {prefix}")


def _write_private(path: Path, body: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(body)
    path.chmod(0o600)


def _download_raw(client: R2Client, root: Path) -> DownloadedRaw:
    keys = sorted(
        key
        for key in client.list_keys(RAW_BUCKET, "work-state/v1/manifests/")
        if key.endswith(".json")
    )
    if not keys or len(keys) > MAX_RAW_MANIFESTS:
        raise DatasetError("R2 raw manifest count is outside the operating limit")
    size = 0
    object_keys: set[str] = set()
    for key in keys:
        body = client.read(RAW_BUCKET, key)
        size += len(body)
        try:
            manifest = RawManifest.model_validate_json(body)
        except ValueError as error:
            raise DatasetError("R2 raw manifest is invalid") from error
        _validate_raw_key(manifest.event.key, "work-state/v1/events/")
        _validate_raw_key(manifest.scope.key, "work-state/v1/scopes/")
        object_keys.update((manifest.event.key, manifest.scope.key))
        _write_private(_safe_destination(root, key), body)
    for key in sorted(object_keys):
        body = client.read(RAW_BUCKET, key)
        size += len(body)
        if size > MAX_RAW_BYTES:
            raise DatasetError("R2 raw download exceeds the operating byte limit")
        _write_private(_safe_destination(root, key), body)
    return DownloadedRaw(manifests=len(keys), size=size, requests=client.requests)


def _run_dbt(project: Path, work: Path, staging: Path, output: Path, version: str) -> int:
    started = time.monotonic()
    environment = {**os.environ, "WORK_GRAPH_ANALYTICS_DB": str(work / "work-graph.duckdb")}
    command = [
        "uv",
        "run",
        "--locked",
        "dbt",
        "build",
        "--profiles-dir",
        ".",
        "--target-path",
        str(work / "dbt-target"),
        "--vars",
        json.dumps(
            {
                "raw_staging_root": str(staging),
                "output_root": str(output),
                "model_version": version,
                "period_start": "1970-01-01T00:00:00Z",
                "period_end": "9999-12-31T00:00:00Z",
            }
        ),
    ]
    try:
        subprocess.run(  # noqa: S603 - arguments are fixed and no shell is used.
            command,
            cwd=project,
            env=environment,
            check=True,
            timeout=DBT_RUNTIME_LIMIT_SECONDS,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise DatasetError("dbt build failed; no model publication was written") from error
    return int((time.monotonic() - started) * 1_000)


def _publish_models(client: R2Client, version_root: Path) -> tuple[int, PublicationManifest]:
    manifest_body = (version_root / "manifest.json").read_bytes()
    manifest = PublicationManifest.model_validate_json(manifest_body)
    model_bytes = 0
    for descriptor in manifest.models:
        path = version_root / PurePosixPath(descriptor.key).name
        body = path.read_bytes()
        model_bytes += len(body)
        if model_bytes > MODEL_BYTES_LIMIT:
            raise DatasetError("model publication exceeds the operating byte limit")
        client.put_immutable(
            MODEL_BUCKET, f"models/{descriptor.key}", body, "application/octet-stream"
        )
    client.put_immutable(
        MODEL_BUCKET,
        f"models/{manifest.model_version}/manifest.json",
        manifest_body,
        "application/json",
    )
    return model_bytes, manifest


def operate_pipeline() -> PipelineMetrics:
    project = Path(__file__).resolve().parents[2]
    try:
        raw_client, model_client = _clients()
        with tempfile.TemporaryDirectory(prefix="work-graph-analytics-") as directory:
            work = Path(directory)
            work.chmod(0o700)
            raw = work / "raw"
            staged = work / "staged"
            output = work / "published"
            download = _download_raw(raw_client, raw)
            summary = stage_dataset(raw, staged)
            version = f"v1-{summary.watermark}"
            ensure_new_version(output, version)
            dbt_duration = _run_dbt(project, work, staged, output, version)
            publish_manifest(
                output,
                version,
                source_manifest_keys=[
                    row.manifest_key for row in _staged_manifests(staged / "manifests.ndjson")
                ],
                source_watermark=summary.watermark,
                scope_snapshot=_latest_scope_snapshot(staged / "manifests.ndjson"),
            )
            model_bytes, manifest = _publish_models(model_client, output / version)
            report_started = time.monotonic()
            previous_database_url = os.environ.pop("DATABASE_URL", None)
            try:
                operational_report(
                    str(output / version),
                    start="1970-01-01T00:00:00Z",
                    end="9999-12-31T00:00:00Z",
                )
            finally:
                if previous_database_url is not None:
                    os.environ["DATABASE_URL"] = previous_database_url
            report_duration = int((time.monotonic() - report_started) * 1_000)
            if report_duration > REPORT_RUNTIME_LIMIT_SECONDS * 1_000:
                raise DatasetError("private report exceeded the operating time limit")
            return PipelineMetrics(
                status="published",
                model_version=version,
                source_watermark=summary.watermark,
                source_manifests=download.manifests,
                raw_bytes=download.size,
                dbt_duration_milliseconds=dbt_duration,
                model_bytes=model_bytes,
                report_duration_milliseconds=report_duration,
                report_scan_bytes=sum(model.size for model in manifest.models),
                raw_r2_requests=download.requests,
                model_r2_requests=model_client.requests,
            )
    except (BotoCoreError, ClientError) as error:
        raise DatasetError("R2 analytics operation failed") from error


def _staged_manifests(path: Path) -> list[StagedManifest]:
    return [
        StagedManifest.model_validate_json(line) for line in path.read_text().splitlines() if line
    ]


def _latest_scope_snapshot(path: Path) -> PublicationScopeSnapshot:
    latest = _staged_manifests(path)[-1]
    return PublicationScopeSnapshot(
        manifest_key=latest.manifest_key,
        object_key=latest.scope_object_key,
        captured_at=latest.captured_at,
        event_watermark=latest.through_sequence,
    )


def retention_status() -> RetentionStatus:
    return RetentionStatus()
