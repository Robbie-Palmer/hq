from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from bcss_source_data.acquisition import acquire_annotations, acquire_masks
from bcss_source_data.product import PROJECT_DIR, ProductError, publish_product


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def publish(self) -> None:
        metrics = publish_product(self.root)
        print(
            f"Published {metrics['record_count']} source-native BCSS records from "
            f"{metrics['patient_count']} patients."
        )

    def acquire_masks(self, max_bytes: int = 40_000_000) -> None:
        installed = acquire_masks(self.root, max_bytes=max_bytes)
        print(f"Installed {installed} verified BCSS masks.")

    def acquire_annotations(self, max_bytes: int = 4_000_000_000) -> None:
        installed = acquire_annotations(self.root, max_bytes=max_bytes)
        print(f"Installed {installed} verified BCSS annotation artifacts.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
