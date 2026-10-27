#!/usr/bin/env python3
"""Validates angle/pin.toml.

    check_pin.py [--allow-unpublished] [path]

Fails on a missing key or platform, a malformed commit or digest, or (unless
--allow-unpublished) a platform without a published URL and digest.
"""

import re
import sys
import tomllib
from pathlib import Path

PLATFORMS = ("linux-x64", "macos-arm64", "windows-x64")


def problems(pin: dict, allow_unpublished: bool) -> list[str]:
    found = []
    for key, pattern in (("angle_commit", r"[0-9a-f]{40}"), ("depot_tools_commit", r"[0-9a-f]{40}")):
        if not re.fullmatch(pattern, str(pin.get(key, ""))):
            found.append(f"{key} must be a 40-character lowercase hex commit")
    if not re.fullmatch(r"angle-\d+\.\d+", str(pin.get("bundle_version", ""))):
        found.append("bundle_version must look like angle-<branch>.<n>")
    platforms = pin.get("platform", {})
    for name in PLATFORMS:
        entry = platforms.get(name)
        if entry is None:
            found.append(f"missing [platform.{name}]")
            continue
        url, sha = entry.get("url", ""), entry.get("sha256", "")
        if not url and not sha and allow_unpublished:
            continue
        if not str(url).startswith("https://"):
            found.append(f"platform.{name}.url must be an https URL")
        if not re.fullmatch(r"[0-9a-f]{64}", str(sha)):
            found.append(f"platform.{name}.sha256 must be 64 lowercase hex characters")
    return found


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = Path(args[0]) if args else Path(__file__).resolve().parents[1] / "pin.toml"
    with open(path, "rb") as f:
        pin = tomllib.load(f)
    found = problems(pin, "--allow-unpublished" in sys.argv)
    if found:
        sys.exit(f"{path}:\n  " + "\n  ".join(found))
    print(f"{path}: ok")


if __name__ == "__main__":
    main()
