from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from pannuke_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_dataset,
    index_dataset,
    verify_publisher_metadata,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify_metadata(self, output: str | None = "outputs/publisher-metadata.json") -> None:
        output_path = None if output is None else (self.root / output).resolve()
        evidence = verify_publisher_metadata(self.root, output_path)
        print(f"Verified metadata for {len(evidence.archives)} PanNuke fold archives.")

    def acquire(self) -> None:
        archives = acquire_dataset(self.root)
        print(f"Verified {len(archives)} PanNuke fold archives.")

    def index(self) -> None:
        metrics = index_dataset(self.root)
        print(f"Indexed {metrics['record_count']} source-native PanNuke records.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
