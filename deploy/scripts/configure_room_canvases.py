#!/usr/bin/env python3
"""Enable room canvases and validate their resolved configuration/readiness.

Never source environment files or print resolved Compose environments: they
contain persistent credentials unrelated to these two feature switches.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
import uuid


FEATURES = {
    "diagrams": ("FEATURE_ROOM_DIAGRAMS_ENABLED", "app.features.room-diagrams-enabled"),
    "whiteboard": ("FEATURE_ROOM_WHITEBOARD_ENABLED", "app.features.room-whiteboard-enabled"),
}


class DeploymentError(Exception):
    """A deliberately safe diagnostic, containing no configuration values."""


def line_context(line, quote):
    """Track quoted values without interpreting or executing shell contents."""
    index = 0
    continuation = False
    while index < len(line):
        character = line[index]
        if quote == "'":
            if character == "'":
                quote = None
        elif character == "\\":
            following = line[index + 1:]
            continuation = following in {"\n", "\r\n"}
            index += 1
        elif character == "`" or line[index:index + 2] == "$(":
            raise DeploymentError("Automatic canvas edits require literal environment assignments; set the two flags manually in dynamic shell configurations.")
        elif quote:
            if character == quote:
                quote = None
        elif character in {"'", '"'}:
            quote = character
        elif character == "#" and (index == 0 or line[index - 1].isspace()):
            break
        index += 1
    return quote, continuation


def enable_environment(filename):
    target = Path(filename)
    if target.is_symlink() or not target.is_file():
        raise DeploymentError("Canvas settings require an existing regular environment file, not a symbolic link.")
    previous = target.stat()
    original = target.read_bytes()
    text = original.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    names = [value[0] for value in FEATURES.values()]
    assignment = re.compile(r"^\s*(?:export\s+)?(" + "|".join(names) + r")\s*=")
    seen = set()
    updated = []
    quote, continuation = None, False
    for line in text.splitlines(keepends=True):
        match = assignment.match(line) if quote is None and not continuation else None
        quote, continuation = line_context(line, quote)
        if match and (quote is not None or continuation):
            raise DeploymentError("Canvas flag assignments must be single-line literals for automatic enabling.")
        if not match:
            updated.append(line)
        elif match[1] not in seen:
            seen.add(match[1])
            ending = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else newline
            updated.append(f"{match[1]}=true{ending}")
    if quote is not None or continuation:
        raise DeploymentError("The environment file contains an incomplete quoted value or continuation.")
    result = "".join(updated)
    missing = [name for name in names if name not in seen]
    if missing and result and not result.endswith(("\n", "\r")):
        result += newline
    result += "".join(f"{name}=true{newline}" for name in missing)
    encoded = result.encode("utf-8")
    if encoded == original:
        print("Room canvases are already enabled; the environment file was not changed.")
        return

    # Secure backup creation is deliberately before creating/replacing the new
    # environment. If this fails, the deployment configuration stays untouched.
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "." + uuid.uuid4().hex[:8]
    backup = target.with_name(f"{target.name}.before-canvases.{suffix}.bak")
    backup_fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(backup_fd, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
        stream.flush()
        os.fsync(stream.fileno())

    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.canvases-", dir=target.parent)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
            info = os.fstat(stream.fileno())
            if (info.st_uid, info.st_gid) != (previous.st_uid, previous.st_gid):
                os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(previous.st_mode))
        current = target.lstat()
        if target.is_symlink() or (current.st_dev, current.st_ino) != (previous.st_dev, previous.st_ino) or target.read_bytes() != original:
            raise DeploymentError("The environment file changed during canvas configuration; retry after reviewing it.")
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
    print("Room canvases enabled; only their two settings changed and a private original backup was created.")


def boolean(value):
    if value is True or value == "true":
        return True
    if value is False or value == "false":
        return False
    raise DeploymentError("Canvas flags must be literal true or false in the resolved configuration.")


def normalized(name):
    return re.sub(r"[._-]", "", name.lower())


def environment_aliases(property_name):
    namespace, leaf = property_name.rsplit(".", 1)
    words = leaf.split("-")
    camel = words[0] + "".join(word.capitalize() for word in words[1:])
    return {
        property_name,
        namespace + "." + camel,
        property_name.upper().replace(".", "_").replace("-", "_"),
        property_name.upper().replace(".", "_").replace("-", ""),
    }


def add_override(overrides, name, value):
    parsed = boolean(value)
    if name in overrides and overrides[name] != parsed:
        raise DeploymentError("Conflicting canvas property aliases in one configuration source; use one canonical property per feature.")
    overrides[name] = parsed


def flatten(properties, prefix=""):
    for name, value in properties.items():
        if not isinstance(name, str):
            raise DeploymentError("Invalid Spring JSON property configuration.")
        name = f"{prefix}.{name}" if prefix else name
        if isinstance(value, dict):
            yield from flatten(value, name)
        elif value is not None:
            yield name, value


def resolved_flags(configuration, require_enabled=False):
    services = configuration["services"]
    environment = services["backend"].get("environment", {})
    web = services.get("web", {})
    build = web.get("build", {})
    arguments = build.get("args", {}) if isinstance(build, dict) else {}
    if not isinstance(environment, dict) or not isinstance(arguments, dict):
        raise DeploymentError("Canvas checks require resolved Compose environment/build argument mappings.")
    effective = {name: boolean(environment.get(keys[0], "false")) for name, keys in FEATURES.items()}
    frontend = {name: boolean(arguments.get(keys[0], "false")) for name, keys in FEATURES.items()}
    canonical = {normalized(keys[1]): name for name, keys in FEATURES.items()}
    # Direct Spring environment properties override application.yml placeholders.
    overrides = {}
    for name, value in environment.items():
        if normalized(name) in canonical and value is not None:
            feature = canonical[normalized(name)]
            if name not in environment_aliases(FEATURES[feature][1]):
                raise DeploymentError("Ambiguous canvas environment property name; use canonical APP_FEATURES_ROOM_DIAGRAMS_ENABLED or APP_FEATURES_ROOM_WHITEBOARD_ENABLED.")
            add_override(overrides, feature, value)
    effective.update(overrides)
    spring_json = environment.get("SPRING_APPLICATION_JSON")
    if spring_json:
        properties = json.loads(spring_json)
        if not isinstance(properties, dict):
            raise DeploymentError("SPRING_APPLICATION_JSON must contain an object.")
        # JSON uses dotted property namespaces, unlike system environment keys.
        # Collapsing dots would incorrectly turn an ignored JSON key such as
        # APP_FEATURES_ROOM_DIAGRAMS_ENABLED into an effective Spring property.
        json_canonical = {re.sub(r"[-_]", "", keys[1].lower()): name for name, keys in FEATURES.items()}
        raw_placeholders = {normalized(keys[0]) for keys in FEATURES.values()}
        overrides = {}
        for name, value in flatten(properties):
            if normalized(name) in raw_placeholders:
                raise DeploymentError("Use canonical app.features.room-diagrams-enabled/app.features.room-whiteboard-enabled properties in Spring JSON, not raw FEATURE_* placeholders.")
            property_name = re.sub(r"[-_]", "", name.lower())
            if property_name in json_canonical:
                add_override(overrides, json_canonical[property_name], value)
        effective.update(overrides)
    if effective != frontend:
        raise DeploymentError("Canvas backend flags and frontend build arguments differ; rebuild with matching values.")
    if require_enabled and not all(effective.values()):
        raise DeploymentError("Both room canvases must be enabled for the requested release.")
    return effective


def verify_assets(base_url, host, enabled):
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

    resources = []
    if enabled["diagrams"]:
        resources.append("drawio/js/app.min.js")
    if enabled["whiteboard"]:
        resources.append("whiteboard-assets/subset/subset-worker.chunk.js")
    for resource in resources:
        _, content_type = fetch(resource, 8192)
        if content_type not in {"application/javascript", "text/javascript", "application/x-javascript"}:
            raise DeploymentError(f"Canvas asset is not served as JavaScript: {resource}")
    if enabled["whiteboard"]:
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
    print("Enabled room canvas assets verified." if resources else "Room canvases are disabled; no asset checks requested.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--enable-env", metavar="PATH")
    action.add_argument("--check-compose", action="store_true")
    action.add_argument("--verify-assets", nargs=2, metavar=("BASE_URL", "HOST"))
    parser.add_argument("--require-enabled", action="store_true")
    args = parser.parse_args()
    try:
        if args.enable_env:
            enable_environment(args.enable_env)
        else:
            enabled = resolved_flags(json.load(sys.stdin), args.require_enabled)
            if args.verify_assets:
                verify_assets(*args.verify_assets, enabled)
            else:
                print("Room diagrams: " + str(enabled["diagrams"]).lower() + "; whiteboard: " + str(enabled["whiteboard"]).lower())
        return 0
    except DeploymentError as error:
        print(str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, UnicodeError):
        print("Unable to safely read/update canvas configuration or verify its assets; check file permissions and resolved settings.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
