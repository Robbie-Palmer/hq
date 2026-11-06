from pathlib import Path

from ml_evaluation import cli


def test_cli_writes_source_fingerprint(tmp_path: Path) -> None:
    source = tmp_path / "src"
    source.mkdir()
    (source / "module.py").write_text("VALUE = 1\n", encoding="utf-8")
    output = tmp_path / "outputs/source.sha256"
    assert cli.main(["fingerprint", "--source", str(source), "--output", str(output)]) == 0
    assert len(output.read_text(encoding="utf-8").strip()) == 64


def test_cli_returns_error_for_missing_source(tmp_path: Path) -> None:
    output = tmp_path / "source.sha256"
    assert cli.main(["fingerprint", "--source", "missing", "--output", str(output)]) == 2
