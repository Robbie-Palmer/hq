from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from gdc_tcga_image_genomics.acquisition import refresh_product
from gdc_tcga_image_genomics.models import PartitionAssignment
from gdc_tcga_image_genomics.product import (
    PROJECT_DIR,
    ProductError,
    load_native_records,
    publish_product,
    validate_partitions,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def verify(self) -> None:
        metrics = publish_product(
            self.root / "fixtures/release-46.0",
            self.root / "outputs/verification",
            root=self.root,
        )
        print(f"Verified {metrics['record_count']} pinned GDC metadata records.")

    def refresh(self) -> None:
        result = refresh_product(self.root)
        print(json.dumps(result, sort_keys=True))

    def validate_partitions(self, assignments: str, records: str) -> None:
        assignment_path = Path(assignments).resolve()
        record_path = Path(records).resolve()
        values = [
            PartitionAssignment.model_validate_json(line)
            for line in assignment_path.read_text(encoding="utf-8").splitlines()
            if line
        ]
        validate_partitions(load_native_records(record_path), values)
        print(f"Validated {len(values)} patient-grouped partition assignments.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
