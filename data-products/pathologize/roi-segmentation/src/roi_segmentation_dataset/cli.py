from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from roi_segmentation_dataset.product import PROJECT_DIR, ProductError, build_product


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def build(self) -> None:
        metrics = build_product(self.root)
        print(f"Built {metrics['record_count']} slide-coordinate ROI records.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
