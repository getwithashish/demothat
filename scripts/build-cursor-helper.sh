#!/usr/bin/env bash
# Builds the Wayland cursor helper and stages it for packaging.
#
# The helper is a Rust binary (see native/cursor-helper). It is Linux-only, so this
# is a Linux-only build step: on macOS and Windows the staged directory stays empty
# and the packaged app simply has no helper, which is the configuration the app is
# written to cope with (it falls back to the browser capture path).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="$REPO_ROOT/native/cursor-helper"
STAGING="$REPO_ROOT/build/cursor-helper"

if [ "$(uname -s)" != "Linux" ]; then
  echo "The cursor helper is Linux-only; skipping on $(uname -s)."
  exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is not installed, so the cursor helper cannot be built." >&2
  echo "Install Rust (https://rustup.rs), or package without it: the app falls back to" >&2
  echo "the browser capture path on Wayland, with the pointer recorded into the video." >&2
  exit 1
fi

if ! pkg-config --exists libpipewire-0.3 2>/dev/null; then
  echo "libpipewire-0.3 headers are missing (needed by the helper's PipeWire client)." >&2
  echo "On Debian/Ubuntu: sudo apt install libpipewire-0.3-dev libclang-dev pkg-config" >&2
  exit 1
fi

echo "Building the cursor helper..."
(cd "$HELPER_DIR" && cargo build --release)

mkdir -p "$STAGING"
cp "$HELPER_DIR/target/release/demothat-cursor-helper" "$STAGING/demothat-cursor-helper"
chmod +x "$STAGING/demothat-cursor-helper"
echo "Staged: $STAGING/demothat-cursor-helper"
