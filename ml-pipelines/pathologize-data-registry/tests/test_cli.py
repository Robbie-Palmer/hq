from pathlib import Path

import pytest

from pathologize_data_registry.cli import RegistryApplication, main
from pathologize_data_registry.repository import RegistryValidationError

PROJECT_DIR = Path(__file__).resolve().parents[1]


def test_application_validates_reuses_acquisition_and_checks_schemas(
    capsys: pytest.CaptureFixture[str],
) -> None:
    application = RegistryApplication(str(PROJECT_DIR))

    application.validate_subset()
    application.acquire()
    application.schemas(check=True)

    output = capsys.readouterr().out
    assert "Valid source assets" in output
    assert "downloaded 0, reused 6" in output
    assert "Checked 5 registry schemas" in output


def test_application_rejects_unknown_and_oversize_subsets() -> None:
    application = RegistryApplication(str(PROJECT_DIR))

    with pytest.raises(RegistryValidationError, match="unknown subset"):
        application.acquire(subset="missing")
    with pytest.raises(RegistryValidationError, match="unknown subset"):
        application.validate_subset(subset="missing")
    with pytest.raises(RegistryValidationError, match="above limit"):
        application.acquire(max_bytes=1)


def test_main_returns_status_for_valid_and_invalid_registry(tmp_path: Path) -> None:
    assert main([f"--root={PROJECT_DIR}", "validate"]) == 0
    assert main([f"--root={tmp_path}", "validate"]) == 1
