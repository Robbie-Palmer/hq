import io
import urllib.request
from http.client import HTTPMessage

import pytest

from ultralytics_extensions.downloads import HttpsOnlyRedirectHandler


def test_redirect_handler_rejects_non_https_destination() -> None:
    handler = HttpsOnlyRedirectHandler()

    with pytest.raises(ValueError, match="redirect must use HTTPS"):
        handler.redirect_request(
            urllib.request.Request("https://example.test/model.pt"),
            io.BytesIO(),
            302,
            "Found",
            HTTPMessage(),
            "http://example.test/model.pt",
        )


def test_redirect_handler_allows_https_destination() -> None:
    handler = HttpsOnlyRedirectHandler()

    request = handler.redirect_request(
        urllib.request.Request("https://example.test/model.pt"),
        io.BytesIO(),
        302,
        "Found",
        HTTPMessage(),
        "https://cdn.example.test/model.pt",
    )

    assert request is not None
    assert request.full_url == "https://cdn.example.test/model.pt"
