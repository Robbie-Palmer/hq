from http.client import HTTPMessage
from io import BytesIO
from pathlib import Path
from urllib.request import Request

import pytest

from pathologize_data_registry.acquisition import (
    AcquisitionError,
    _AllowlistedRedirectHandler,
    acquire_asset,
)
from pathologize_data_registry.models import AssetRecord

ALLOWED_BASE_URLS = ("https://public.example.test/",)


class MemoryResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.offset = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = len(self.content)
        chunk = self.content[self.offset : self.offset + size]
        self.offset += len(chunk)
        return chunk

    def close(self) -> None:
        return None


def asset_for(content: bytes) -> AssetRecord:
    import hashlib

    return AssetRecord(
        relative_path="synthetic.dcm",
        source_url="https://public.example.test/synthetic.dcm",
        bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        source_etag="0" * 32,
        sop_instance_uid="1.2.3.4",
        image_role="volume_primary",
    )


def test_acquisition_is_atomic_and_reuses_verified_file(tmp_path: Path) -> None:
    content = b"synthetic public source bytes"
    asset = asset_for(content)
    destination = tmp_path / asset.relative_path
    requests: list[Request] = []

    def open_memory(request: Request) -> MemoryResponse:
        requests.append(request)
        return MemoryResponse(content)

    assert (
        acquire_asset(asset, destination, allowed_base_urls=ALLOWED_BASE_URLS, opener=open_memory)
        is True
    )
    assert destination.read_bytes() == content
    assert (
        acquire_asset(asset, destination, allowed_base_urls=ALLOWED_BASE_URLS, opener=open_memory)
        is False
    )
    assert len(requests) == 1
    assert not (tmp_path / ".synthetic.dcm.part").exists()


def test_acquisition_removes_partial_file_on_checksum_failure(tmp_path: Path) -> None:
    expected = asset_for(b"expected")
    destination = tmp_path / expected.relative_path

    with pytest.raises(AcquisitionError, match="downloaded"):
        acquire_asset(
            expected,
            destination,
            allowed_base_urls=ALLOWED_BASE_URLS,
            opener=lambda _request: MemoryResponse(b"wrong"),
        )

    assert not destination.exists()
    assert not (tmp_path / ".synthetic.dcm.part").exists()


def test_acquisition_rejects_source_outside_allowlist(tmp_path: Path) -> None:
    asset = asset_for(b"expected")

    with pytest.raises(AcquisitionError, match="source URL is not allowlisted"):
        acquire_asset(
            asset,
            tmp_path / asset.relative_path,
            allowed_base_urls=("https://public.example.test/other/",),
            opener=lambda _request: MemoryResponse(b"expected"),
        )


def test_acquisition_rejects_redirect_outside_allowlist() -> None:
    handler = _AllowlistedRedirectHandler(ALLOWED_BASE_URLS)

    with pytest.raises(AcquisitionError, match="redirect URL is not allowlisted"):
        handler.redirect_request(
            Request("https://public.example.test/synthetic.dcm"),
            BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "https://untrusted.example.test/synthetic.dcm",
        )


def test_acquisition_stops_after_declared_byte_count(tmp_path: Path) -> None:
    expected = asset_for(b"expected")
    destination = tmp_path / expected.relative_path
    response = MemoryResponse(b"expected plus unbounded content")

    with pytest.raises(AcquisitionError, match="downloaded 9"):
        acquire_asset(
            expected,
            destination,
            allowed_base_urls=ALLOWED_BASE_URLS,
            opener=lambda _request: response,
        )

    assert response.offset == expected.bytes + 1
    assert not destination.exists()
