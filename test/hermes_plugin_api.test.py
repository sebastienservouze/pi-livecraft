"""Tests for the Hermes dashboard reverse proxy to the Pi backend."""

from __future__ import annotations

import importlib.util
import os
import socket
import sys
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
PLUGIN_API_PATH = REPO_ROOT / "dashboard" / "plugin_api.py"


def _load_plugin_api():
    spec = importlib.util.spec_from_file_location("plugin_api", PLUGIN_API_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["plugin_api"] = module
    spec.loader.exec_module(module)
    return module


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class _BackendHandler(BaseHTTPRequestHandler):
    events_sent = 0

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        if self.path == "/api/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b"data: {\"kind\":\"event\"}\n\n")
            type(self).events_sent += 1
            return
        if self.path == "/api/sessions":
            # Slow-but-complete response must not freeze the dashboard event loop.
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b"[]")
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        if self.path == "/api/terminal":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body or b"{}")
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, _format, *_args) -> None:
        return


class PluginApiHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.port = _free_port()
        self.env = patch.dict(
            os.environ,
            {"PI_LIVECRAFT_BACKEND_PORT": str(self.port)},
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.plugin_api = _load_plugin_api()

    def test_backend_target_url_maps_plugin_paths_to_loopback_backend(self) -> None:
        self.assertEqual(
            self.plugin_api.backend_target_url("api/sessions", "limit=5"),
            f"http://127.0.0.1:{self.port}/api/sessions?limit=5",
        )


class PluginApiRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        try:
            import httpx  # noqa: F401
            from fastapi import FastAPI  # noqa: F401
            from fastapi.testclient import TestClient  # noqa: F401
        except ImportError as error:
            raise unittest.SkipTest("fastapi and httpx are required for proxy route tests") from error

        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.port = _free_port()
        self.env = patch.dict(
            os.environ,
            {"PI_LIVECRAFT_BACKEND_PORT": str(self.port)},
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.plugin_api = _load_plugin_api()

        server = HTTPServer(("127.0.0.1", self.port), _BackendHandler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)

        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        app = FastAPI()
        app.include_router(
            self.plugin_api.router,
            prefix="/api/plugins/hermes-pi-coding-ui-plugin",
        )
        self.client = TestClient(app)

    def test_proxy_forwards_health_json(self) -> None:
        response = self.client.get("/api/plugins/hermes-pi-coding-ui-plugin/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_proxy_forwards_sessions_json(self) -> None:
        response = self.client.get("/api/plugins/hermes-pi-coding-ui-plugin/api/sessions")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_proxy_streams_events(self) -> None:
        with self.client.stream(
            "GET",
            "/api/plugins/hermes-pi-coding-ui-plugin/api/events",
        ) as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["content-type"].split(";")[0], "text/event-stream")
            body = b"".join(response.iter_bytes())
        self.assertIn(b"data:", body)

    def test_proxy_returns_502_when_backend_is_down(self) -> None:
        with patch.dict(os.environ, {"PI_LIVECRAFT_BACKEND_PORT": "1"}, clear=False):
            plugin_api = _load_plugin_api()
            from fastapi import FastAPI
            from fastapi.testclient import TestClient

            app = FastAPI()
            app.include_router(
                plugin_api.router,
                prefix="/api/plugins/hermes-pi-coding-ui-plugin",
            )
            client = TestClient(app)
            response = client.get("/api/plugins/hermes-pi-coding-ui-plugin/api/health")
            self.assertEqual(response.status_code, 502)
            self.assertIn("unavailable", response.json()["error"])


if __name__ == "__main__":
    unittest.main()
