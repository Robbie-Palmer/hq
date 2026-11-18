from pathlib import Path

import pytest
from pydantic import ValidationError

from sicapv2_source_data.cli import Application, ApplicationArguments
from sicapv2_source_data.source import PROJECT_DIR


def test_application_validates_and_resolves_root(tmp_path: Path) -> None:
    assert Application(root=str(tmp_path)).root == tmp_path.resolve()


def test_application_preserves_default_root() -> None:
    assert Application().root == PROJECT_DIR


def test_application_arguments_reject_invalid_root() -> None:
    with pytest.raises(ValidationError):
        ApplicationArguments.model_validate({"root": object()})
