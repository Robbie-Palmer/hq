import sys
from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

import pytest
from data_artifacts.files import sha256_file

from ml_evaluation.adapters import load_adapter
from ml_evaluation.contracts import AdapterSpec


@runtime_checkable
class Adapter(Protocol):
    @property
    def adapter_id(self) -> str: ...


class ExampleAdapter:
    adapter_id = "example-v1"


class WrongAdapter:
    pass


def _spec(kind: Literal["builtin", "python_entrypoint"], entrypoint: str) -> AdapterSpec:
    return AdapterSpec(
        adapter_id="example-v1",
        kind=kind,
        entrypoint=entrypoint,
        version="1",
        artifact_sha256=sha256_file(Path(__file__)) if kind == "python_entrypoint" else None,
    )


def test_loads_builtins_and_python_entrypoints() -> None:
    builtins = {"example:Adapter": ExampleAdapter}
    assert (
        load_adapter(
            _spec("builtin", "example:Adapter"), builtins=builtins, expected_type=Adapter
        ).adapter_id
        == "example-v1"
    )
    entrypoint = f"{__name__}:ExampleAdapter"
    assert (
        load_adapter(
            _spec("python_entrypoint", entrypoint), builtins={}, expected_type=Adapter
        ).adapter_id
        == "example-v1"
    )


def test_rejects_unknown_or_invalid_adapters() -> None:
    unknown_spec = _spec("builtin", "missing:Adapter")
    no_builtins: dict[str, type[object]] = {}
    with pytest.raises(ValueError, match="unknown built-in"):
        load_adapter(unknown_spec, builtins=no_builtins, expected_type=Adapter)

    wrong_spec = _spec("builtin", "wrong:Adapter")
    wrong_builtins = {"wrong:Adapter": WrongAdapter}
    with pytest.raises(TypeError, match="required protocol"):
        load_adapter(wrong_spec, builtins=wrong_builtins, expected_type=Adapter)

    invalid_spec = _spec("python_entrypoint", "invalid")
    with pytest.raises(ValueError, match="module:attribute"):
        load_adapter(invalid_spec, builtins=no_builtins, expected_type=Adapter)


def test_rejects_external_adapter_digest_before_import(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module_path = tmp_path / "explosive_adapter.py"
    module_path.write_text('raise RuntimeError("module imported")\n', encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    spec = _spec("python_entrypoint", "explosive_adapter:Adapter").model_copy(
        update={"artifact_sha256": "0" * 64}
    )
    builtins: dict[str, type[object]] = {}
    with pytest.raises(ValueError, match="module SHA-256"):
        load_adapter(spec, builtins=builtins, expected_type=Adapter)
    assert "explosive_adapter" not in sys.modules


def test_rejects_adapter_identity_mismatch() -> None:
    class OtherAdapter:
        adapter_id = "other-v1"

    spec = _spec("builtin", "other:Adapter")
    builtins = {"other:Adapter": OtherAdapter}
    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(spec, builtins=builtins, expected_type=Adapter)
