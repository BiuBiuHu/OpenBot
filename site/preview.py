#!/usr/bin/env python3
"""Serve site/ at /OpenBot/ so local preview matches GitHub Pages."""
from __future__ import annotations

import argparse
import http.server
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
BASE = "/OpenBot"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".txt": "text/plain; charset=utf-8",
    }

    def translate_path(self, path: str) -> str:
        parsed = unquote(urlsplit(path).path)
        if parsed == BASE or parsed.startswith(BASE + "/"):
            rel = parsed[len(BASE) :].lstrip("/")
            return str(SITE / rel)
        return str(SITE / "__missing__")

    def _redirect_root(self) -> bool:
        route = urlsplit(self.path).path
        if route in ("/", ""):
            self.send_response(302)
            self.send_header("Location", BASE + "/")
            self.end_headers()
            return True
        return False

    def do_GET(self):
        if self._redirect_root():
            return
        return super().do_GET()

    def do_HEAD(self):
        if self._redirect_root():
            return
        return super().do_HEAD()

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def main() -> None:
    parser = argparse.ArgumentParser(description="Preview the OpenBot site at /OpenBot/")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"English: http://{args.host}:{args.port}{BASE}/")
    print(f"Chinese: http://{args.host}:{args.port}{BASE}/zh/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
