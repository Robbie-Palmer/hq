from __future__ import annotations

import urllib.request
from http.client import HTTPMessage
from typing import IO, override
from urllib.parse import urlsplit


class HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    @override
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        if urlsplit(newurl).scheme.lower() != "https":
            raise ValueError("model artifact redirect must use HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)
