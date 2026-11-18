from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from monusac_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_dataset,
    index_dataset,
    probe_remote_artifacts,
    verify_metadata,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify_metadata(self, output: str | None = None) -> None:
        destination = Path(output) if output is not None else None
        evidence = verify_metadata(self.root, destination)
        print(
            f"Verified {len(evidence['artifact_refs'])} source artifacts and "
            f"{sum(evidence['patient_roles'].values())} publisher patient roles "
            "without dataset bytes."
        )

    def probe_remote(self) -> None:
        evidence = probe_remote_artifacts(self.root)
        print(f"Verified public response metadata for {len(evidence)} source artifacts.")

    def acquire(self) -> None:
        evidence = acquire_dataset(self.root)
        print(f"Verified {len(evidence.artifacts)} native MoNuSAC source artifacts.")

    def index(self) -> None:
        metrics = index_dataset(self.root)
        print(f"Indexed {metrics['record_count']} source-native MoNuSAC image records.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
