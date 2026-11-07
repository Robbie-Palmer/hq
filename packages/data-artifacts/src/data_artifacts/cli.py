from __future__ import annotations

from collections.abc import Sequence
from importlib import import_module
from pathlib import Path

import fire
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .files import canonical_bytes, sha256_bytes, source_fingerprint


class FingerprintOptions(BaseModel):
    model_config = ConfigDict(strict=True)

    packages: str | tuple[str, ...]
    output: str | None = Field(default=None, min_length=1)


class DataArtifacts:
    def fingerprint(self, packages: str, output: str | None = None) -> None:
        options = FingerprintOptions(packages=packages, output=output)
        package_names = (
            options.packages if isinstance(options.packages, tuple) else options.packages.split(",")
        )
        if any(not package for package in package_names):
            raise ValueError("package names must not be empty")
        fingerprints: dict[str, str] = {}
        for package in package_names:
            module_path = import_module(package).__file__
            if module_path is None:
                raise ValueError(f"package has no source path: {package}")
            fingerprints[package] = source_fingerprint(Path(module_path).resolve().parent)
        fingerprint = (
            next(iter(fingerprints.values()))
            if len(fingerprints) == 1
            else sha256_bytes(canonical_bytes(fingerprints))
        )
        output_path = Path(
            options.output
            if options.output is not None
            else f"outputs/{package_names[0].replace('_', '-')}-source.sha256"
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{fingerprint}\n", encoding="utf-8")


def main(command: Sequence[str] | None = None) -> int:
    try:
        application = DataArtifacts()
        fire.Fire(
            {"fingerprint": application.fingerprint},
            command=list(command) if command is not None else None,
            name="data-artifacts",
        )
    except (ImportError, OSError, TypeError, ValueError, ValidationError) as error:
        print(error)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
