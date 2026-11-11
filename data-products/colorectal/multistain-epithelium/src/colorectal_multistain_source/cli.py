from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from colorectal_multistain_source.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_artifact,
    index_native_references,
    verify_metadata,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify_metadata(self) -> None:
        report = verify_metadata(self.root)
        dataverse = report["dataverse"]
        if not isinstance(dataverse, dict):
            raise SourceDataError("metadata verification returned no Dataverse result")
        print(
            f"Verified {dataverse['file_count']} publisher files for "
            f"{report['doi']} without archive payloads."
        )

    def index(self) -> None:
        metrics = index_native_references(self.root)
        print(
            f"Indexed {metrics['record_count']} native image-mask pairs from "
            f"{metrics['patient_group_count']} publisher patient groups."
        )

    def acquire(self, artifact_id: str) -> None:
        path = acquire_artifact(artifact_id, self.root)
        print(f"Verified publisher artifact at {path}.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (
        OSError,
        SourceDataError,
        ValidationError,
        ValueError,
    ) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
