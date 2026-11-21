#!/usr/bin/env python3
"""Verify that the deployment serves complete local canvas assets."""

import argparse
import hashlib
import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


class DeploymentError(Exception):
    pass


def verify_assets(base_url, host):
    parts = urlsplit(base_url)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise DeploymentError("Asset URL must be HTTP(S) without credentials, query parameters or fragments.")
    if not host or any(character.isspace() for character in host):
        raise DeploymentError("Asset checks require a valid deployment Host header.")
    def fetch(resource, limit):
        request = Request(urljoin(base_url.rstrip("/") + "/", resource), headers={"Host": host})
        try:
            with urlopen(request, timeout=10) as response:
                final = urlsplit(response.geturl())
                allowed_hosts = {parts.hostname, urlsplit("//" + host).hostname}
                if final.hostname not in allowed_hosts:
                    raise DeploymentError("Canvas asset unexpectedly redirects outside the deployment host.")
                body = response.read(limit + 1)
                content_type = response.headers.get_content_type()
                if response.status != 200 or not body.strip() or body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
                    raise DeploymentError(f"Canvas asset is missing or replaced by the SPA index: {resource}")
                return body, content_type
        except (HTTPError, URLError, TimeoutError):
            raise DeploymentError(f"Canvas asset is not reachable: {resource}") from None

    for resource in ("drawio/js/app.min.js", "whiteboard-assets/subset/subset-worker.chunk.js"):
        _, content_type = fetch(resource, 8192)
        if content_type not in {"application/javascript", "text/javascript", "application/x-javascript"}:
            raise DeploymentError(f"Canvas asset is not served as JavaScript: {resource}")
    body, content_type = fetch("whiteboard-assets/font-licenses/manifest.json", 1024 * 1024)
    manifest = json.loads(body)
    if content_type != "application/json" or not isinstance(manifest, dict) or manifest.get("package") != "@excalidraw/excalidraw" or manifest.get("version") != "0.18.1" or not isinstance(manifest.get("families"), dict):
        raise DeploymentError("The local whiteboard font manifest is missing or incompatible.")
    representative = next((family["fontFiles"] for family in manifest["families"].values() if isinstance(family, dict) and isinstance(family.get("fontFiles"), dict) and family["fontFiles"]), None)
    if not representative:
        raise DeploymentError("The local whiteboard font manifest contains no font files.")
    filename, expected_hash = next(iter(representative.items()))
    if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+\.woff2", filename) or ".." in filename or not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", expected_hash):
        raise DeploymentError("The whiteboard font manifest contains an unsafe path or invalid checksum.")
    font, _ = fetch("whiteboard-assets/fonts/" + filename, 4 * 1024 * 1024)
    if len(font) > 4 * 1024 * 1024 or not font.startswith(b"wOF2") or hashlib.sha256(font).hexdigest() != expected_hash.lower():
        raise DeploymentError("The local whiteboard font is missing, invalid or differs from its manifest checksum.")
    print("Room canvas assets verified.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url")
    parser.add_argument("host")
    args = parser.parse_args()
    try:
        verify_assets(args.base_url, args.host)
        return 0
    except DeploymentError as error:
        print(str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print("Unable to verify room canvas assets.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
