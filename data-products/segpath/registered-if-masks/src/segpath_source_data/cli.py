from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from segpath_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_artifacts,
    acquire_metadata,
    index_metadata,
    verify_metadata_contract,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify(self) -> None:
        summary = verify_metadata_contract(self.root)
        print(
            f"Verified {summary['task_count']} SegPath tasks and "
            f"{summary['artifact_reference_count']} pinned artifact references."
        )

    def acquire_metadata(self) -> None:
        installed = acquire_metadata(self.root)
        print(f"Installed {installed} SegPath metadata files.")

    def acquire_artifacts(self, max_bytes: int = 0) -> None:
        installed = acquire_artifacts(self.root, max_bytes=max_bytes)
        print(f"Installed {installed} SegPath source archives.")

    def index(self) -> None:
        metrics = index_metadata(self.root)
        print(f"Indexed {metrics['records']} source-native SegPath records.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
