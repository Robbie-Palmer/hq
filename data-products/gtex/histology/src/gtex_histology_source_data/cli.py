from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from gtex_histology_source_data.product import build_product
from gtex_histology_source_data.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_metadata,
    verify_live_identities,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def acquire(self) -> None:
        evidence = acquire_metadata(self.root)
        print(f"Verified {len(evidence.files)} metadata artifacts. No image bytes were acquired.")

    def index(self) -> None:
        metrics = build_product(self.root)
        counts = metrics["record_counts"]
        print(f"Indexed {counts['gtex-histology-images.jsonl']} GTEx histology API rows.")

    def verify_live(self) -> None:
        print(json.dumps(verify_live_identities(self.root), indent=2, sort_keys=True))


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, SourceDataError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
