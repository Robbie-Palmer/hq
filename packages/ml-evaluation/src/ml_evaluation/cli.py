from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import fire
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .artifacts import source_fingerprint


class FingerprintOptions(BaseModel):
    model_config = ConfigDict(strict=True)

    source: str | None = Field(default=None, min_length=1)
    output: str = Field(min_length=1)


class MlEvaluation:
    def fingerprint(
        self,
        source: str | None = None,
        output: str = "outputs/ml-evaluation-source.sha256",
    ) -> None:
        options = FingerprintOptions(source=source, output=output)
        source_path = (
            Path(options.source) if options.source is not None else Path(__file__).resolve().parent
        )
        output_path = Path(options.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{source_fingerprint(source_path)}\n", encoding="utf-8")


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = MlEvaluation()
        fire.Fire(
            {"fingerprint": application.fingerprint},
            command=list(command) if command is not None else None,
            name="ml-evaluation",
        )
    except (OSError, TypeError, ValueError, ValidationError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
