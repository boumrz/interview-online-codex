#!/usr/bin/env python3
"""Validate the resolved Compose backend keyring without exposing its values."""

import base64
import json
import re
import sys


def canonical_key(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", value):
        return False
    decoded = base64.urlsafe_b64decode(value + "=")
    return len(decoded) == 32 and base64.urlsafe_b64encode(decoded).decode().rstrip("=") == value


def flatten(properties, prefix=""):
    for name, value in properties.items():
        path = f"{prefix}.{name}" if prefix else name
        if isinstance(value, dict):
            yield from flatten(value, path)
        elif value is not None:
            yield path, value


def validate(configuration):
    environment = configuration["services"]["backend"]["environment"]
    active_id = environment.get("APP_TEAMINVITATIONLINKENCRYPTION_ACTIVEKEYID", environment.get("TEAM_INVITATION_LINK_ENCRYPTION_ACTIVE_KEY_ID", ""))
    keys = {
        name.removeprefix("APP_TEAMINVITATIONLINKENCRYPTION_KEYS_").lower(): value
        for name, value in environment.items()
        if name.startswith("APP_TEAMINVITATIONLINKENCRYPTION_KEYS_") and value is not None
    }
    spring_json = environment.get("SPRING_APPLICATION_JSON")
    if spring_json:
        properties = json.loads(spring_json)
        for path, value in flatten(properties):
            normalized = path.lower().replace("-", "").replace("_", "")
            if normalized == "app.teaminvitationlinkencryption.activekeyid":
                active_id = value
            elif normalized.startswith("app.teaminvitationlinkencryption.keys."):
                # Preserve explicit JSON map keys: historical key IDs may contain hyphens.
                key_id = path.split(".", 3)[3]
                keys[key_id] = value
    if not isinstance(active_id, str) or not active_id.strip() or active_id.strip() not in keys:
        raise ValueError("Invalid active key")
    if not keys or not all(canonical_key(value) for value in keys.values()):
        raise ValueError("Invalid keyring")


if __name__ == "__main__":
    try:
        validate(json.load(sys.stdin))
    except (ValueError, KeyError, TypeError, AttributeError):
        print("Invalid team invitation encryption configuration in the resolved backend environment: configure a canonical 32-byte Base64URL key for the active key ID and preserve historical keys.", file=sys.stderr)
        sys.exit(1)
