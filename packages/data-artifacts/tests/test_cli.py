from pathlib import Path

from data_artifacts import cli


def test_cli_writes_source_fingerprint(tmp_path: Path) -> None:
    output = tmp_path / "outputs/source.sha256"
    assert cli.main(["fingerprint", "data_artifacts", "--output", str(output)]) == 0
    assert len(output.read_text(encoding="utf-8").strip()) == 64


def test_cli_returns_error_for_missing_package(tmp_path: Path) -> None:
    output = tmp_path / "source.sha256"
    assert cli.main(["fingerprint", "missing_package", "--output", str(output)]) == 2


def test_cli_combines_package_fingerprints(tmp_path: Path) -> None:
    output = tmp_path / "combined.sha256"
    assert (
        cli.main(
            [
                "fingerprint",
                "data_artifacts,pydantic",
                "--output",
                str(output),
            ]
        )
        == 0
    )
    assert len(output.read_text(encoding="utf-8").strip()) == 64
