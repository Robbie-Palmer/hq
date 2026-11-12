from __future__ import annotations

import ftplib
import json
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, cast, override
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel, ConfigDict, Field


class AcquisitionError(RuntimeError):
    pass


class RemoteFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    file_name: str = Field(min_length=1)
    bytes: int = Field(ge=1)
    locator: str = Field(min_length=1)


class _RejectRedirects(HTTPRedirectHandler):
    @override
    def redirect_request(self, *_args: object, **_kwargs: object) -> Request | None:
        raise AcquisitionError("metadata URL redirects are not allowed")


def _open_without_redirects(request: Request, timeout: float) -> Any:
    opener = build_opener(_RejectRedirects())
    return opener.open(request, timeout=timeout)


@dataclass(frozen=True, slots=True)
class HttpsMetadataClient:
    allowed_hosts: frozenset[str]
    user_agent: str
    timeout_seconds: float = 120
    accept: str = "application/json, application/xml, text/plain, text/html"

    def get_bytes(self, url: str) -> bytes:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in self.allowed_hosts:
            raise AcquisitionError(f"metadata URL is not allowlisted: {url}")
        request = Request(  # noqa: S310 - exact HTTPS hosts are allowlisted above.
            url,
            headers={"Accept": self.accept, "User-Agent": self.user_agent},
        )
        with _open_without_redirects(request, self.timeout_seconds) as response:
            return cast(bytes, response.read())

    def get_json_object(self, url: str) -> dict[str, Any]:
        value = json.loads(self.get_bytes(url))
        if not isinstance(value, dict):
            raise AcquisitionError(f"metadata endpoint did not return an object: {url}")
        return cast(dict[str, Any], value)


def list_anonymous_ftp_files(
    host: str,
    directory: str,
    *,
    timeout_seconds: float = 120,
) -> list[RemoteFile]:
    lines: list[str] = []
    # Use anonymous FTP only to retain publisher byte sizes when HTTPS has no equivalent listing.
    with ftplib.FTP(host, timeout=timeout_seconds) as client:  # noqa: S321  # NOSONAR
        client.login()
        client.cwd(directory)
        client.retrlines("LIST", lines.append)

    entries: list[RemoteFile] = []
    for line in lines:
        fields = line.split(maxsplit=8)
        if len(fields) != 9 or not fields[0].startswith("-"):
            raise AcquisitionError(f"unexpected FTP listing row: {line}")
        file_name = fields[8]
        entries.append(
            RemoteFile(
                file_name=file_name,
                bytes=int(fields[4]),
                # Preserve the publisher locator as metadata; this function never opens it.
                locator=f"ftp://{host}{directory.rstrip('/')}/{file_name}",  # NOSONAR
            )
        )
    if len({item.file_name for item in entries}) != len(entries):
        raise AcquisitionError("FTP listing contains duplicate basenames")
    return sorted(entries, key=lambda item: item.file_name)


class _DirectoryLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.basenames: set[str] = set()

    @override
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = next((value for name, value in attrs if name == "href"), None)
        if href is not None and href != "" and not href.startswith(("?", "/")):
            self.basenames.add(href)


def html_directory_basenames(payload: bytes) -> set[str]:
    parser = _DirectoryLinkParser()
    parser.feed(payload.decode("utf-8"))
    return parser.basenames


def normalize_line_endings(payload: bytes) -> bytes:
    return payload.replace(b"\r\n", b"\n").rstrip(b"\n") + b"\n"
