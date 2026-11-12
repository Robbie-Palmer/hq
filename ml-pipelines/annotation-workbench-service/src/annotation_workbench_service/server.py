from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated, Any, cast

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi import Path as PathParameter
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .contracts import Error, HealthResponse, ReviewEvent, ReviewSession
from .repository import ReviewRepository

MAXIMUM_EVENT_BYTES = 65_536
DEFAULT_ORIGINS = frozenset({"http://localhost:3000", "http://127.0.0.1:3000"})


def _error_response(status_code: int, message: str) -> JSONResponse:
    body = Error(error=message)
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


def _error_contract(description: str) -> dict[str, Any]:
    return {"model": Error, "description": description}


def _repository(request: Request) -> ReviewRepository:
    repository = cast(ReviewRepository | None, request.app.state.repository)
    if repository is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "review bundle is not loaded")
    return repository


async def _protected_response(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
    allowed_origins: frozenset[str],
) -> Response:
    origin = request.headers.get("origin")
    if origin is not None and origin not in allowed_origins:
        return _error_response(status.HTTP_403_FORBIDDEN, "origin is not allowed")
    if request.method == "POST":
        raw_length = request.headers.get("content-length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            return _error_response(status.HTTP_400_BAD_REQUEST, "invalid content length")
        if length <= 0 or length > MAXIMUM_EVENT_BYTES:
            return _error_response(
                status.HTTP_413_CONTENT_TOO_LARGE,
                "review event is too large",
            )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def create_app(
    repository: ReviewRepository | None = None,
    allowed_origins: frozenset[str] = DEFAULT_ORIGINS,
) -> FastAPI:
    app = FastAPI(
        title="Annotation Workbench API",
        description=(
            "Reads a versioned annotation-review bundle and appends reviewer events. "
            "The process binds only to loopback, RFC 1918, or tailnet addresses."
        ),
        version="1.0.0",
        contact={"name": "Pathologize"},
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
        summary="Local and tailnet-only review API for versioned annotation bundles.",
        servers=[
            {
                "url": "/",
                "description": "Local or private-tailnet development server",
                "x-internal": True,
            }
        ],
        openapi_tags=[
            {"name": "assets", "description": "Digest-verified review images."},
            {"name": "health", "description": "Process health."},
            {"name": "reviews", "description": "Review sessions and append-only events."},
        ],
    )
    app.state.repository = repository
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
        max_age=600,
    )

    @app.middleware("http")
    async def protect_requests(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        return await _protected_response(request, call_next, allowed_origins)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, error: StarletteHTTPException) -> JSONResponse:
        return _error_response(error.status_code, str(error.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
        return _error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error))

    @app.get(
        "/api/v1/health",
        operation_id="getHealth",
        tags=["health"],
        summary="Check whether the API process is accepting requests",
        description="Returns a fixed response after the FastAPI process accepts the request.",
        responses={500: _error_contract("The API could not complete the health check.")},
    )
    def get_health() -> HealthResponse:
        return HealthResponse()

    @app.get(
        "/api/v1/session",
        operation_id="getReviewSession",
        tags=["reviews"],
        summary="Read the review bundle and each reviewer's latest event",
        description=(
            "Returns the pinned bundle plus the latest event for every item and reviewer pair."
        ),
        responses={
            500: _error_contract("The session could not be read."),
            503: _error_contract("No review bundle is loaded."),
        },
    )
    def get_session(request: Request) -> ReviewSession:
        return _repository(request).session()

    @app.get(
        "/api/v1/assets/{asset_id}",
        operation_id="getReviewAsset",
        tags=["assets"],
        summary="Read one digest-verified image asset",
        response_model=None,
        responses={
            200: {
                "description": "The requested image asset.",
                "content": {
                    media_type: {
                        "schema": {
                            "type": "string",
                            "format": "binary",
                            "maxLength": 50_000_000,
                        }
                    }
                    for media_type in ("image/jpeg", "image/png", "image/webp")
                },
            },
            404: _error_contract("The asset does not exist in this bundle."),
            422: _error_contract("The asset identifier does not satisfy the contract."),
            500: _error_contract("The asset could not be read."),
            503: _error_contract("No review bundle is loaded."),
        },
        description="Returns one image only after bundle loading verifies its SHA-256 digest.",
    )
    def get_asset(
        asset_id: Annotated[str, PathParameter(min_length=1, max_length=256)],
        request: Request,
    ) -> FileResponse:
        try:
            path, media_type = _repository(request).resolve_asset(asset_id)
        except KeyError as error:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "asset was not found") from error
        return FileResponse(path, media_type=media_type)

    @app.post(
        "/api/v1/reviews",
        operation_id="createReviewEvent",
        tags=["reviews"],
        summary="Append a review event",
        description=(
            "Appends one immutable event after checking the bundle references "
            "and supersession chain."
        ),
        status_code=status.HTTP_201_CREATED,
        responses={
            400: _error_contract("The request has an invalid content length."),
            409: _error_contract("The event conflicts with the review history or bundle."),
            413: _error_contract("The event exceeds the size limit."),
            422: _error_contract("The event does not satisfy the review contract."),
            500: _error_contract("The review event could not be saved."),
            503: _error_contract("No review bundle is loaded."),
        },
    )
    def create_review(event: ReviewEvent, request: Request) -> ReviewEvent:
        try:
            return _repository(request).append(event)
        except ValueError as error:
            raise HTTPException(status.HTTP_409_CONFLICT, str(error)) from error

    return app


def serve(
    repository: ReviewRepository,
    host: str,
    port: int,
    allowed_origins: frozenset[str],
) -> None:
    uvicorn.run(
        create_app(repository, allowed_origins),
        host=host,
        port=port,
        access_log=False,
        server_header=False,
    )
