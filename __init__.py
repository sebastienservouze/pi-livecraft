"""Hermes plugin entrypoint for Pi Coding UI."""

from __future__ import annotations

from .hermes_plugin import runtime


def _handle_command(args) -> None:
    command = getattr(args, "pi_coding_ui_command", None)
    if command == "start":
        foreground = bool(getattr(args, "foreground", False))
        code = runtime.start(foreground=foreground)
        if code:
            raise SystemExit(code)
        return
    if command == "stop":
        code = runtime.stop()
        if code:
            raise SystemExit(code)
        return
    if command == "status":
        code = runtime.status()
        if code:
            raise SystemExit(code)
        return
    raise SystemExit("Usage: hermes pi-coding-ui <start|stop|status>")


def _setup_argparse(subparser) -> None:
    subparsers = subparser.add_subparsers(dest="pi_coding_ui_command")

    start_parser = subparsers.add_parser(
        "start",
        help="Start the Pi Coding UI backend",
    )
    start_parser.add_argument(
        "--foreground",
        action="store_true",
        help="Run in the foreground instead of background (default on Windows)",
    )

    subparsers.add_parser("stop", help="Stop the Pi Coding UI backend")
    subparsers.add_parser("status", help="Show backend runtime status")

    subparser.set_defaults(func=_handle_command)


def register(ctx) -> None:
    ctx.register_cli_command(
        name="pi-coding-ui",
        help="Manage the Pi Coding UI backend",
        setup_fn=_setup_argparse,
        handler_fn=_handle_command,
    )
