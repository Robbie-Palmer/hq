from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from importlib.machinery import PathFinder
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType

from data_artifacts.files import resolve_under, sha256_file

from .contracts import AdapterSpec


def _adapter_module_path(module_name: str) -> Path:
    search_path: list[str] | None = None
    module_spec = None
    parts = module_name.split(".")
    for index in range(len(parts)):
        qualified_name = ".".join(parts[: index + 1])
        module_spec = PathFinder.find_spec(qualified_name, search_path)
        if module_spec is None:
            raise ValueError(f"cannot resolve Python adapter module: {module_name}")
        search_path = (
            list(module_spec.submodule_search_locations)
            if module_spec.submodule_search_locations is not None
            else None
        )
    if module_spec is None or module_spec.origin is None:
        raise ValueError(f"Python adapter module has no hashable file: {module_name}")
    path = Path(module_spec.origin)
    if not path.is_file():
        raise ValueError(f"Python adapter module has no hashable file: {module_name}")
    return path


def _verify_external_artifact(spec: AdapterSpec, module_name: str, root: Path) -> Path:
    if spec.artifact_path is None or spec.artifact_sha256 is None:
        raise ValueError("python entrypoint adapter artifact pin is incomplete")
    module_path = _adapter_module_path(module_name)
    artifact_path = resolve_under(root, spec.artifact_path)
    if artifact_path.resolve() != module_path.resolve():
        raise ValueError("python adapter artifact path differs from the resolved module")
    if sha256_file(artifact_path) != spec.artifact_sha256:
        raise ValueError("python adapter artifact SHA-256 mismatch")
    return artifact_path


def _module_origin(module: ModuleType) -> Path | None:
    module_spec = getattr(module, "__spec__", None)
    origin = getattr(module_spec, "origin", None) or getattr(module, "__file__", None)
    return Path(origin).resolve() if origin is not None else None


def _load_verified_module(module_name: str, artifact_path: Path) -> ModuleType:
    expected_origin = artifact_path.resolve()
    cached = sys.modules.get(module_name)
    if cached is not None:
        if _module_origin(cached) != expected_origin:
            raise ValueError("cached Python adapter module differs from the pinned artifact")
        return cached

    module_spec = spec_from_file_location(module_name, expected_origin)
    if module_spec is None or module_spec.loader is None:
        raise ValueError(f"cannot load Python adapter module: {module_name}")
    module = module_from_spec(module_spec)
    sys.modules[module_name] = module
    try:
        module_spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    if _module_origin(module) != expected_origin:
        sys.modules.pop(module_name, None)
        raise ValueError("loaded Python adapter module differs from the pinned artifact")
    return module


def load_adapter[AdapterT](
    spec: AdapterSpec,
    *,
    builtins: Mapping[str, Callable[[], object]],
    expected_type: type[AdapterT],
    root: Path,
) -> AdapterT:
    if spec.kind == "builtin":
        try:
            adapter = builtins[spec.entrypoint]()
        except KeyError as error:
            raise ValueError(f"unknown built-in adapter: {spec.entrypoint}") from error
    else:
        module_name, separator, attribute = spec.entrypoint.partition(":")
        if not separator:
            raise ValueError("python adapter entrypoint must use module:attribute")
        artifact_path = _verify_external_artifact(spec, module_name, root)
        factory = getattr(_load_verified_module(module_name, artifact_path), attribute)
        adapter = factory()
    if not isinstance(adapter, expected_type):
        raise TypeError(f"adapter {spec.adapter_id} does not implement the required protocol")
    typed_adapter = adapter
    if getattr(typed_adapter, "adapter_id", None) != spec.adapter_id:
        raise ValueError("loaded adapter ID differs from the pinned manifest")
    if getattr(typed_adapter, "adapter_version", None) != spec.version:
        raise ValueError("loaded adapter version differs from the pinned manifest")
    return typed_adapter
