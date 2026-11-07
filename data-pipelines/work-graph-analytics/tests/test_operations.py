from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from work_graph_analytics.manifest import DatasetError, StagedManifest, StageSummary
from work_graph_analytics.operations import (
    DownloadedRaw,
    R2Client,
    _download_raw,
    _publish_models,
    _run_dbt,
    _safe_destination,
    _validate_raw_key,
    operate_pipeline,
    retention_status,
)
from work_graph_analytics.publication import (
    PublicationManifest,
    PublicationScopeSnapshot,
    PublicationSource,
    PublishedModel,
)


class FakeRawClient:
    def __init__(self, fixture: Path) -> None:
        self.fixture = fixture
        self.requests = 0

    def list_keys(self, _bucket: str, _prefix: str) -> list[str]:
        self.requests += 1
        return [
            path.relative_to(self.fixture).as_posix()
            for path in (self.fixture / "work-state/v1/manifests").glob("*.json")
        ]

    def read(self, _bucket: str, key: str) -> bytes:
        self.requests += 1
        return (self.fixture / key).read_bytes()


class FakeModelClient:
    def __init__(self) -> None:
        self.requests = 0
        self.objects: dict[str, bytes] = {}

    def put_immutable(self, _bucket: str, key: str, body: bytes, _content_type: str) -> None:
        self.requests += 1
        if key in self.objects and self.objects[key] != body:
            raise DatasetError("immutable object conflict")
        self.objects[key] = body


class InterruptingModelClient(FakeModelClient):
    def __init__(self) -> None:
        super().__init__()
        self.interrupt_manifest = True

    def put_immutable(self, bucket: str, key: str, body: bytes, content_type: str) -> None:
        if key.endswith("manifest.json") and self.interrupt_manifest:
            self.interrupt_manifest = False
            raise DatasetError("simulated interruption")
        super().put_immutable(bucket, key, body, content_type)


class ObjectBody:
    def read(self) -> bytes:
        return b"existing"


class FakeS3:
    def __init__(self) -> None:
        self.list_calls = 0
        self.put_error: ClientError | None = None

    def list_objects_v2(self, **_request: object) -> dict[str, object]:
        self.list_calls += 1
        if self.list_calls == 1:
            return {
                "Contents": [{"Key": "a"}],
                "IsTruncated": True,
                "NextContinuationToken": "next",
            }
        return {"Contents": [{"Key": "b"}], "IsTruncated": False}

    def get_object(self, **_request: object) -> dict[str, object]:
        return {"Body": ObjectBody()}

    def put_object(self, **_request: object) -> None:
        if self.put_error is not None:
            raise self.put_error


def fixture_root() -> Path:
    return Path(__file__).resolve().parents[1] / "fixtures/raw"


def publication(version: str = "v1-14", size: int = 3) -> PublicationManifest:
    return PublicationManifest(
        model_version=version,
        source=PublicationSource(
            manifest_keys=["work-state/v1/manifests/1-14.json"],
            through_sequence=14,
        ),
        models=[
            PublishedModel(
                key=f"{version}/fct_events.parquet",
                rows=1,
                size=size,
                checksum=hashlib.sha256(b"row").hexdigest(),
            )
        ],
    )


def test_downloads_only_manifest_listed_raw_objects_into_private_cache(tmp_path: Path) -> None:
    client = FakeRawClient(fixture_root())
    result = _download_raw(client, tmp_path)

    assert result.manifests == 2
    assert result.requests == 7
    assert result.size > 0
    assert (tmp_path / "work-state/v1/events/1-9.ndjson").stat().st_mode & 0o777 == 0o600
    assert not (tmp_path / "work-state/v1/checkpoint.json").exists()


def test_r2_client_paginates_reads_and_retries_identical_immutable_objects() -> None:
    storage = FakeS3()
    client = R2Client.__new__(R2Client)
    client.client = storage
    client.requests = 0

    assert client.list_keys("bucket", "prefix") == ["a", "b"]
    assert client.read("bucket", "key") == b"existing"
    client.put_immutable("bucket", "key", b"new", "application/json")

    storage.put_error = ClientError(
        {"ResponseMetadata": {"HTTPStatusCode": 412}, "Error": {"Code": "PreconditionFailed"}},
        "PutObject",
    )
    with pytest.raises(DatasetError, match="conflicts"):
        client.put_immutable("bucket", "key", b"different", "application/json")


