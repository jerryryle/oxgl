#!/usr/bin/env bash
# Fails if any native library in a packed Linux platform package needs a
# GLIBC_ symbol version newer than the limit (openspec release, "Linux
# packages run on glibc 2.34"). The addon's requirement comes from the
# runner image it is built on, so an image upgrade would otherwise raise it
# without anyone noticing. Needs objdump (binutils).
#
#     scripts/check-glibc.sh <platform-tarball> [limit]
set -euo pipefail
tarball="$1"
limit="${2:-2.34}"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
tar -xzf "$tarball" -C "$dir"
status=0
while IFS= read -r -d '' lib; do
  need="$(objdump -T "$lib" | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sed 's/^GLIBC_//' | sort -uV | tail -n 1 || true)"
  name="${lib#"$dir"/package/}"
  if [ -z "$need" ]; then
    echo "check-glibc: $name needs no versioned glibc symbol"
  elif [ "$(printf '%s\n%s\n' "$need" "$limit" | sort -V | tail -n 1)" != "$limit" ]; then
    echo "::error::$name needs glibc $need; Linux packages must run on glibc $limit"
    status=1
  else
    echo "check-glibc: $name needs glibc $need"
  fi
done < <(find "$dir/package" -type f \( -name '*.node' -o -name '*.so' -o -name '*.so.*' \) -print0)
exit "$status"
