from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import BaseModel, ConfigDict, ValidationError

from pxd064700_source.acquisition import (
    PROJECT_DIR,
    AcquisitionError,
    refresh_snapshots,
    verify_live_identity,
)
from pxd064700_source.product import ProductError, publish_product


class ApplicationArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    root: Path | None = None


class Application:
    def __init__(self, root: str | None = None) -> None:
        arguments = ApplicationArguments.model_validate({"root": root})
        self.root = arguments.root.resolve() if arguments.root is not None else PROJECT_DIR

    def refresh(self) -> None:
        manifest = refresh_snapshots(self.root)
        print(f"Refreshed {len(manifest.files)} public metadata snapshots.")

    def verify_live(self) -> None:
        identity = verify_live_identity(self.root)
        print(
            f"Verified {identity['accession']} with {identity['announcement_file_count']} "
            f"announced files and {identity['ftp_file_count']} FTP entries."
        )

    def publish(self) -> None:
        metrics = publish_product(self.root)
        print(
            f"Published {metrics['run_count']} runs and "
            f"{metrics['artifact_count']} metadata-only artifact references."
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (AcquisitionError, OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
