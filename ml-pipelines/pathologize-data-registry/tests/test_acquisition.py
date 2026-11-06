from pathlib import Path
from urllib.request import Request

import pytest

from pathologize_data_registry.acquisition import AcquisitionError, acquire_asset
from pathologize_data_registry.models import AssetRecord


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

    assert acquire_asset(asset, destination, opener=open_memory) is True
    assert destination.read_bytes() == content
    assert acquire_asset(asset, destination, opener=open_memory) is False
    assert len(requests) == 1
    assert not (tmp_path / ".synthetic.dcm.part").exists()


def test_acquisition_removes_partial_file_on_checksum_failure(tmp_path: Path) -> None:
    expected = asset_for(b"expected")
    destination = tmp_path / expected.relative_path

    with pytest.raises(AcquisitionError, match="downloaded"):
        acquire_asset(expected, destination, opener=lambda _request: MemoryResponse(b"wrong"))

    assert not destination.exists()
    assert not (tmp_path / ".synthetic.dcm.part").exists()
