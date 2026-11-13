#!/bin/bash
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

# the pnpm the setup script installed, pinned by `packageManager`
ver=$(sed -n 's/.*"packageManager": *"pnpm@\([0-9.]*\).*/\1/p' package.json)
[ -n "$ver" ] || { echo "cloud-install: no pnpm pin in packageManager" >&2; exit 1; }
home="${PNPM_HOME:-$HOME/.local/share/pnpm}"
exe="$home/.tools/pnpm-exe/$ver/pnpm"

# link the binary, not the `pnpm` wrapper in PNPM_HOME: the wrapper resolves the
# binary beside its own path, so a link to it breaks. the directory holds only
# this link and the node link below. pnpm 12's installer lays down no .tools
# binary, so its wrapper's own directory goes on PATH whole.
if [ -x "$exe" ]; then
  bin="$HOME/.kru-bin"
  mkdir -p "$bin"
  ln -sf "$exe" "$bin/pnpm"
else
  bin="$home/bin"
  [ -x "$bin/pnpm" ] || { echo "cloud-install: no pnpm $ver under $home" >&2; exit 1; }
fi
export PATH="$bin:$PATH"
# the setup script installs the repo's node (`.nvmrc`) into /usr/local, but the
# image's /opt/node22/bin comes first on PATH and would run every command on 22.
node_bin=/usr/local/bin/node
if [ -x "$node_bin" ] && "$node_bin" --version | grep -q "^v$(cat .nvmrc)\."; then
  mkdir -p "$HOME/.kru-bin"
  ln -sf "$node_bin" "$HOME/.kru-bin/node"
  case "$bin" in "$HOME/.kru-bin") ;; *) export PATH="$HOME/.kru-bin:$PATH" ;; esac
fi
want="$(cat .nvmrc)"
case "$(node --version)" in
  "v$want".*) ;;
  *) echo "cloud-install: node $(node --version) is first on PATH but .nvmrc wants $want; the environment setup script did not install it into /usr/local" >&2; exit 1 ;;
esac
# later shells read this file. without it they find the image's pnpm, which
# self-switches to `packageManager` with lifecycle scripts off.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$HOME/.kru-bin:$bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

pnpm install --frozen-lockfile