def test_rejects_unsafe_r2_keys(tmp_path: Path) -> None:
    with pytest.raises(DatasetError, match="unsafe"):
        _safe_destination(tmp_path, "../private")
    with pytest.raises(DatasetError, match="must stay"):
        _validate_raw_key("work-state/v1/checkpoint.json", "work-state/v1/events/")


def test_publishes_models_before_the_complete_manifest(tmp_path: Path) -> None:
    version = tmp_path / "v1-14"
    version.mkdir()
    (version / "fct_events.parquet").write_bytes(b"row")
    manifest = publication()
    (version / "manifest.json").write_text(manifest.model_dump_json(by_alias=True))
    client = FakeModelClient()

    size, parsed = _publish_models(client, version)  # type: ignore[arg-type]

    assert size == 3
    assert parsed.model_version == "v1-14"
    assert list(client.objects) == [
        "models/v1-14/fct_events.parquet",
        "models/v1-14/manifest.json",
    ]


def test_interrupted_publication_resumes_from_identical_immutable_objects(tmp_path: Path) -> None:
    version = tmp_path / "v1-14"
    version.mkdir()
    (version / "fct_events.parquet").write_bytes(b"row")
    (version / "manifest.json").write_text(publication().model_dump_json(by_alias=True))
    client = InterruptingModelClient()

    with pytest.raises(DatasetError, match="simulated interruption"):
        _publish_models(client, version)  # type: ignore[arg-type]
    assert list(client.objects) == ["models/v1-14/fct_events.parquet"]

    _publish_models(client, version)  # type: ignore[arg-type]
    assert list(client.objects) == [
        "models/v1-14/fct_events.parquet",
        "models/v1-14/manifest.json",
    ]


def test_dbt_failure_cannot_publish(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fail_dbt(*_args: object, **_kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, "dbt")

    monkeypatch.setattr(
        subprocess,
        "run",
        fail_dbt,
    )
    with pytest.raises(DatasetError, match="no model publication"):
        _run_dbt(tmp_path, tmp_path, tmp_path, tmp_path, "v1-1")


def test_operate_records_bounded_metrics_and_blocks_database_access(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    import work_graph_analytics.operations as operations

    raw_client = FakeRawClient(fixture_root())
    model_client = FakeModelClient()
    staged = StagedManifest(
        manifest_key="work-state/v1/manifests/1-14.json",
        batch_id="1-14",
        from_sequence_exclusive=0,
        through_sequence=14,
        source_upper_watermark=14,
        captured_at="2026-10-01T03:05:00.000Z",
        event_object_key="work-state/v1/events/1-14.ndjson",
        event_rows=14,
        event_checksum_sha256="a" * 64,
        scope_object_key="work-state/v1/scopes/14.json",
        scope_rows=5,
        scope_checksum_sha256="b" * 64,
    )
    monkeypatch.setattr(operations, "_clients", lambda: (raw_client, model_client))
    monkeypatch.setattr(
        operations,
        "_download_raw",
        lambda *_args: DownloadedRaw(manifests=1, size=1_000, requests=3),
    )
    monkeypatch.setattr(
        operations,
        "stage_dataset",
        lambda *_args: StageSummary(manifests=1, events=14, scopes=5, watermark=14),
    )
    monkeypatch.setattr(operations, "_run_dbt", lambda *_args: 250)
    monkeypatch.setattr(operations, "_staged_manifests", lambda *_args: [staged])
    monkeypatch.setattr(
        operations,
        "_latest_scope_snapshot",
        lambda *_args: PublicationScopeSnapshot(
            manifest_key=staged.manifest_key,
            object_key=staged.scope_object_key,
            captured_at=staged.captured_at,
            event_watermark=14,
        ),
    )
    monkeypatch.setattr(operations, "publish_manifest", lambda *_args, **_kwargs: tmp_path)
    monkeypatch.setattr(operations, "_publish_models", lambda *_args: (123, publication(size=123)))
    monkeypatch.setattr(operations, "operational_report", lambda *_args, **_kwargs: object())
    monkeypatch.setenv("DATABASE_URL", "postgresql://must-not-be-used")
    model_client.requests = 1

    result = operate_pipeline()

    assert result.source_watermark == 14
    assert result.dbt_duration_milliseconds == 250
    assert result.report_scan_bytes == 123
    assert "DATABASE_URL" in __import__("os").environ


def test_retention_stays_disabled_without_a_canonical_seed() -> None:
    status = retention_status()
    assert status.correction_window_days == 30
    assert status.deletion_enabled is False
    assert "canonical seed" in status.reason
