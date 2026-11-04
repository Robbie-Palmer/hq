from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb

from work_graph_analytics.reporting import operational_report

ACCESS_CAUSE = "attention:access"
REVIEW_CAUSE = "attention:review"


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
    retry = Path(sys.argv[3])
    assert metric(first, "project-old", ACCESS_CAUSE) == (
        2,
        1,
        7_200_000,
        1,
        1,
        1,
        0,
        0,
    )
    assert metric(second, "project-new", ACCESS_CAUSE) == (
        2,
        1,
        5_400_000,
        0,
        1,
        2,
        0,
        0,
    )
    assert metric(second, "project", REVIEW_CAUSE) == (
        1,
        0,
        1_800_000,
        0,
        0,
        1,
        0,
        0,
    )
    assert metric(second, "project", "stale_lease") == (
        3,
        0,
        12_600_000,
        1,
        0,
        0,
        2,
        1,
    )
    first_report = operational_report(
        str(first),
        start="2026-10-01T01:00:00Z",
        end="2026-10-01T03:00:00Z",
    )
    report = operational_report(
        str(second),
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
        second, "project-new", ACCESS_CAUSE
    )
    assert report_metrics[("project", REVIEW_CAUSE)] == metric(second, "project", REVIEW_CAUSE)
    assert report_metrics[("project", "stale_lease")] == metric(second, "project", "stale_lease")
    assert report.provenance.model_version == "fixture-v2"
    assert first_report.provenance.source_coverage.through_sequence == 9
    assert report.provenance.source_coverage.through_sequence == 14
    assert report.provenance.scope_snapshot.object_keys == ["work-state/v1/scopes/14.json"]
    assert report.provenance.freshness.latest_event_at == "2026-10-01T03:00:00.000Z"
    for path in second.iterdir():
        assert path.read_bytes() == (retry / path.name).read_bytes(), path.name
    print(
        json.dumps(
            {
                "firstModelBytes": first_report.provenance.verified_model_bytes,
                "correctedModelBytes": report.provenance.verified_model_bytes,
                "correctedReportInputBytes": (
                    report.provenance.report_input_bytes_upper_bound
                ),
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
