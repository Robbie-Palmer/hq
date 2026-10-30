from __future__ import annotations

import json
from pathlib import Path

import duckdb
import pytest

from work_graph_analytics.cli import main
from work_graph_analytics.publication import MODEL_FILES

FIXTURE = Path(__file__).parents[1] / "fixtures/raw"


def write_models(version_root: Path) -> None:
    for index, filename in enumerate(MODEL_FILES):
        escaped = (version_root / filename).as_posix().replace("'", "''")
        duckdb.sql(f"copy (select {index} as value) to '{escaped}' (format parquet)")


def test_stage_prepare_and_publish_commands(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    staged = tmp_path / "staged"
    output = tmp_path / "output"

    assert main(["stage", str(FIXTURE), str(staged)]) == 0
    assert json.loads(capsys.readouterr().out)["watermark"] == 14
    assert main(["prepare", str(output), "v1"]) == 0
    assert str(output / "v1") in capsys.readouterr().out
    write_models(output / "v1")
    assert main(["publish", str(output), "v1", str(staged)]) == 0
    assert str(output / "v1/manifest.json") in capsys.readouterr().out


def test_commands_report_dataset_errors(tmp_path: Path) -> None:
    assert main(["stage", str(tmp_path / "absent"), str(tmp_path / "stage")]) == 2

    staged = tmp_path / "empty-stage"
    staged.mkdir()
    output = tmp_path / "output"
    output.mkdir()
    assert main(["publish", str(output), "absent", str(staged)]) == 2

    (staged / "manifests.ndjson").write_text("")
    assert main(["publish", str(output), "absent", str(staged)]) == 2
