from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

import fire
import requests
from pydantic import ValidationError

from skin_frozen_ffpe_preview.source import (
    PROJECT_DIR,
    SourceDataError,
    acquire_file,
    publish_contracts,
    publish_index,
    verify_live_metadata,
    verify_live_payloads,
)


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def contracts(self) -> None:
        publish_contracts(self.root)
        print("Regenerated source manifest and native record schemas.")

    def index(self) -> None:
        metrics = publish_index(self.root)
        print(json.dumps(metrics, sort_keys=True))

    def live_check(self) -> None:
        print(json.dumps(verify_live_metadata(self.root), sort_keys=True))

    def payload_check(self) -> None:
        print(json.dumps(verify_live_payloads(self.root), sort_keys=True))

    def acquire(self, filename: str) -> None:
        path = acquire_file(filename, self.root)
        print(f"Verified source file at {path}.")


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (
        OSError,
        requests.RequestException,
        SourceDataError,
        ValidationError,
        ValueError,
    ) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
