from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import BinaryIO, Protocol, cast
from urllib.request import Request, urlopen

from pathologize_data_registry.models import AssetRecord
from pathologize_data_registry.repository import sha256_file


class Response(Protocol):
    def read(self, size: int = -1) -> bytes: ...

    def close(self) -> None: ...


Opener = Callable[[Request], Response]


class AcquisitionError(RuntimeError):
    pass


def _default_opener(request: Request) -> Response:
    response = urlopen(  # noqa: S310 - registry validation allowlists the URL.
        request, timeout=60
    )
    return cast(Response, response)


def _copy_and_hash(source: Response, destination: BinaryIO) -> tuple[int, str]:
    import hashlib

    digest = hashlib.sha256()
    byte_count = 0
    while chunk := source.read(1024 * 1024):
        destination.write(chunk)
        digest.update(chunk)
        byte_count += len(chunk)
    return byte_count, digest.hexdigest()


def asset_matches(path: Path, asset: AssetRecord) -> bool:
    return (
        not path.is_symlink()
        and path.is_file()
        and path.stat().st_size == asset.bytes
        and sha256_file(path) == asset.sha256
    )


def _require_download_matches(asset: AssetRecord, byte_count: int, sha256: str) -> None:
    if byte_count != asset.bytes:
        raise AcquisitionError(
            f"{asset.relative_path}: expected {asset.bytes} bytes, downloaded {byte_count}"
        )
    if sha256 != asset.sha256:
        raise AcquisitionError(
            f"{asset.relative_path}: expected SHA-256 {asset.sha256}, downloaded {sha256}"
        )


def acquire_asset(
    asset: AssetRecord,
    destination: Path,
    *,
    opener: Opener = _default_opener,
) -> bool:
    if asset_matches(destination, asset):
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.part")
    temporary.unlink(missing_ok=True)
    request = Request(  # noqa: S310 - Pydantic requires HTTPS and the registry allowlists the base.
        str(asset.source_url),
        headers={"User-Agent": "pathologize-data-registry/0.1 (+public-data-acquisition)"},
    )
    try:
        with closing(opener(request)) as response, temporary.open("wb") as output:
            byte_count, sha256 = _copy_and_hash(response, output)
            output.flush()
            os.fsync(output.fileno())
        _require_download_matches(asset, byte_count, sha256)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return True
