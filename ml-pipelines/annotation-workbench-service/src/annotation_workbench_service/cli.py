from __future__ import annotations

import ipaddress
import json
from pathlib import Path
from typing import Any

import fire

from .repository import ReviewRepository
from .server import create_app, serve

TAILNET = ipaddress.ip_network("100.64.0.0/10")
PRIVATE_NETWORKS = tuple(
    ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def _validate_bind_host(host: str) -> None:
    if host == "localhost":
        return
    try:
        address = ipaddress.ip_address(host)
    except ValueError as error:
        raise ValueError("host must be a loopback, RFC 1918, or tailnet IP address") from error
    if (
        address.is_loopback
        or address in TAILNET
        or any(address in network for network in PRIVATE_NETWORKS)
    ):
        return
    raise ValueError("host must be a loopback, RFC 1918, or tailnet IP address")


class Commands:
    def validate(self, bundle: str) -> dict[str, Any]:
        repository = ReviewRepository(Path(bundle))
        session = repository.session()
        return {
            "batch_id": session.bundle.batch_id,
            "items": len(session.bundle.items),
            "assets": len(session.bundle.assets),
            "latest_reviews": len(session.latest_reviews),
        }

    def serve(
        self,
        bundle: str,
        events: str | None = None,
        host: str = "127.0.0.1",
        port: int = 8765,
        allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000",
    ) -> None:
        _validate_bind_host(host)
        if not 1024 <= port <= 65535:
            raise ValueError("port must be between 1024 and 65535")
        repository = ReviewRepository(Path(bundle), Path(events) if events is not None else None)
        origins = frozenset(value.strip() for value in allowed_origins.split(",") if value.strip())
        serve(repository, host, port, origins)

    def openapi(self, output: str = "openapi.json", check: bool = False) -> dict[str, Any]:
        path = Path(output)
        rendered = json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n"
        if check:
            if not path.is_file() or path.read_text(encoding="utf-8") != rendered:
                raise RuntimeError(
                    "OpenAPI contract is stale; run "
                    "mise //ml-pipelines/annotation-workbench-service:openapi:generate"
                )
        else:
            path.write_text(rendered, encoding="utf-8")
        return {"path": path.as_posix(), "bytes": len(rendered), "check": check}


def main() -> None:
    fire.Fire(Commands)
