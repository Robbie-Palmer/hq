from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import duckdb
import pytest

from work_graph_analytics.cli import main
from work_graph_analytics.manifest import DatasetError
from work_graph_analytics.publication import (
    MODEL_FILES,
    PublicationScopeSnapshot,
    ensure_new_version,
    publish_manifest,
)
from work_graph_analytics.reporting import (
    _configure_r2,
    _model_paths,
    _object_bytes,
    _read_manifest,
    _validate_r2_root,
    _verify_models,
    operational_report,
)

PERIOD_START = "2026-10-01T01:00:00Z"
PERIOD_END = "2026-10-01T03:00:00Z"


def write_parquet(path: Path, query: str) -> None:
    escaped = path.as_posix().replace("'", "''")
    duckdb.sql(f"copy ({query}) to '{escaped}' (format parquet)")


def published_version(tmp_path: Path, *, scope_snapshot: bool = True) -> Path:
    version = ensure_new_version(tmp_path, "fixture-v1")
    write_parquet(
        version / "fct_events.parquet",
        """
        select * from (values
          (1, 'attention.requested', 'ticket-a', timestamptz '2026-10-01 00:00:00+00', 'a1', 'access'),
          (2, 'attention.resolved', 'ticket-a', timestamptz '2026-10-01 02:00:00+00', 'a1', null),
          (3, 'attention.requested', 'ticket-a', timestamptz '2026-10-01 02:00:00+00', 'a2', 'access'),
          (4, 'attention.resolved', 'ticket-a', timestamptz '2026-10-01 02:30:00+00', 'a2', null),
          (5, 'attention.requested', 'ticket-e', timestamptz '2026-10-01 00:30:00+00', 'e1', 'review'),
          (6, 'attention.resolved', 'ticket-e', timestamptz '2026-10-01 01:30:00+00', 'e1', null),
          (7, 'work_item.created', 'ticket-e', timestamptz '2026-10-01 03:00:00+00', null, null)
        ) events(sequence, event_type, work_item_id, occurred_at, attention_request_id, attention_kind)
        """,
    )
    write_parquet(
        version / "fct_wait_episodes.parquet",
        """
        select * from (values
          ('ticket-a', 'attention:access', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-10-01 02:00:00+00', false),
          ('ticket-a', 'attention:access', timestamptz '2026-10-01 02:00:00+00', timestamptz '2026-10-01 02:30:00+00', false),
          ('ticket-b', 'stale_lease', timestamptz '2026-10-01 02:00:00+00', timestamptz '2026-10-01 02:30:00+00', false),
          ('ticket-c', 'stale_lease', timestamptz '2026-10-01 01:00:00+00', timestamptz '2026-10-01 02:00:00+00', true),
          ('ticket-d', 'stale_lease', timestamptz '2026-10-01 01:00:00+00', null, false),
          ('ticket-e', 'attention:review', timestamptz '2026-10-01 00:30:00+00', timestamptz '2026-10-01 01:30:00+00', false)
        ) waits(work_item_id, cause, opened_at, closed_at, failed_handoff_proxy)
        """,
    )
    write_parquet(
        version / "fct_scopes.parquet",
        """
        select * from (values
          ('ticket-a', 'project-new', 'initiative'),
          ('ticket-b', 'project', 'initiative'),
          ('ticket-c', 'project', 'initiative'),
          ('ticket-d', 'project', 'initiative'),
          ('ticket-e', 'project', 'initiative')
        ) input(work_item_id, project_id, initiative_id)
        cross join (
          select
            timestamptz '2026-10-01 03:05:00+00' as captured_at,
            14::bigint as source_watermark,
            'work-state/v1/manifests/10-14.json' as manifest_key,
            'work-state/v1/scopes/14.json' as scope_object_key
        ) metadata
        """,
    )
    write_parquet(version / "fct_tickets.parquet", "select 'ticket-a' as work_item_id")
    for filename in MODEL_FILES:
        path = version / filename
        if not path.exists():
            write_parquet(path, "select 1 as value")
    publish_manifest(
        tmp_path,
        "fixture-v1",
        source_manifest_keys=[
            "work-state/v1/manifests/1-9.json",
            "work-state/v1/manifests/10-14.json",
        ],
        source_watermark=14,
        scope_snapshot=(
            PublicationScopeSnapshot(
                manifest_key="work-state/v1/manifests/10-14.json",
                object_key="work-state/v1/scopes/14.json",
                captured_at="2026-10-01T03:05:00.000Z",
                event_watermark=14,
            )
            if scope_snapshot
            else None
        ),
    )
    return version


