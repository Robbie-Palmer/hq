from pathlib import Path

import pytest

from pathologize_data_registry.schemas import SchemaDriftError, write_schemas


def test_schema_generation_and_drift_check(tmp_path: Path) -> None:
    paths = write_schemas(tmp_path, check=False)

    assert len(paths) == 5
    assert write_schemas(tmp_path, check=True) == paths

    paths[0].write_text("{}\n", encoding="utf-8")
    with pytest.raises(SchemaDriftError):
        write_schemas(tmp_path, check=True)
