from pathlib import Path

import pytest

from ml_evaluation.artifacts import read_json
from ml_evaluation.contracts import AdapterSpec
from ml_evaluation.schema_artifacts import write_schemas


def test_writes_and_checks_schema_artifacts(tmp_path: Path) -> None:
    models = {"adapter.schema.json": AdapterSpec}
    write_schemas(models, root=tmp_path)
    schema_path = tmp_path / "schemas/adapter.schema.json"
    assert read_json(schema_path)["title"] == "AdapterSpec"
    write_schemas(models, root=tmp_path, check=True)
    schema_path.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON Schema drift"):
        write_schemas(models, root=tmp_path, check=True)
