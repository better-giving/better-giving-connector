#!/bin/sh
# Same check as CI: the registry's own CLI, fetched into a temp dir outside the repo.
# CI sets BG_DESIGN_CLI_URL and BG_DESIGN_CLI_SHA256 (the pin in ci.yml), and the
# CLI at that URL must match the hash before it runs. Without BG_DESIGN_CLI_URL
# (a local run) it takes the newest CLI.
set -eu
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
curl -fsSL "${BG_DESIGN_CLI_URL:-https://design.better.giving/registry/cli.mjs}" -o "$dir/cli.mjs"
if [ -n "${BG_DESIGN_CLI_URL:-}" ]; then
  echo "${BG_DESIGN_CLI_SHA256:?BG_DESIGN_CLI_SHA256 is not set}  $dir/cli.mjs" | sha256sum --check --strict
fi
node "$dir/cli.mjs" diff --check
