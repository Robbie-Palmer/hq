"""Minimal HTTP service used by the NixOS module prototype."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Final

SERVICE_NAME: Final = "python"


def health_payload() -> bytes:
    """Return the stable health response."""
    return (json.dumps({"service": SERVICE_NAME, "status": "ok"}) + "\n").encode()


class HealthHandler(BaseHTTPRequestHandler):
    """Serve a health response without exposing directory contents."""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path != "/health":
            self.send_error(404)
            return

        payload = health_payload()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        """Keep the prototype quiet under Nix checks."""


def main() -> None:
    """Run the service using host-supplied, non-secret network settings."""
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8081"))
    ThreadingHTTPServer((host, port), HealthHandler).serve_forever()


if __name__ == "__main__":
    main()
