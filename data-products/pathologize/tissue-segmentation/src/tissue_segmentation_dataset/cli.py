from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import BaseModel, ValidationError

from tissue_segmentation_dataset.product import PROJECT_DIR, ProductError, build_product


class ApplicationInput(BaseModel):
    root: Path | None = None


class Application:
    def __init__(self, root: str | None = None) -> None:
        command_input = ApplicationInput(root=root)
        self.root = command_input.root.resolve() if command_input.root is not None else PROJECT_DIR

    def build(self) -> None:
        metrics = build_product(self.root)
        print(
            f"Built {metrics['record_count']} tissue-segmentation contract records across "
            f"{metrics['source_count']} source interfaces."
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
