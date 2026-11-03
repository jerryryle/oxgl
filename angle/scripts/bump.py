#!/usr/bin/env python3
"""Pins an oxgl-angle release in angle/bundles.toml.

    bump.py [tag] [angle-dir]

Pins the given release, or by default the latest one, and prints its tag; it
prints nothing when bundles.toml already pins it. Every bundle URL and digest
(the symbols archives included) is rewritten from the release's SHA256SUMS.

The release must come from oxgl-angle's own workflows (openspec
angle-distribution): created by github-actions[bot], every asset uploaded by
it, and its tag on a commit of oxgl-angle's main. A personal token, even a
leaked one, creates releases and uploads assets under its owner's name, so
anything else is refused. Reads GitHub through `gh`.
"""

import json
import re
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path

# Run as a script, so this directory is on sys.path.
from check_pin import RELEASES, VERSION, bundles_problems

REPO = "oxgl-js/oxgl-angle"
BOT = "github-actions[bot]"


def gh_api(path: str) -> dict:
    out = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def origin_problems(release: dict, on_main: bool) -> list[str]:
    """Why `release` did not come from oxgl-angle's own workflows, if it didn't."""
    found = []
    tag = release.get("tag_name", "?")
    author = (release.get("author") or {}).get("login")
    if author != BOT:
        found.append(f"{tag} was created by {author}, not {BOT}")
    for asset in release.get("assets", []):
        uploader = (asset.get("uploader") or {}).get("login")
        if uploader != BOT:
            found.append(f"{tag} asset {asset.get('name')} was uploaded by {uploader}, not {BOT}")
    if not on_main:
        found.append(f"{tag} does not point at a commit on {REPO}'s main")
    return found


def parse_sums(text: str) -> dict[str, str]:
    """SHA256SUMS lines (`<sha256>  ./<file>`) as file name -> digest."""
    sums = {}
    for line in text.splitlines():
        if line.strip():
            digest, name = line.split(maxsplit=1)
            sums[name.strip().removeprefix("./").lstrip("*")] = digest
    return sums


def rewrite(text: str, tag: str, sums: dict[str, str]) -> str:
    """bundles.toml `text` pinned to `tag`, keeping its layout and comments."""
    out = []
    platform = None
    for line in text.splitlines(keepends=True):
        if m := re.match(r"\[platform\.([a-z0-9-]+)\]", line):
            platform = m.group(1)
        elif re.match(r"bundle_version\s*=", line):
            line = re.sub(rf'"{VERSION}"', f'"{tag}"', line, count=1)
        elif platform and (m := re.match(r"(symbols_)?(url|sha256)\s*=", line)):
            name = f"angle-{platform}{'-symbols' if m.group(1) else ''}.tar.xz"
            if name not in sums:
                raise SystemExit(f"bump: {tag}'s SHA256SUMS has no {name}")
            value = f"{RELEASES}{tag}/{name}" if m.group(2) == "url" else sums[name]
            line = re.sub(r'"[^"]*"', f'"{value}"', line, count=1)
        out.append(line)
    return "".join(out)


def main() -> None:
    args = sys.argv[1:]
    tag_arg = args[0] if args and re.fullmatch(VERSION, args[0]) else None
    rest = args[1:] if tag_arg else args
    path = (Path(rest[0]) if rest else Path(__file__).resolve().parents[1]) / "bundles.toml"
    text = path.read_text()
    pinned = tomllib.loads(text)["bundle_version"]

    release = gh_api(f"repos/{REPO}/releases/" + (f"tags/{tag_arg}" if tag_arg else "latest"))
    tag = release["tag_name"]
    if tag == pinned:
        return
    sha = gh_api(f"repos/{REPO}/commits/{tag}")["sha"]
    status = gh_api(f"repos/{REPO}/compare/main...{sha}")["status"]
    if found := origin_problems(release, status in ("behind", "identical")):
        raise SystemExit("bump: refusing " + "; ".join(found))

    sums_asset = next((a for a in release["assets"] if a["name"] == "SHA256SUMS"), None)
    if sums_asset is None:
        raise SystemExit(f"bump: {tag} has no SHA256SUMS")
    with urllib.request.urlopen(sums_asset["browser_download_url"]) as response:
        sums = parse_sums(response.read().decode())

    updated = rewrite(text, tag, sums)
    if problems := bundles_problems(tomllib.loads(updated)):
        raise SystemExit("bump: " + "; ".join(problems))
    path.write_text(updated)
    print(tag)


if __name__ == "__main__":
    main()
