from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from nucls_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_dataset,
    index_dataset,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def acquire(self) -> None:
        evidence = acquire_dataset(self.root)
        print(f"Verified {len(evidence.archives)} NuCLS source archives.")

    def index(self) -> None:
        metrics = index_dataset(self.root)
        print(f"Indexed {metrics['record_count']} source-native NuCLS records.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
