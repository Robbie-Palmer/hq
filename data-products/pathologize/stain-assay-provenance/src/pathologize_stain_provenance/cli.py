from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from pathologize_stain_provenance.validation import (
    PROJECT_DIR,
    verify_metadata,
    write_schemas,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def schemas(self, check: bool = False) -> None:
        write_schemas(self.root, check=check)
        message = (
            "Stain provenance schemas are current." if check else "Wrote stain provenance schemas."
        )
        print(message)

    def verify(self) -> None:
        summary = verify_metadata(self.root)
        print(json.dumps(summary.model_dump(mode="json"), sort_keys=True))


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (OSError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
