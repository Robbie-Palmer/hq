from __future__ import annotations

from collections.abc import Sequence

import fire
from pydantic import BaseModel, ConfigDict, DirectoryPath, Field, PositiveInt, ValidationError

from camelyon_roi_product.acquisition import (
    acquire_annotation_archives,
    acquire_annotations,
    acquire_artifact,
    acquire_metadata,
    index_annotations,
    verify_metadata,
)
from camelyon_roi_product.product import PROJECT_DIR, ProductError, publish_product


class RootArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    root: DirectoryPath


class AcquireArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    artifact_id: str = Field(min_length=1)
    max_bytes: PositiveInt


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

    def acquire_metadata(self) -> None:
        count = acquire_metadata(self.root)
        print(f"Acquired {count} pinned official CAMELYON metadata records.")

    def acquire_annotation_archives(self) -> None:
        count = acquire_annotation_archives(self.root)
        print(f"Acquired {count} pinned publisher XML annotation archives.")

    def index_annotations(self) -> None:
        count = index_annotations(self.root)
        print(f"Indexed {count} publisher-native CAMELYON XML lesion annotations.")

    def acquire_annotations(self) -> None:
        count = acquire_annotations(self.root)
        print(f"Indexed {count} publisher-native CAMELYON XML lesion annotations.")

    def acquire(self, artifact_id: str, max_bytes: int) -> None:
        arguments = AcquireArguments(artifact_id=artifact_id, max_bytes=max_bytes)
        path = acquire_artifact(arguments.artifact_id, arguments.max_bytes, self.root)
        print(f"Acquired and verified {path.relative_to(self.root)}.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
