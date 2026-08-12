"""Reverse-proxy Pi Coding UI backend routes through the Hermes dashboard.

All upstream I/O is async (httpx) so the Hermes dashboard event loop never
blocks on Pi backend reads, including long-lived SSE streams.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import Final

import httpx
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
        "content-length",
        "content-encoding",
    },
)
# Fail fast when Pi is down; allow long reads for SSE.
BACKEND_TIMEOUT: Final = httpx.Timeout(connect=3.0, read=None, write=30.0, pool=5.0)


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


def response_header_items(response: httpx.Response) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for key, value in response.headers.multi_items():
        if key.lower() in HOP_BY_HOP_HEADERS:
            continue
        items.append((key, value))
    return items


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

    client = httpx.AsyncClient(timeout=BACKEND_TIMEOUT)
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                target_url,
                headers=headers,
                content=body if body else None,
            ),
            stream=True,
        )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError):
        await client.aclose()
        return backend_unavailable_response()
    except httpx.HTTPError:
        await client.aclose()
        return backend_unavailable_response()

    content_type = upstream.headers.get("content-type", "")
    media_type = content_type.split(";")[0].strip() or None
    response_headers = dict(response_header_items(upstream))

    if media_type == "text/event-stream":
        async def stream_events() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(
            stream_events(),
            status_code=upstream.status_code,
            headers=response_headers,
            media_type=media_type,
        )

    try:
        payload = await upstream.aread()
    finally:
        await upstream.aclose()
        await client.aclose()

    return Response(
        content=payload,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=media_type,
    )
