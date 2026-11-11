from __future__ import annotations

import zipfile
from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from sicapv2_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_archive,
    index_archive,
    verify_publisher_metadata,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify_metadata(self) -> None:
        evidence = verify_publisher_metadata(self.root)
        print(
            f"Verified Mendeley version {evidence['publisher_version']} metadata without "
            "downloading SICAPv2.zip."
        )

    def acquire(self) -> None:
        path = acquire_archive(self.root)
        print(f"Verified SICAPv2 source archive at {path}.")

    def index(self) -> None:
        metrics = index_archive(self.root)
        print(
            f"Indexed {metrics['patch_count']} SICAPv2 patches from "
            f"{metrics['slide_count']} slides and {metrics['patient_count']} patients."
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError, zipfile.BadZipFile) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
