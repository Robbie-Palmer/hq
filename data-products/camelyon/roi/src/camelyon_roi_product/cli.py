from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from camelyon_roi_product.acquisition import acquire_annotations, acquire_artifact, verify_metadata
from camelyon_roi_product.freeze import freeze_snapshot
from camelyon_roi_product.product import PROJECT_DIR, ProductError, publish_product


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

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
        path = acquire_artifact(artifact_id, max_bytes, self.root)
        print(f"Acquired and verified {path.relative_to(self.root)}.")

    def freeze(self, metadata_dir: str) -> None:
        freeze_snapshot(metadata_dir, str(self.root))
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
