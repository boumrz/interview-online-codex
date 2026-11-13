#!/usr/bin/env python3
"""Prepare the pinned draw.io WAR in the frontend Docker build context."""

import argparse
from contextlib import contextmanager
import errno
import hashlib
from http.client import IncompleteRead
import json
import os
from pathlib import Path
import re
import signal
import ssl
import stat
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen


class ArchiveError(Exception):
    pass


def enabled_from_compose(configuration):
    web = configuration.get("services", {}).get("web", {})
    build = web.get("build", {})
    arguments = build.get("args", {}) if isinstance(build, dict) else {}
    flag = arguments.get("FEATURE_ROOM_DIAGRAMS_ENABLED", "false")
    if flag is True or flag == "true":
        return True
    if flag is False or flag == "false":
        return False
    raise ArchiveError("The resolved draw.io build flag must be literal true or false.")


def read_release(filename):
    release = json.loads(Path(filename).read_text())
    if not isinstance(release.get("version"), str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", release["version"]):
        raise ArchiveError("Invalid pinned draw.io version in the shared release metadata.")
    if not isinstance(release.get("archiveSha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", release["archiveSha256"]):
        raise ArchiveError("Invalid pinned draw.io SHA-256 in the shared release metadata.")
    size = release.get("maxArchiveBytes")
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise ArchiveError("Invalid draw.io maximum archive size in the shared release metadata.")
    url = urlsplit(release["archiveUrl"])
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ArchiveError("The pinned draw.io URL must be public HTTP(S) without credentials or signed query parameters.")
    return release


def filesystem_reason(error):
    return {
        errno.EACCES: "permission denied",
        errno.EPERM: "permission denied",
        errno.ENOENT: "file or parent directory does not exist",
        errno.ENOTDIR: "a parent path is not a directory",
        errno.EEXIST: "the directory path is occupied by an existing file",
        errno.ENOSPC: "no space left on device",
        errno.EROFS: "read-only filesystem",
    }.get(error.errno, "filesystem I/O error")


def open_offline_archive(filename):
    source = Path(filename)
    try:
        if not stat.S_ISREG(source.stat().st_mode):
            raise ArchiveError(f"Offline archive is not a regular file: {source}")
        return source.open("rb")
    except FileNotFoundError:
        raise ArchiveError(
            f"Missing offline archive: {source}. Copy the verified WAR to this server first, "
            "then retry with DRAWIO_ARCHIVE_PATH pointing to the transferred file."
        ) from None
    except OSError as error:
        raise ArchiveError(f"Cannot read offline archive {source}: {filesystem_reason(error)}.") from None


def archive_digest(stream, limit, output=None, offline_source=None):
    digest = hashlib.sha256()
    total = 0
    while True:
        try:
            chunk = stream.read(64 * 1024)
        except OSError as error:
            if offline_source is None:
                raise
            raise ArchiveError(f"Cannot read offline archive {offline_source}: {filesystem_reason(error)}.") from None
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ArchiveError("The draw.io archive exceeds the pinned maximum size.")
        digest.update(chunk)
        if output is not None:
            output.write(chunk)
    if not total:
        raise ArchiveError("The draw.io archive is empty.")
    return digest.hexdigest()


def verify_cached(filename, release):
    if filename.is_symlink() or not filename.is_file():
        raise ArchiveError("The canonical draw.io cache must be a regular WAR file.")
    with filename.open("rb") as stream:
        digest = archive_digest(stream, release["maxArchiveBytes"])
    if digest != release["archiveSha256"]:
        raise ArchiveError("The canonical draw.io cache is corrupt; remove it or replace it with the pinned WAR before retrying.")


def limit_from_environment(name, default, maximum):
    value = os.environ.get(name, str(default))
    if not re.fullmatch(r"[0-9]+", value) or not 1 <= int(value) <= maximum:
        raise ArchiveError(f"{name} must be an integer between 1 and {maximum}.")
    return int(value)


@contextmanager
def attempt_deadline(seconds):
    # This deployment CLI runs on the POSIX hosts used by deploy_docker.sh.
    # A total deadline also bounds slow trickle responses and redirect chains;
    # urlopen's timeout alone only limits each individual socket operation.
    def expired(_signum, _frame):
        raise TimeoutError()
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def stage_archive(cache, release, read_into):
    cache.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".draw.war-", suffix=".part", dir=cache.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            digest = read_into(output)
            if digest != release["archiveSha256"]:
                raise ArchiveError("The draw.io archive checksum does not match the pinned SHA-256.")
            output.flush()
            os.fsync(output.fileno())
            # Public release bytes need to remain readable by later Docker
            # build-context uploaders, including after a sudo enable deploy.
            os.fchmod(output.fileno(), 0o644)
        if cache.exists() or cache.is_symlink():
            verify_cached(cache, release)
        else:
            os.replace(temporary, cache)
            temporary = None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def prepare(release, cache_directory):
    cache = Path(cache_directory) / release["version"] / "draw.war"
    try:
        if cache.exists() or cache.is_symlink():
            verify_cached(cache, release)
            print(f"Pinned draw.io archive cache verified: {cache}")
            return
        offline = os.environ.get("DRAWIO_ARCHIVE_PATH")
        if offline:
            # Diagnose a missing/unreadable source before creating any cache
            # directories; the path may only exist on the operator's laptop.
            with open_offline_archive(offline) as source:
                def copy_offline(output):
                    return archive_digest(source, release["maxArchiveBytes"], output, offline_source=offline)
                stage_archive(cache, release, copy_offline)
            print(f"Pinned offline draw.io WAR copied into the Docker build context: {cache}")
            return
        timeout = limit_from_environment("DRAWIO_DOWNLOAD_TIMEOUT_MS", 180000, 900000) / 1000
        attempts = limit_from_environment("DRAWIO_DOWNLOAD_ATTEMPTS", 2, 3)
        reason = "download unavailable"
        for attempt in range(attempts):
            def download(output):
                with attempt_deadline(timeout), urlopen(release["archiveUrl"], timeout=timeout) as response:
                    return archive_digest(response, release["maxArchiveBytes"], output)
            retry = False
            try:
                stage_archive(cache, release, download)
                print(f"Pinned draw.io WAR downloaded and verified in the Docker build context: {cache}")
                return
            except HTTPError as error:
                reason = f"HTTP {error.code}"
                retry = error.code in {408, 429, 500, 502, 503, 504}
                error.close()
            except TimeoutError:
                reason = "download timeout"
                retry = True
            except URLError as error:
                reason = "download timeout" if isinstance(error.reason, TimeoutError) else "network download failure"
                retry = not isinstance(error.reason, ssl.SSLCertVerificationError)
            except (ConnectionError, IncompleteRead):
                reason = "interrupted network download"
                retry = True
            if not retry or attempt + 1 == attempts:
                raise ArchiveError(f"Pinned draw.io download failed ({reason}); retries are bounded.")
            time.sleep(0.2 * (attempt + 1))
    except (ArchiveError, OSError) as error:
        reason = str(error) if isinstance(error, ArchiveError) else f"Cannot prepare or write draw.io cache: {filesystem_reason(error)}."
        raise ArchiveError(
            f"{reason}\nCanonical cache: {cache}\nExpected SHA-256: {release['archiveSha256']}\n"
            f"Pinned public URL: {release['archiveUrl']}\n"
            "For an offline build, download that pinned release on a connected machine and set DRAWIO_ARCHIVE_PATH to its WAR file before deployment."
        ) from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-compose", action="store_true", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--cache-dir", required=True)
    args = parser.parse_args()
    try:
        if not enabled_from_compose(json.load(sys.stdin)):
            print("Room diagrams are disabled; no archive or network access requested.")
            return 0
        prepare(read_release(args.release), args.cache_dir)
        return 0
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        print("Invalid draw.io deployment configuration or unreadable pinned release metadata; no environment values were printed.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
