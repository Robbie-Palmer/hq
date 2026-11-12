from pathlib import Path

import pytest
from pydantic import ValidationError

from pannuke_source_data.cli import Application, VerifyMetadataArguments


def test_application_validates_and_resolves_root(tmp_path: Path) -> None:
    application = Application(root=str(tmp_path))

    assert application.root == tmp_path.resolve()


def test_application_rejects_missing_root(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="Path does not point to a directory"):
        Application(root=str(tmp_path / "missing"))


def test_verify_metadata_arguments_resolve_relative_output(tmp_path: Path) -> None:
    arguments = VerifyMetadataArguments(output="outputs/evidence.json")

    assert arguments.resolved_output(tmp_path) == (tmp_path / "outputs/evidence.json").resolve()


def test_verify_metadata_arguments_preserve_disabled_output(tmp_path: Path) -> None:
    arguments = VerifyMetadataArguments(output=None)

    assert arguments.resolved_output(tmp_path) is None
