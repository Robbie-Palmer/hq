from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from grandqc_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_archive,
    index_archive,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def acquire(self) -> None:
        path = acquire_archive(self.root)
        print(f"Verified GrandQC source archive at {path}.")

    def index(self) -> None:
        metrics = index_archive(self.root)
        print(
            f"Indexed {metrics['paired_patch_count']} native patch pairs from "
            f"{metrics['nonempty_source_group_count']} source groups."
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
