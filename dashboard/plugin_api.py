"""Reverse-proxy Pi Coding UI backend routes through the Hermes dashboard."""

from __future__ import annotations

import asyncio
import os
import urllib.error
import urllib.request
from collections.abc import AsyncIterator, Iterator
from typing import Final

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

PLUGIN_ID: Final = "hermes-pi-coding-ui-plugin"
DEFAULT_BACKEND_PORT: Final = 43_121
HOP_BY_HOP_HEADERS: Final = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
    },
)
SSE_CHUNK_SIZE: Final = 8192


def backend_base_url() -> str:
    raw = os.environ.get("PI_LIVECRAFT_BACKEND_PORT", str(DEFAULT_BACKEND_PORT))
    try:
        port = int(raw)
    except ValueError as error:
        raise RuntimeError(
            f"PI_LIVECRAFT_BACKEND_PORT must be an integer, got {raw!r}."
        ) from error
    if port < 1 or port > 65_535:
        raise RuntimeError(f"PI_LIVECRAFT_BACKEND_PORT out of range: {port}.")
    return f"http://127.0.0.1:{port}"


def backend_target_url(path: str, query: str) -> str:
    normalized = path.lstrip("/")
    target = f"{backend_base_url()}/{normalized}" if normalized else f"{backend_base_url()}/"
    if query:
        target = f"{target}?{query}"
    return target


def forward_request_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lowered = name.lower()
        if lowered in HOP_BY_HOP_HEADERS or lowered == "host":
            continue
        headers[name] = value
    return headers


def response_header_items(response: urllib.response.addinfourl) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for key, value in response.headers.items():
        if key.lower() in HOP_BY_HOP_HEADERS:
            continue
        items.append((key, value))
    return items


def iter_response_chunks(response: urllib.response.addinfourl) -> Iterator[bytes]:
    while True:
        chunk = response.read(SSE_CHUNK_SIZE)
        if not chunk:
            break
        yield chunk


def open_backend_request(
    *,
    method: str,
    target_url: str,
    headers: dict[str, str],
    body: bytes | None,
) -> urllib.response.addinfourl:
    request = urllib.request.Request(
        target_url,
        data=body,
        headers=headers,
        method=method,
    )
    return urllib.request.urlopen(request, timeout=300)


def backend_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": "Pi Coding UI backend is unavailable on this server.",
            "hint": "Run `hermes pi-coding-ui start` on the host running Hermes dashboard.",
        },
    )


router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "OPTIONS"])
async def proxy_backend(path: str, request: Request) -> Response:
    target_url = backend_target_url(path, request.url.query)
    body = await request.body()
    headers = forward_request_headers(request)

    try:
        response = await asyncio.to_thread(
            open_backend_request,
            method=request.method,
            target_url=target_url,
            headers=headers,
            body=body if body else None,
        )
    except urllib.error.HTTPError as error:
        payload = error.read()
        return Response(
            content=payload,
            status_code=error.code,
            headers={
                key: value
                for key, value in error.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            },
            media_type=error.headers.get_content_type(),
        )
    except urllib.error.URLError:
        return backend_unavailable_response()

    content_type = response.headers.get_content_type()
    if content_type == "text/event-stream":
        async def stream_events() -> AsyncIterator[bytes]:
            try:
                for chunk in iter_response_chunks(response):
                    yield chunk
            finally:
                response.close()

        return StreamingResponse(
            stream_events(),
            status_code=response.status,
            headers=dict(response_header_items(response)),
            media_type=content_type,
        )

    payload = response.read()
    response.close()
    return Response(
        content=payload,
        status_code=response.status,
        headers=dict(response_header_items(response)),
        media_type=content_type,
    )