def metric(report: object, project: str, cause: str) -> object:
    return next(
        row
        for row in report.metrics  # type: ignore[attr-defined]
        if row.project_id == project and row.cause == cause
    )


def test_reports_reference_metrics_scope_and_provenance(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    report = operational_report(str(version), start=PERIOD_START, end=PERIOD_END)

    access = metric(report, "project-new", "attention:access")
    assert (
        access.episodes,
        access.recurring_work_items,
        access.wait_milliseconds,
        access.open_at_end,
        access.intervention_requests,
        access.resolutions,
    ) == (2, 1, 5_400_000, 0, 1, 2)
    stale = metric(report, "project", "stale_lease")
    assert (
        stale.episodes,
        stale.wait_milliseconds,
        stale.open_at_end,
        stale.stale_takeovers,
        stale.failed_handoff_proxies,
    ) == (3, 12_600_000, 1, 2, 1)
    assert report.provenance.model_version == "fixture-v1"
    assert report.provenance.source_coverage.through_sequence == 14
    assert report.provenance.scope_snapshot.object_keys == ["work-state/v1/scopes/14.json"]
    assert report.provenance.freshness.latest_event_at == "2026-10-01T03:00:00.000Z"
    assert "does not prove" in " ".join(report.inference_limits)

    scoped = operational_report(
        str(version),
        start=PERIOD_START,
        end=PERIOD_END,
        project_id="project-new",
        initiative_id="initiative",
    )
    assert [(row.project_id, row.cause) for row in scoped.metrics] == [
        ("project-new", "attention:access")
    ]
    assert scoped.scope.project_id == "project-new"


def test_period_is_half_open_and_legacy_scope_provenance_is_readable(tmp_path: Path) -> None:
    version = published_version(tmp_path, scope_snapshot=False)
    report = operational_report(
        str(version),
        start="2026-10-01T02:00:00+00:00",
        end="2026-10-01T02:30:00+00:00",
    )
    access = metric(report, "project-new", "attention:access")
    assert (access.wait_milliseconds, access.intervention_requests, access.resolutions) == (
        1_800_000,
        1,
        1,
    )
    assert report.period.end == "2026-10-01T02:30:00.000Z"
    assert report.provenance.scope_snapshot.manifest_keys == ["work-state/v1/manifests/10-14.json"]
    assert not any(row.cause == "attention:review" for row in report.metrics)
    stale = metric(report, "project", "stale_lease")
    assert (
        stale.episodes,
        stale.wait_milliseconds,
        stale.open_at_end,
        stale.stale_takeovers,
        stale.failed_handoff_proxies,
    ) == (2, 3_600_000, 2, 1, 1)


def test_report_cli_prints_json(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    version = published_version(tmp_path)
    assert main(["report", str(version), PERIOD_START, PERIOD_END, "--project_id=project"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["scope"]["projectId"] == "project"
    assert {row["cause"] for row in report["metrics"]} == {
        "attention:review",
        "stale_lease",
    }


@pytest.mark.parametrize(
    ("start", "end", "message"),
    [
        ("bad", PERIOD_END, "ISO-8601"),
        ("2026-10-01T01:00:00", PERIOD_END, "timezone"),
        (PERIOD_END, PERIOD_START, "before"),
    ],
)
def test_rejects_invalid_periods(tmp_path: Path, start: str, end: str, message: str) -> None:
    version = published_version(tmp_path)
    with pytest.raises(DatasetError, match=message):
        operational_report(str(version), start=start, end=end)


def test_rejects_empty_scope_and_invalid_local_versions(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    with pytest.raises(DatasetError, match="scope filters"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END, project_id="")
    with pytest.raises(DatasetError, match="does not exist"):
        operational_report(str(tmp_path / "missing"), start=PERIOD_START, end=PERIOD_END)

    (version / "manifest.json").write_text("{}")
    with pytest.raises(DatasetError, match="incomplete or invalid"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)


def test_rejects_mismatched_unsafe_missing_and_corrupt_models(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    manifest_path = version / "manifest.json"
    manifest = json.loads(manifest_path.read_text())

    moved = tmp_path / "wrong-name"
    version.rename(moved)
    with pytest.raises(DatasetError, match="path does not match"):
        operational_report(str(moved), start=PERIOD_START, end=PERIOD_END)
    moved.rename(version)

    manifest["models"][0]["key"] = "fixture-v1/../escape.parquet"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(DatasetError, match="unsafe or duplicate"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)

    manifest["models"] = [
        model for model in manifest["models"] if not model["key"].endswith("fct_scopes.parquet")
    ]
    manifest["models"][0]["key"] = "fixture-v1/fct_events.parquet"
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(DatasetError, match="omits required"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)

    version = published_version(tmp_path / "second")
    (version / "fct_events.parquet").write_bytes(b"corrupt")
    with pytest.raises(DatasetError, match="manifest verification"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)


def test_rejects_row_count_mismatch_after_valid_manifest_update(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    path = version / "fct_tickets.parquet"
    write_parquet(path, "select * from (values ('a'), ('b')) tickets(work_item_id)")
    manifest_path = version / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    descriptor = next(
        model for model in manifest["models"] if model["key"].endswith("fct_tickets.parquet")
    )
    body = path.read_bytes()
    descriptor["bytes"] = len(body)
    descriptor["checksumSha256"] = hashlib.sha256(body).hexdigest()
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(DatasetError, match="row count mismatch"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)


def test_rejects_corrupt_additional_manifest_listed_model(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    (version / "mart_interventions.parquet").write_bytes(b"corrupt")
    with pytest.raises(DatasetError, match="manifest verification"):
        operational_report(str(version), start=PERIOD_START, end=PERIOD_END)


class FakeResult:
    def __init__(self, row: tuple[object, ...] | None = None) -> None:
        self.row = row

    def fetchone(self) -> tuple[object, ...] | None:
        return self.row


class FakeConnection:
    def __init__(self, rows: list[tuple[object, ...] | None] | None = None) -> None:
        self.rows = list(rows or [])
        self.statements: list[str] = []

    def execute(self, statement: str, _parameters: object = None) -> FakeResult:
        self.statements.append(statement)
        return FakeResult(self.rows.pop(0) if self.rows else None)


def test_r2_path_and_temporary_credential_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _validate_r2_root("r2://bucket/prefix/v1/") == "r2://bucket/prefix/v1"
    for invalid in ["s3://bucket/v1", "r2://bucket", "r2://bucket/a/../v1", "r2://bucket/*"]:
        with pytest.raises(DatasetError, match="concrete"):
            _validate_r2_root(invalid)

    connection = FakeConnection()
    with pytest.raises(DatasetError, match="require"):
        _configure_r2(connection)  # type: ignore[arg-type]
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "original-access")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "original-secret")
    _configure_r2(connection)  # type: ignore[arg-type]
    assert len(connection.statements) == 3
    assert connection.statements[-1].lstrip().startswith("create secret")
    assert os.environ["AWS_ACCESS_KEY_ID"] == "original-access"
    assert os.environ["AWS_SECRET_ACCESS_KEY"] == "original-secret"


def test_r2_manifest_blob_and_verification_helpers(tmp_path: Path) -> None:
    version = published_version(tmp_path)
    body = (version / "manifest.json").read_text()
    manifest, root = _read_manifest(
        FakeConnection([(body,)]),  # type: ignore[arg-type]
        "r2://bucket/prefix/fixture-v1",
    )
    assert root == "r2://bucket/prefix/fixture-v1"
    paths = _model_paths(manifest, root)
    model_body = (version / "fct_events.parquet").read_bytes()
    assert (
        _object_bytes(
            FakeConnection([(memoryview(model_body),)]),  # type: ignore[arg-type]
            "r2://bucket/prefix/fixture-v1/fct_events.parquet",
        )
        == model_body
    )
    descriptor = paths["fct_events.parquet"][1]
    _verify_models(
        FakeConnection([(memoryview(model_body),), (descriptor.rows,)]),  # type: ignore[arg-type]
        {"fct_events.parquet": ("r2://bucket/prefix/fixture-v1/fct_events.parquet", descriptor)},
    )
