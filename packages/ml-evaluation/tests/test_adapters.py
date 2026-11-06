from typing import Literal, Protocol, runtime_checkable

import pytest

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
        artifact_sha256="a" * 64 if kind == "python_entrypoint" else None,
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
    with pytest.raises(ValueError, match="unknown built-in"):
        load_adapter(_spec("builtin", "missing:Adapter"), builtins={}, expected_type=Adapter)
    with pytest.raises(TypeError, match="required protocol"):
        load_adapter(
            _spec("builtin", "wrong:Adapter"),
            builtins={"wrong:Adapter": WrongAdapter},
            expected_type=Adapter,
        )
    with pytest.raises(ValueError, match="module:attribute"):
        load_adapter(_spec("python_entrypoint", "invalid"), builtins={}, expected_type=Adapter)


def test_rejects_adapter_identity_mismatch() -> None:
    class OtherAdapter:
        adapter_id = "other-v1"

    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(
            _spec("builtin", "other:Adapter"),
            builtins={"other:Adapter": OtherAdapter},
            expected_type=Adapter,
        )
