from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from work_graph_analytics.manifest import DatasetError, StagedManifest, stage_dataset
from work_graph_analytics.publication import ensure_new_version, publish_manifest


def _source_metadata(staging_root: Path) -> tuple[list[str], int]:
    path = staging_root / "manifests.ndjson"
    try:
        rows = [
            StagedManifest.model_validate_json(line)
            for line in path.read_text().splitlines()
            if line
        ]
    except (OSError, ValidationError) as error:
        raise DatasetError("cannot read staged source manifests") from error
    if not rows:
        raise DatasetError("staged source manifests are empty")
    return [row.manifest_key for row in rows], rows[-1].through_sequence


class WorkGraphAnalytics:
    def stage(self, raw_root: str, staging_root: str) -> None:
        summary = stage_dataset(Path(raw_root), Path(staging_root))
        print(summary.model_dump_json())

    def prepare(self, output_root: str, version: str) -> None:
        print(ensure_new_version(Path(output_root), version))

    def publish(self, output_root: str, version: str, staging_root: str) -> None:
        manifests, watermark = _source_metadata(Path(staging_root))
        print(
            publish_manifest(
                Path(output_root),
                version,
                source_manifest_keys=manifests,
                source_watermark=watermark,
            )
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = WorkGraphAnalytics()
        fire.Fire(
            {
                "stage": application.stage,
                "prepare": application.prepare,
                "publish": application.publish,
            },
            command=list(command) if command is not None else None,
            name="work-graph-analytics",
        )
    except (DatasetError, OSError, ValidationError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
