from pathlib import Path

import pytest
from pydantic import BaseModel

from data_artifacts.files import read_json
from data_artifacts.schemas import write_schemas


class ExampleRecord(BaseModel):
    name: str


def test_schema_artifacts_detect_drift(tmp_path: Path) -> None:
    models = {"example.schema.json": ExampleRecord}
    schema_path = tmp_path / "schemas/example.schema.json"
    write_schemas(models, root=tmp_path)
    assert read_json(schema_path)["title"] == "ExampleRecord"
    write_schemas(models, root=tmp_path, check=True)
    schema_path.write_text("{}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON Schema drift"):
        write_schemas(models, root=tmp_path, check=True)
