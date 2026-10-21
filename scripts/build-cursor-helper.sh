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

# A packager without Rust still gets a working release: the helper is an extra, and
# without it Wayland recordings use the browser capture (with the pointer in the
# video). Set DEMOTHAT_REQUIRE_CURSOR_HELPER=1 to make its absence a build failure —
# that is what a release pipeline should do.
require_helper() {
  if [ "${DEMOTHAT_REQUIRE_CURSOR_HELPER:-0}" = "1" ]; then
    echo "error: $1 (DEMOTHAT_REQUIRE_CURSOR_HELPER=1)" >&2
    exit 1
  fi
  echo "warning: $1"
  echo "         Packaging without the cursor helper: Wayland recordings will use the"
  echo "         browser capture, with the pointer recorded into the video."
  exit 0
}

if ! command -v cargo >/dev/null 2>&1; then
  require_helper "cargo is not installed, so the cursor helper cannot be built (https://rustup.rs)"
fi

if ! pkg-config --exists libpipewire-0.3 2>/dev/null; then
  require_helper "libpipewire-0.3 headers are missing (sudo apt install libpipewire-0.3-dev libclang-dev)"
fi

echo "Building the cursor helper..."
(cd "$HELPER_DIR" && cargo build --release)

mkdir -p "$STAGING"
cp "$HELPER_DIR/target/release/demothat-cursor-helper" "$STAGING/demothat-cursor-helper"
chmod +x "$STAGING/demothat-cursor-helper"
echo "Staged: $STAGING/demothat-cursor-helper"
