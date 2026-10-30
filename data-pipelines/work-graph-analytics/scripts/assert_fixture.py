from __future__ import annotations

import hashlib
import json
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

from work_graph_analytics.reporting import operational_report

ACCESS_CAUSE = "attention:access"
REVIEW_CAUSE = "attention:review"


def _json_value(value: Any) -> Any:
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def logical_checksum(path: Path) -> str:
    relation = duckdb.sql(f"select * from read_parquet('{path.as_posix()}')")
    columns = [description[0] for description in relation.description]
    rows = [
        {column: _json_value(value) for column, value in zip(columns, row, strict=True)}
        for row in relation.fetchall()
    ]
    body = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def metric(version: Path, project: str, cause: str) -> tuple[int, ...]:
    row = duckdb.sql(
        """
        select
          episodes,
          recurring_work_items,
          wait_milliseconds,
          open_at_end,
          intervention_requests,
          resolutions,
          stale_takeovers,
          failed_handoff_proxies
        from read_parquet(?)
        where project_id = ? and cause = ?
        """,
        params=[str(version / "mart_operational_metrics.parquet"), project, cause],
    ).fetchone()
    assert row is not None, (project, cause)
    return tuple(int(value) for value in row)


def main() -> None:
    first = Path(sys.argv[1])
    second = Path(sys.argv[2])
    assert metric(first, "project-new", ACCESS_CAUSE) == (
        2,
        1,
        5_400_000,
        0,
        1,
        2,
        0,
        0,
    )
    assert metric(first, "project", REVIEW_CAUSE) == (
        1,
        0,
        1_800_000,
        0,
        0,
        1,
        0,
        0,
    )
    assert metric(first, "project", "stale_lease") == (
        3,
        0,
        12_600_000,
        1,
        0,
        0,
        2,
        1,
    )
    report = operational_report(
        str(first),
        start="2026-10-01T01:00:00Z",
        end="2026-10-01T03:00:00Z",
    )
    report_metrics = {
        (row.project_id, row.cause): (
            row.episodes,
            row.recurring_work_items,
            row.wait_milliseconds,
            row.open_at_end,
            row.intervention_requests,
            row.resolutions,
            row.stale_takeovers,
            row.failed_handoff_proxies,
        )
        for row in report.metrics
    }
    assert report_metrics[("project-new", ACCESS_CAUSE)] == metric(
        first, "project-new", ACCESS_CAUSE
    )
    assert report_metrics[("project", REVIEW_CAUSE)] == metric(first, "project", REVIEW_CAUSE)
    assert report_metrics[("project", "stale_lease")] == metric(first, "project", "stale_lease")
    assert report.provenance.model_version == "fixture-v1"
    assert report.provenance.source_coverage.through_sequence == 14
    assert report.provenance.scope_snapshot.object_keys == ["work-state/v1/scopes/14.json"]
    assert report.provenance.freshness.latest_event_at == "2026-10-01T03:00:00.000Z"
    manifests = json.loads((first / "manifest.json").read_text())
    assert manifests["complete"] is True
    assert manifests["source"]["throughSequence"] == 14
    assert len(manifests["source"]["manifestKeys"]) == 2
    for left in sorted(first.glob("*.parquet")):
        right = second / left.name
        assert logical_checksum(left) == logical_checksum(right), left.name


if __name__ == "__main__":
    main()
