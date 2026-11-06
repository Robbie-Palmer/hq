from __future__ import annotations

import os
from collections.abc import Callable
from contextlib import closing
from http.client import HTTPMessage
from pathlib import Path
from typing import IO, BinaryIO, Protocol, cast, override
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pathologize_data_registry.models import AssetRecord, source_url_is_allowlisted
from pathologize_data_registry.repository import sha256_file


class Response(Protocol):
    def read(self, size: int = -1) -> bytes: ...

    def close(self) -> None: ...


Opener = Callable[[Request], Response]


class AcquisitionError(RuntimeError):
    pass


class _AllowlistedRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_base_urls: tuple[str, ...]) -> None:
        self.allowed_base_urls = allowed_base_urls
        super().__init__()

    @override
    def redirect_request(
        self,
        req: Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> Request | None:
        if not source_url_is_allowlisted(newurl, self.allowed_base_urls):
            raise AcquisitionError(f"redirect URL is not allowlisted: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _default_opener(request: Request, allowed_base_urls: tuple[str, ...]) -> Response:
    response = build_opener(_AllowlistedRedirectHandler(allowed_base_urls)).open(
        request, timeout=60
    )
    return cast(Response, response)


def _copy_and_hash(source: Response, destination: BinaryIO, max_bytes: int) -> tuple[int, str]:
    import hashlib

    digest = hashlib.sha256()
    byte_count = 0
    while chunk := source.read(min(1024 * 1024, max_bytes - byte_count + 1)):
        if byte_count + len(chunk) > max_bytes:
            return max_bytes + 1, digest.hexdigest()
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
    allowed_base_urls: tuple[str, ...],
    opener: Opener | None = None,
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
    if not source_url_is_allowlisted(request.full_url, allowed_base_urls):
        raise AcquisitionError(f"source URL is not allowlisted: {request.full_url}")
    try:
        response = (
            opener(request) if opener is not None else _default_opener(request, allowed_base_urls)
        )
        with closing(response) as source, temporary.open("wb") as output:
            byte_count, sha256 = _copy_and_hash(source, output, asset.bytes)
            output.flush()
            os.fsync(output.fileno())
        _require_download_matches(asset, byte_count, sha256)
        temporary.replace(destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    return True
