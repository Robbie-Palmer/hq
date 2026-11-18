from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from cryonuseg_source_data.product import PROJECT_DIR, ProductError, publish_product
from cryonuseg_source_data.source_check import check_sources, verify_archive


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def publish(self) -> None:
        metrics = publish_product(self.root)
        print(f"Published {metrics['patch_count']} source-native CryoNuSeg patches.")

    def source_check(self) -> None:
        checks = check_sources(self.root)
        print(f"Checked {checks['gdc_slides_checked']} GDC slide records and publisher metadata.")

    def verify_archive(self, archive: str) -> None:
        verify_archive(Path(archive).resolve(), self.root)
        print("Verified the CryoNuSeg v7 archive.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
