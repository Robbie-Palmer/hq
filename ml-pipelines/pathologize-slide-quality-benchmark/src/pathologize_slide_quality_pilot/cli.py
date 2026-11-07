from __future__ import annotations

from collections.abc import Sequence

import fire

from pathologize_slide_quality_pilot.pilot import run, verify


class PilotApplication:
    def run(self) -> None:
        run()

    def verify(self) -> None:
        verify()


def main(command: Sequence[str] | None = None) -> int:
    try:
        fire.Fire(PilotApplication, command=list(command) if command is not None else None)
    except (OSError, ValueError) as error:
        print(error)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
