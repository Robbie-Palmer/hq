import sys
from pathlib import Path
from types import ModuleType
from typing import Literal, Protocol, runtime_checkable

import pytest
from data_artifacts.files import sha256_file

from ml_evaluation.adapters import load_adapter
from ml_evaluation.contracts import AdapterSpec


@runtime_checkable
class Adapter(Protocol):
    @property
    def adapter_id(self) -> str: ...

    @property
    def adapter_version(self) -> str: ...


class ExampleAdapter:
    adapter_id = "example-v1"
    adapter_version = "1"


class WrongAdapter:
    pass


PROJECT_ROOT = Path(__file__).parents[1]


def _spec(kind: Literal["builtin", "python_entrypoint"], entrypoint: str) -> AdapterSpec:
    artifact_path = "tests/test_adapters.py" if kind == "python_entrypoint" else None
    return AdapterSpec(
        adapter_id="example-v1",
        kind=kind,
        entrypoint=entrypoint,
        version="1",
        artifact_path=artifact_path,
        artifact_sha256=(
            sha256_file(PROJECT_ROOT / artifact_path) if artifact_path is not None else None
        ),
    )


def test_loads_builtins_and_python_entrypoints() -> None:
    builtins = {"example:Adapter": ExampleAdapter}
    assert (
        load_adapter(
            _spec("builtin", "example:Adapter"),
            builtins=builtins,
            expected_type=Adapter,
            root=PROJECT_ROOT,
        ).adapter_id
        == "example-v1"
    )
    assert (
        load_adapter(
            _spec("python_entrypoint", f"{__name__}:ExampleAdapter"),
            builtins={},
            expected_type=Adapter,
            root=PROJECT_ROOT,
        ).adapter_id
        == "example-v1"
    )


def test_rejects_unknown_or_invalid_adapters() -> None:
    missing_spec = _spec("builtin", "missing:Adapter")
    with pytest.raises(ValueError, match="unknown built-in"):
        load_adapter(
            missing_spec,
            builtins={},
            expected_type=Adapter,
            root=PROJECT_ROOT,
        )

    wrong_spec = _spec("builtin", "wrong:Adapter")
    with pytest.raises(TypeError, match="required protocol"):
        load_adapter(
            wrong_spec,
            builtins={"wrong:Adapter": WrongAdapter},
            expected_type=Adapter,
            root=PROJECT_ROOT,
        )

    invalid_spec = _spec("python_entrypoint", "invalid")
    with pytest.raises(ValueError, match="module:attribute"):
        load_adapter(
            invalid_spec,
            builtins={},
            expected_type=Adapter,
            root=PROJECT_ROOT,
        )


def test_rejects_external_adapter_digest_before_import(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module_path = tmp_path / "explosive_adapter.py"
    module_path.write_text('raise RuntimeError("module imported")\n', encoding="utf-8")
    monkeypatch.syspath_prepend(str(tmp_path))
    spec = AdapterSpec(
        adapter_id="example-v1",
        kind="python_entrypoint",
        entrypoint="explosive_adapter:Adapter",
        version="1",
        artifact_path=module_path.name,
        artifact_sha256="0" * 64,
    )
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        load_adapter(spec, builtins={}, expected_type=Adapter, root=tmp_path)
    assert "explosive_adapter" not in sys.modules


def test_loads_uncached_adapter_from_verified_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module_name = "verified_external_adapter"
    module_path = tmp_path / f"{module_name}.py"
    module_path.write_text(
        "class Adapter:\n"
        "    adapter_id = 'example-v1'\n"
        "    adapter_version = '1'\n",
        encoding="utf-8",
    )
    monkeypatch.syspath_prepend(str(tmp_path))
    spec = AdapterSpec(
        adapter_id="example-v1",
        kind="python_entrypoint",
        entrypoint=f"{module_name}:Adapter",
        version="1",
        artifact_path=module_path.name,
        artifact_sha256=sha256_file(module_path),
    )

    try:
        adapter = load_adapter(spec, builtins={}, expected_type=Adapter, root=tmp_path)
        assert adapter.adapter_id == "example-v1"
    finally:
        sys.modules.pop(module_name, None)


def test_rejects_cached_adapter_from_a_different_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module_name = "cached_adapter_collision"
    pinned_root = tmp_path / "pinned"
    pinned_root.mkdir()
    pinned_path = pinned_root / f"{module_name}.py"
    pinned_path.write_text(
        "class Adapter:\n"
        "    adapter_id = 'example-v1'\n"
        "    adapter_version = '1'\n",
        encoding="utf-8",
    )
    cached_path = tmp_path / "cached.py"
    cached_path.write_text("# wrong cached module\n", encoding="utf-8")
    cached = ModuleType(module_name)
    cached.__file__ = str(cached_path)
    monkeypatch.setitem(sys.modules, module_name, cached)
    monkeypatch.syspath_prepend(str(pinned_root))
    spec = AdapterSpec(
        adapter_id="example-v1",
        kind="python_entrypoint",
        entrypoint=f"{module_name}:Adapter",
        version="1",
        artifact_path=pinned_path.name,
        artifact_sha256=sha256_file(pinned_path),
    )

    with pytest.raises(ValueError, match="cached Python adapter module"):
        load_adapter(spec, builtins={}, expected_type=Adapter, root=pinned_root)


def test_rejects_adapter_identity_mismatch() -> None:
    class OtherAdapter:
        adapter_id = "other-v1"
        adapter_version = "1"

    other_spec = _spec("builtin", "other:Adapter")
    with pytest.raises(ValueError, match="adapter ID"):
        load_adapter(
            other_spec,
            builtins={"other:Adapter": OtherAdapter},
            expected_type=Adapter,
            root=PROJECT_ROOT,
        )


def test_rejects_false_artifact_path_and_version_pins(tmp_path: Path) -> None:
    entrypoint = f"{__name__}:ExampleAdapter"
    bad_path = _spec("python_entrypoint", entrypoint).model_copy(
        update={"artifact_path": "tests/test_contracts.py"}
    )
    with pytest.raises(ValueError, match="path differs"):
        load_adapter(bad_path, builtins={}, expected_type=Adapter, root=PROJECT_ROOT)

    bad_digest = _spec("python_entrypoint", entrypoint).model_copy(
        update={"artifact_sha256": "0" * 64}
    )
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        load_adapter(bad_digest, builtins={}, expected_type=Adapter, root=PROJECT_ROOT)

    wrong_version = _spec("builtin", "example:Adapter").model_copy(update={"version": "2"})
    with pytest.raises(ValueError, match="version"):
        load_adapter(
            wrong_version,
            builtins={"example:Adapter": ExampleAdapter},
            expected_type=Adapter,
            root=tmp_path,
        )
