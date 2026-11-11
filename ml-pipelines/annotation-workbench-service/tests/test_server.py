from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import annotation_workbench_service.cli as cli
from annotation_workbench_service.cli import Commands
from annotation_workbench_service.repository import ReviewRepository
from annotation_workbench_service.server import create_app

PNG = b"\x89PNG\r\n\x1a\nsynthetic"


def _bundle(root: Path) -> Path:
    assets = root / "assets"
    assets.mkdir(parents=True)
    (assets / "source.png").write_bytes(PNG)
    (assets / "proposal.png").write_bytes(PNG + b"proposal")
    values = {
        "schema_version": "1.0.0",
        "batch_id": "synthetic-batch",
        "created_at": "2026-11-10T00:00:00Z",
        "provenance": {
            "producer": "test-adapter",
            "producer_version": "1",
            "producer_revision": "a" * 64,
            "dataset_id": "synthetic",
            "dataset_revision": "fixture-1",
            "derivation": "Synthetic test fixture",
        },
        "assets": [
            {
                "id": "source:item-1",
                "kind": "source",
                "path": "assets/source.png",
                "media_type": "image/png",
                "sha256": hashlib.sha256(PNG).hexdigest(),
                "width": 32,
                "height": 32,
            },
            {
                "id": "proposal:item-1:cellsam",
                "kind": "proposal",
                "path": "assets/proposal.png",
                "media_type": "image/png",
                "sha256": hashlib.sha256(PNG + b"proposal").hexdigest(),
                "width": 32,
                "height": 32,
            },
        ],
        "items": [
            {
                "id": "item-1",
                "source_asset_id": "source:item-1",
                "proposals": [
                    {
                        "id": "item-1:cellsam",
                        "asset_id": "proposal:item-1:cellsam",
                        "role": "primary",
                        "model_name": "CellSAM general",
                        "model_revision": "v1.2",
                        "model_license": "Modified-Apache-2.0-NonCommercial",
                        "source_box_clipped": True,
                    }
                ],
                "context": {
                    "dataset_id": "synthetic",
                    "source_item_id": "image-1",
                    "source_annotation_id": "box-1",
                    "split": "train",
                    "site_id": "fixture",
                    "class_name": "nucleus",
                    "bbox_xyxy": [4, 5, 20, 22],
                    "coordinate_space": "pixel_xyxy_inclusive",
                },
            }
        ],
    }
    path = root / "bundle.json"
    path.write_text(json.dumps(values), encoding="utf-8")
    return path


def _review_event() -> dict[str, Any]:
    return {
        "schema_version": "1.0.0",
        "event_id": "11111111-1111-4111-8111-111111111111",
        "batch_id": "synthetic-batch",
        "item_id": "item-1",
        "reviewer_id": "reviewer-a",
        "reviewer_kind": "human",
        "created_at": "2026-11-10T00:00:00Z",
        "object_decision": "valid_nucleus",
        "mask_decision": "accept",
        "selected_proposal_id": "item-1:cellsam",
        "notes": "",
    }


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    repository = ReviewRepository(_bundle(tmp_path))
    return TestClient(create_app(repository, frozenset({"http://localhost:3000"})))


def test_api_reads_session_assets_health_and_openapi(client: TestClient) -> None:
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    session = client.get(
        "/api/v1/session",
        headers={"Origin": "http://localhost:3000"},
    )
    assert session.status_code == 200
    assert session.json()["bundle"]["batch_id"] == "synthetic-batch"

    asset = client.get("/api/v1/assets/source%3Aitem-1")
    assert asset.status_code == 200
    assert asset.content == PNG
    assert asset.headers["Cache-Control"] == "no-store"

    contract = client.get("/api/v1/openapi.json").json()
    assert contract["openapi"] == "3.1.0"
    assert contract["paths"]["/api/v1/reviews"]["post"]["operationId"] == ("createReviewEvent")


def test_api_appends_review_and_rejects_stale_write(client: TestClient) -> None:
    first = client.post("/api/v1/reviews", json=_review_event())
    assert first.status_code == 201
    assert first.json()["mask_decision"] == "accept"

    stale_event = _review_event()
    stale_event["event_id"] = "22222222-2222-4222-8222-222222222222"
    stale = client.post("/api/v1/reviews", json=stale_event)
    assert stale.status_code == 409
    assert "does not supersede" in stale.json()["error"]


def test_api_restricts_origins_payloads_and_routes(client: TestClient) -> None:
    forbidden = client.get(
        "/api/v1/session",
        headers={"Origin": "https://example.test"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json() == {"error": "origin is not allowed"}

    missing = client.get("/api/v1/assets/missing")
    assert missing.status_code == 404
    assert missing.json() == {"error": "asset was not found"}

    too_large = client.post(
        "/api/v1/reviews",
        content=b"x",
        headers={"Content-Length": "65537", "Content-Type": "application/json"},
    )
    assert too_large.status_code == 413

    preflight = client.options(
        "/api/v1/session",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"


def test_cli_validates_private_bind_and_writes_openapi(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bundle = _bundle(tmp_path)
    calls: list[tuple[str, int, frozenset[str]]] = []

    def fake_serve(
        _repository: ReviewRepository,
        host: str,
        port: int,
        origins: frozenset[str],
    ) -> None:
        calls.append((host, port, origins))

    monkeypatch.setattr(cli, "serve", fake_serve)
    commands = Commands()

    assert commands.validate(bundle.as_posix())["items"] == 1
    commands.serve(
        bundle.as_posix(),
        host="100.100.100.100",
        port=8765,
        allowed_origins="http://100.100.100.100:3000",
    )
    assert calls == [
        (
            "100.100.100.100",
            8765,
            frozenset({"http://100.100.100.100:3000"}),
        )
    ]

    public_bind = ".".join(("0", "0", "0", "0"))
    with pytest.raises(ValueError, match="tailnet IP"):
        commands.serve(bundle.as_posix(), host=public_bind)
    invalid_port = 80
    with pytest.raises(ValueError, match="port"):
        commands.serve(bundle.as_posix(), port=invalid_port)

    contract = tmp_path / "openapi.json"
    commands.openapi(contract.as_posix())
    assert json.loads(contract.read_text())["openapi"] == "3.1.0"
    assert commands.openapi(contract.as_posix(), check=True)["check"] is True
