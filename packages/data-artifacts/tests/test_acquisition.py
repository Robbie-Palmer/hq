from __future__ import annotations

from collections.abc import Callable
from urllib.request import Request

import pytest

from data_artifacts import acquisition
from data_artifacts.acquisition import (
    AcquisitionError,
    HttpsMetadataClient,
    html_directory_basenames,
    list_anonymous_ftp_files,
    normalize_line_endings,
)


def _client() -> HttpsMetadataClient:
    return HttpsMetadataClient(
        allowed_hosts=frozenset({"metadata.example"}),
        user_agent="data-artifacts-test/1.0",
    )


def test_https_metadata_client_reads_allowlisted_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        def __enter__(self) -> Response:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def read(self) -> bytes:
            return b'{"accession":"example"}'

    def fake_urlopen(request: Request, timeout: float) -> Response:
        assert request.full_url == "https://metadata.example/record"
        assert request.get_header("User-agent") == "data-artifacts-test/1.0"
        assert timeout == 120
        return Response()

    monkeypatch.setattr(acquisition, "urlopen", fake_urlopen)

    assert _client().get_json_object("https://metadata.example/record") == {"accession": "example"}


@pytest.mark.parametrize(
    "url",
    ["http://metadata.example/record", "https://untrusted.example/record"],
)
def test_https_metadata_client_rejects_unallowlisted_urls(url: str) -> None:
    with pytest.raises(AcquisitionError, match="not allowlisted"):
        _client().get_bytes(url)


def test_https_metadata_client_requires_json_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(HttpsMetadataClient, "get_bytes", lambda _self, _url: b"[]")

    with pytest.raises(AcquisitionError, match="did not return an object"):
        _client().get_json_object("https://metadata.example/record")


def test_anonymous_ftp_listing_is_sorted_and_retains_locators(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FtpClient:
        def __init__(self, host: str, timeout: float) -> None:
            assert host == "ftp.example"
            assert timeout == 30

        def __enter__(self) -> FtpClient:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def login(self) -> None:
            return None

        def cwd(self, directory: str) -> None:
            assert directory == "/archive/example/"

        def retrlines(self, command: str, callback: Callable[[str], object]) -> None:
            assert command == "LIST"
            callback("-rw-r--r-- 1 ftp ftp 20 Jan 01 00:00 b.raw")
            callback("-rw-r--r-- 1 ftp ftp 10 Jan 01 00:00 a.raw")

    monkeypatch.setattr(acquisition.ftplib, "FTP", FtpClient)

    entries = list_anonymous_ftp_files("ftp.example", "/archive/example/", timeout_seconds=30)

    assert [(entry.file_name, entry.bytes) for entry in entries] == [
        ("a.raw", 10),
        ("b.raw", 20),
    ]
    assert entries[0].locator == "ftp://ftp.example/archive/example/a.raw"


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        (["drwxr-xr-x 1 ftp ftp 10 Jan 01 00:00 nested"], "unexpected FTP listing row"),
        (
            [
                "-rw-r--r-- 1 ftp ftp 10 Jan 01 00:00 repeated.raw",
                "-rw-r--r-- 1 ftp ftp 10 Jan 01 00:00 repeated.raw",
            ],
            "duplicate basenames",
        ),
    ],
)
def test_anonymous_ftp_listing_rejects_ambiguous_rows(
    monkeypatch: pytest.MonkeyPatch, rows: list[str], message: str
) -> None:
    class FtpClient:
        def __init__(self, _host: str, timeout: float) -> None:
            assert timeout == 120

        def __enter__(self) -> FtpClient:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def login(self) -> None:
            return None

        def cwd(self, _directory: str) -> None:
            return None

        def retrlines(self, _command: str, callback: Callable[[str], object]) -> None:
            for row in rows:
                callback(row)

    monkeypatch.setattr(acquisition.ftplib, "FTP", FtpClient)

    with pytest.raises(AcquisitionError, match=message):
        list_anonymous_ftp_files("ftp.example", "/archive/example")


def test_directory_links_and_line_endings_are_normalized() -> None:
    payload = (
        b'<a href="?sort=name">sort</a><a href="/archive">parent</a>'
        b'<a href="a.raw">a</a><span>ignored</span><a>b</a>'
    )

    assert html_directory_basenames(payload) == {"a.raw"}
    assert normalize_line_endings(b"first\r\nsecond\r\n\r\n") == b"first\nsecond\n"
