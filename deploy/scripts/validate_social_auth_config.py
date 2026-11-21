#!/usr/bin/env python3
"""Check GitHub OAuth configuration from resolved Compose values without logging them."""

import ipaddress
import json
import re
import sys
from urllib.parse import urlsplit


class ConfigurationError(ValueError):
    pass


def valid_host(host):
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return "%" not in host
    except ValueError:
        labels = (host[:-1] if host.endswith(".") else host).split(".")
        label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
        return (
            all(re.fullmatch(label, part) for part in labels)
            and (len(labels) == 1 or labels[-1][0] in "abcdefghijklmnopqrstuvwxyz")
        )


def valid_origin(value):
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        return False
    try:
        uri = urlsplit(value)
        return (
            re.fullmatch(r"(?:\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+)(?::[0-9]+)?", uri.netloc)
            and valid_host(uri.hostname)
            and uri.path in {"", "/"}
            and "?" not in value
            and "#" not in value
            and (uri.port is None or 0 <= uri.port <= 65535)
            and (uri.scheme == "https" or (uri.scheme == "http" and uri.hostname in {"localhost", "127.0.0.1", "::1"}))
        )
    except ValueError:
        return False


def validate(configuration):
    environment = configuration["services"]["backend"].get("environment", {})
    keys = ("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")
    configured = tuple(bool((environment.get(key) or "").strip()) for key in keys)
    if not all(configured):
        if any(configured):
            missing = keys[configured.index(False)]
            print(f"Warning: {missing} is missing; GITHUB login is unavailable.", file=sys.stderr)
        return
    if not valid_origin(environment.get("PUBLIC_BASE_URL")):
        raise ConfigurationError("PUBLIC_BASE_URL must be a valid HTTPS origin or an HTTP loopback origin.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]", environment.get("SOCIAL_AUTH_FLOW_SECRET") or ""):
        raise ConfigurationError("SOCIAL_AUTH_FLOW_SECRET must be a stable 32-byte unpadded Base64URL key.")


if __name__ == "__main__":
    try:
        validate(json.load(sys.stdin))
    except ConfigurationError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, AttributeError):
        print("Invalid resolved OAuth deployment configuration.", file=sys.stderr)
        sys.exit(1)
