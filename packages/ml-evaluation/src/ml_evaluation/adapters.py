from __future__ import annotations

import importlib
from collections.abc import Callable, Mapping
from importlib.machinery import PathFinder
from pathlib import Path

from data_artifacts.files import sha256_file

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


def _verify_external_artifact(spec: AdapterSpec, module_name: str) -> None:
    if spec.artifact_sha256 is None:
        raise ValueError("python entrypoint adapters require an artifact SHA-256")
    module_path = _adapter_module_path(module_name)
    if sha256_file(module_path) != spec.artifact_sha256:
        raise ValueError("Python adapter module SHA-256 differs from the pinned artifact")


def load_adapter[AdapterT](
    spec: AdapterSpec,
    *,
    builtins: Mapping[str, Callable[[], object]],
    expected_type: type[AdapterT],
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
        _verify_external_artifact(spec, module_name)
        factory = getattr(importlib.import_module(module_name), attribute)
        adapter = factory()
    if not isinstance(adapter, expected_type):
        raise TypeError(f"adapter {spec.adapter_id} does not implement the required protocol")
    typed_adapter = adapter
    if getattr(typed_adapter, "adapter_id", None) != spec.adapter_id:
        raise ValueError("loaded adapter ID differs from the pinned manifest")
    return typed_adapter
