from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import ValidationError

from cptac_lscc_source.acquisition import (
    AcquisitionError,
    refresh_snapshots,
    verify_live_releases,
)
from cptac_lscc_source.product import PROJECT_DIR, ProductError, publish_product


class Application:
    def __init__(self, root: str | None = None) -> None:
        self.root = Path(root).resolve() if root is not None else PROJECT_DIR

    def refresh(self) -> None:
        manifest = refresh_snapshots(self.root)
        print(f"Refreshed {len(manifest.files)} metadata-only source snapshots.")

    def verify_live(self) -> None:
        releases = verify_live_releases(self.root)
        print(
            "Verified pinned release identities: "
            + ", ".join(f"{repository} {release}" for repository, release in releases.items())
        )

    def publish(self) -> None:
        metrics = publish_product(self.root)
        print(
            f"Published {metrics['participant_count']} CPTAC-LSCC participants and "
            f"{metrics['tcia_slide_count']} source-native slide references."
        )


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(Application, command=list(command) if command is not None else None)
    except (AcquisitionError, OSError, ProductError, ValidationError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
