#!/bin/sh
# Same check as CI: the registry's own CLI, fetched fresh into a temp dir outside the repo.
set -eu
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
curl -fsSL https://design.better.giving/registry/cli.mjs -o "$dir/cli.mjs"
node "$dir/cli.mjs" diff --check
