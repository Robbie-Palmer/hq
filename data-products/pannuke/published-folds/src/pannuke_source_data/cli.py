from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import BaseModel, ConfigDict, DirectoryPath, ValidationError, field_validator

from pannuke_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_dataset,
    index_dataset,
    verify_publisher_metadata,
)


class RootArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    root: DirectoryPath

    @field_validator("root")
    @classmethod
    def resolve_root(cls, root: Path) -> Path:
        return root.resolve()


class VerifyMetadataArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    output: Path | None

    def resolved_output(self, root: Path) -> Path | None:
        return None if self.output is None else (root / self.output).resolve()


class Application:
    def __init__(self, root: str | None = None) -> None:
        arguments = RootArguments(root=PROJECT_DIR if root is None else root)
        self.root = arguments.root

    def verify_metadata(self, output: str | None = "outputs/publisher-metadata.json") -> None:
        arguments = VerifyMetadataArguments(output=output)
        output_path = arguments.resolved_output(self.root)
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
