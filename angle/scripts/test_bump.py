#!/usr/bin/env python3
"""Tests bump.py's origin check and bundles.toml rewrite against stubbed data.

    python3 angle/scripts/test_bump.py
"""

import tomllib
import unittest
from pathlib import Path

# Run as a script, so this directory is on sys.path.
from bump import BOT, origin_problems, parse_sums, rewrite
from check_pin import bundles_problems

BUNDLES = Path(__file__).resolve().parents[1] / "bundles.toml"


def release(author=BOT, uploaders=(BOT, BOT)):
    return {
        "tag_name": "angle-9999.1",
        "author": {"login": author},
        "assets": [
            {"name": f"asset-{i}", "uploader": {"login": who}} for i, who in enumerate(uploaders)
        ],
    }


class OriginTest(unittest.TestCase):
    def test_bot_release_on_main_passes(self):
        self.assertEqual(origin_problems(release(), on_main=True), [])

    def test_release_by_a_user_is_refused(self):
        found = origin_problems(release(author="jerryryle"), on_main=True)
        self.assertEqual(len(found), 1)
        self.assertIn("created by jerryryle", found[0])

    def test_asset_replaced_by_a_user_is_refused(self):
        found = origin_problems(release(uploaders=(BOT, "jerryryle")), on_main=True)
        self.assertEqual(len(found), 1)
        self.assertIn("asset-1 was uploaded by jerryryle", found[0])

    def test_tag_off_main_is_refused(self):
        found = origin_problems(release(), on_main=False)
        self.assertEqual(len(found), 1)
        self.assertIn("main", found[0])


class RewriteTest(unittest.TestCase):
    def sums(self, text):
        """A SHA256SUMS with a distinct digest for every bundle and symbols archive."""
        names = [
            f"angle-{platform}{suffix}.tar.xz"
            for platform in tomllib.loads(text)["platform"]
            for suffix in ("", "-symbols")
        ]
        return parse_sums("".join(f"{i:064x}  ./{name}\n" for i, name in enumerate(names)))

    def test_rewrite_pins_every_url_and_digest(self):
        text = BUNDLES.read_text()
        sums = self.sums(text)
        updated = tomllib.loads(rewrite(text, "angle-9999.1", sums))
        self.assertEqual(updated["bundle_version"], "angle-9999.1")
        self.assertEqual(bundles_problems(updated), [])
        for platform, entry in updated["platform"].items():
            self.assertTrue(entry["url"].endswith(f"/angle-9999.1/angle-{platform}.tar.xz"))
            self.assertEqual(entry["sha256"], sums[f"angle-{platform}.tar.xz"])
            if "symbols_url" in entry:
                self.assertEqual(entry["symbols_sha256"], sums[f"angle-{platform}-symbols.tar.xz"])

    def test_rewrite_keeps_comments(self):
        text = BUNDLES.read_text()
        updated = rewrite(text, "angle-9999.1", self.sums(text))
        comments = [line for line in text.splitlines() if line.startswith("#")]
        self.assertEqual([line for line in updated.splitlines() if line.startswith("#")], comments)

    def test_missing_digest_fails(self):
        text = BUNDLES.read_text()
        with self.assertRaises(SystemExit):
            rewrite(text, "angle-9999.1", {})

    def test_parse_sums_strips_dot_slash(self):
        self.assertEqual(parse_sums(f"{'a' * 64}  ./angle-linux-x64.tar.xz\n"), {"angle-linux-x64.tar.xz": "a" * 64})


if __name__ == "__main__":
    unittest.main()
