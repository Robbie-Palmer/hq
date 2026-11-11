from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from paip2019_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    index_native_release,
    publish_contract,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def publish(self) -> None:
        metrics = publish_contract(self.root)
        print(f"Published the {metrics['case_count']}-case PAIP 2019 source contract.")

    def index(
        self,
        receipt: str = "data/native/source-receipt.jsonl",
        output: str = "outputs/private",
    ) -> None:
        metrics = index_native_release(
            self.root,
            receipt_path=self.root / receipt,
            output_root=self.root / output,
        )
        print(f"Indexed {metrics['case_count']} source-native PAIP 2019 cases.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
