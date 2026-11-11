from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from nci_bpv_source.acquisition import acquire_public_metadata, check_live_metadata
from nci_bpv_source.product import (
    PROJECT_DIR,
    ProductError,
    publish_product,
    validate_authorized_records,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root else PROJECT_DIR

    def build(self) -> None:
        print(json.dumps(publish_product(root=self.root), sort_keys=True))

    def acquire(self) -> None:
        print(json.dumps(acquire_public_metadata(self.root), sort_keys=True))

    def live_check(self) -> None:
        print(json.dumps(check_live_metadata(self.root), sort_keys=True))

    def validate_authorized(self, records: str) -> None:
        metrics = validate_authorized_records(Path(records).resolve())
        print(json.dumps(metrics, sort_keys=True))


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
