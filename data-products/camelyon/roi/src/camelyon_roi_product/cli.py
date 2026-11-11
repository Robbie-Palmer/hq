from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import (
    BaseModel,
    ConfigDict,
    DirectoryPath,
    Field,
    PositiveInt,
    ValidationError,
    field_validator,
)

from camelyon_roi_product.acquisition import acquire_annotations, acquire_artifact, verify_metadata
from camelyon_roi_product.freeze import freeze_snapshot
from camelyon_roi_product.product import PROJECT_DIR, ProductError, publish_product


class RootArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    root: DirectoryPath

    @field_validator("root")
    @classmethod
    def resolve_root(cls, root: Path) -> Path:
        return root.resolve()


class AcquireArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    artifact_id: str = Field(min_length=1)
    max_bytes: PositiveInt


class FreezeArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    metadata_dir: DirectoryPath

    @field_validator("metadata_dir")
    @classmethod
    def resolve_metadata_dir(cls, metadata_dir: Path) -> Path:
        return metadata_dir.resolve()


class Application:
    def __init__(self, root: str | None = None) -> None:
        arguments = RootArguments(root=PROJECT_DIR if root is None else root)
        self.root = arguments.root

    def publish(self) -> None:
        metrics = publish_product(self.root)
        print(f"Published {metrics['record_count']} source-native CAMELYON records.")

    def verify_metadata(self) -> None:
        count = verify_metadata(self.root)
        print(f"Verified {count} official CAMELYON metadata records without dataset bytes.")

    def acquire_annotations(self) -> None:
        count = acquire_annotations(self.root)
        print(f"Indexed {count} publisher-native CAMELYON XML lesion annotations.")

    def acquire(self, artifact_id: str, max_bytes: int) -> None:
        arguments = AcquireArguments(artifact_id=artifact_id, max_bytes=max_bytes)
        path = acquire_artifact(arguments.artifact_id, arguments.max_bytes, self.root)
        print(f"Acquired and verified {path.relative_to(self.root)}.")

    def freeze(self, metadata_dir: str) -> None:
        arguments = FreezeArguments(metadata_dir=metadata_dir)
        freeze_snapshot(str(arguments.metadata_dir), str(self.root))
        print("Refreshed CAMELYON contracts from the reviewed publisher metadata snapshot.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
