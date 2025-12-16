#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Fail fast if unplugin resolves to a build without createVitePlugin (common when deps are pruned).
if [[ "${SKIP_UNPLUGIN_PREFLIGHT:-}" != "1" ]]; then
  node <<'NODE'
(async () => {
  try {
    const mod = await import('unplugin');
    if (typeof mod.createVitePlugin !== 'function') {
      console.error('[publish-mac-workaround] Resolved "unplugin" does not export createVitePlugin.');
      console.error('[publish-mac-workaround] Exports:', Object.keys(mod));
      console.error('[publish-mac-workaround] This usually means an outdated or CJS-only build was selected.');
      console.error('[publish-mac-workaround] Ensure unplugin@^2 is installed before running this script.');
      process.exit(1);
    }
  } catch (error) {
    console.error('[publish-mac-workaround] Unable to import "unplugin":', error?.message ?? error);
    process.exit(1);
  }
})();
NODE
fi
PATCH_BIN() {
  local bin_path="$1"
  local search="$2"
  local replacement="$3"
  if [ -f "$bin_path" ] && [ ! -L "$bin_path" ]; then
    if grep -q "$search" "$bin_path"; then
      echo "Patching $(basename "$bin_path") binary for publish build (copied node_modules)..."
      local tmp_file="$(mktemp)"
      python3 - "$bin_path" "$search" "$replacement" "$tmp_file" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
needle = sys.argv[2]
replacement = sys.argv[3]
text = path.read_text()
pathlib.Path(sys.argv[4]).write_text(text.replace(needle, replacement))
PY
      mv "$tmp_file" "$bin_path"
      chmod +x "$bin_path"
    fi
  fi
}

PATCH_BIN "$SCRIPT_DIR/node_modules/.bin/electron-vite" "../dist/cli.js" "../electron-vite/dist/cli.js"
PATCH_BIN "$SCRIPT_DIR/node_modules/.bin/electron-builder" "./out/cli/cli" "../electron-builder/out/cli/cli"

exec "$SCRIPT_DIR/build-mac-workaround.sh" "$@"
