from __future__ import annotations

import importlib
from collections.abc import Callable, Mapping

from .contracts import AdapterSpec


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
        factory = getattr(importlib.import_module(module_name), attribute)
        adapter = factory()
    if not isinstance(adapter, expected_type):
        raise TypeError(f"adapter {spec.adapter_id} does not implement the required protocol")
    typed_adapter = adapter
    if getattr(typed_adapter, "adapter_id", None) != spec.adapter_id:
        raise ValueError("loaded adapter ID differs from the pinned manifest")
    return typed_adapter
