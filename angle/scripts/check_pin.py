#!/usr/bin/env python3
"""Validates angle/bundles.toml, the pinned ANGLE bundles.

    check_pin.py [angle-dir]

Fails on a missing key or platform, a malformed version or digest, or a URL
outside the oxgl-angle release named by bundle_version. An optional symbols
archive (symbols_url, symbols_sha256) is checked the same way. angle-dir
defaults to this repository's angle/.
"""

import re
import sys
import tomllib
from pathlib import Path

PLATFORMS = ("linux-x64", "linux-arm64", "macos-arm64", "windows-x64", "windows-arm64")
VERSION = r"angle-\d+\.\d+"
# Bundles are built and released by the recipe repository.
RELEASES = "https://github.com/jerryryle/oxgl-angle/releases/download/"


def bundles_problems(bundles: dict) -> list[str]:
    found = []
    version = str(bundles.get("bundle_version", ""))
    if not re.fullmatch(VERSION, version):
        found.append("bundle_version must look like angle-<branch>.<n>")
        version = ""
    platforms = bundles.get("platform", {})
    for name in PLATFORMS:
        entry = platforms.get(name)
        if entry is None:
            found.append(f"missing [platform.{name}]")
            continue
        found += archive_problems(
            f"platform.{name}.", entry.get("url", ""), entry.get("sha256", ""), version
        )
        if "symbols_url" in entry or "symbols_sha256" in entry:
            found += archive_problems(
                f"platform.{name}.symbols_",
                entry.get("symbols_url", ""),
                entry.get("symbols_sha256", ""),
                version,
            )
    return found


def archive_problems(field: str, url: object, sha: object, version: str) -> list[str]:
    found = []
    release = f"{RELEASES}{version}/" if version else RELEASES
    if not str(url).startswith(release):
        found.append(f"{field}url is not in {release}")
    if not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
        found.append(f"{field}sha256 must be 64 lowercase hex characters")
    return found


def main() -> None:
    args = sys.argv[1:]
    path = (Path(args[0]) if args else Path(__file__).resolve().parents[1]) / "bundles.toml"
    with open(path, "rb") as f:
        found = bundles_problems(tomllib.load(f))
    if found:
        print(f"{path}:\n  " + "\n  ".join(found), file=sys.stderr)
        sys.exit(1)
    print(f"{path}: ok")


if __name__ == "__main__":
    main()
