from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from work_graph_analytics.manifest import DatasetError, stage_dataset
from work_graph_analytics.publication import ensure_new_version, publish_manifest


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="work-graph-analytics")
    commands = parser.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("stage", help="verify raw manifests and stage dbt inputs")
    stage.add_argument("raw_root", type=Path)
    stage.add_argument("staging_root", type=Path)
    prepare = commands.add_parser("prepare", help="reserve a new immutable model version")
    prepare.add_argument("output_root", type=Path)
    prepare.add_argument("version")
    publish = commands.add_parser("publish", help="publish a complete model-version manifest")
    publish.add_argument("output_root", type=Path)
    publish.add_argument("version")
    publish.add_argument("staging_root", type=Path)
    return parser


def _source_metadata(staging_root: Path) -> tuple[list[str], int]:
    path = staging_root / "manifests.ndjson"
    try:
        rows = [json.loads(line) for line in path.read_text().splitlines()]
    except (OSError, json.JSONDecodeError) as error:
        raise DatasetError("cannot read staged source manifests") from error
    if not rows:
        raise DatasetError("staged source manifests are empty")
    return [row["manifest_key"] for row in rows], rows[-1]["through_sequence"]


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "stage":
            print(json.dumps(stage_dataset(args.raw_root, args.staging_root), sort_keys=True))
        elif args.command == "prepare":
            print(ensure_new_version(args.output_root, args.version))
        else:
            manifests, watermark = _source_metadata(args.staging_root)
            print(
                publish_manifest(
                    args.output_root,
                    args.version,
                    source_manifest_keys=manifests,
                    source_watermark=watermark,
                )
            )
    except DatasetError as error:
        _parser().error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
