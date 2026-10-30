"""Command-line entry points used by mise and DVC."""

from __future__ import annotations

import argparse
from collections.abc import Callable

from .pipeline import (
    build_corpus,
    error_analysis,
    evaluate,
    extract,
    match,
    normalize,
    safety_and_render,
    verify,
    write_schemas,
)


def _schema_command(args: argparse.Namespace) -> None:
    write_schemas(check=bool(args.check))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="financial-document-idp",
        description="Reproduce and verify the financial-document IDP evaluation",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    commands: dict[str, Callable[[], None]] = {
        "build-corpus": build_corpus,
        "safety-render": safety_and_render,
        "extract": extract,
        "normalize": normalize,
        "match": match,
        "evaluate": evaluate,
        "error-analysis": error_analysis,
        "verify": verify,
    }
    for name, command in commands.items():
        command_parser = subparsers.add_parser(name)
        command_parser.set_defaults(handler=lambda _args, callback=command: callback())
    schema_parser = subparsers.add_parser("schemas")
    schema_parser.add_argument("--check", action="store_true")
    schema_parser.set_defaults(handler=_schema_command)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
