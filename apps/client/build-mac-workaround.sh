#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# remove existing build artifacts; keep build/ to preserve entitlements between steps
rm -rf build
rm -rf dist-electron
rm -rf out
# If you need to refresh icons, uncomment the next line to delete only icon outputs.
# rm -f build/icon.icns build/icon.ico build/icon.png || true

# Build the Electron app first with environment variables loaded
echo "Building Electron app..."
# Load environment variables from .env.production if present; otherwise .env
ENV_FILE="$ROOT_DIR/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE="$ROOT_DIR/.env"
fi
echo "Using env file: $ENV_FILE"
set -a  # Mark all new variables for export
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a  # Turn off auto-export

ensure_native_core_built() {
  local native_dir="$ROOT_DIR/apps/server/native/core"
  echo "Ensuring native Rust addon (.node) is built..."
  if ls "$native_dir"/*.node >/dev/null 2>&1; then
    echo "Existing native binary detected; rebuilding for consistency..."
  else
    echo "Native binary missing; building @cmux/native-core..."
  fi

  (
    cd "$native_dir"
    bunx --bun @napi-rs/cli build --platform --release
  )

  local host_arch
  host_arch="$(uname -m)"
  local expected_patterns=("cmux_native_core.darwin-*.node")

  case "$host_arch" in
    arm64)
      expected_patterns=("cmux_native_core.darwin-arm64.node")
      ;;
    x86_64)
      expected_patterns=("cmux_native_core.darwin-x64.node" "cmux_native_core.darwin-x86_64.node")
      ;;
  esac

  local found=0
  for pattern in "${expected_patterns[@]}"; do
    if ls "$native_dir"/$pattern >/dev/null 2>&1; then
      found=1
      break
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "ERROR: Native addon build did not produce an expected .node binary." >&2
    exit 1
  fi
}

ensure_native_core_built

# Generate icons using the shared script (unified with standard builds)
echo "Generating icons via scripts/generate-icons.mjs..."
node ./scripts/generate-icons.mjs

# Ensure macOS entitlements file exists after the cleanup above
bash "$ROOT_DIR/scripts/prepare-macos-entitlements.sh" || true

# Build electron bundles using Bun (avoids npm/npx ESM bin issues)
# Increase Node heap to avoid OOM during Electron renderer build
export NODE_OPTIONS="--max-old-space-size=8192 ${NODE_OPTIONS:-}"
bunx electron-vite build -c electron.vite.config.ts

# Create a temporary directory for packaging
TEMP_DIR=$(mktemp -d)
APP_NAME="${CMUX_APP_NAME:-cmux}"
APP_DIR="$TEMP_DIR/$APP_NAME.app"
APP_VERSION=$(node -e "const fs = require('node:fs'); const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')); if (!pkg.version) { process.exit(1); } process.stdout.write(String(pkg.version));")
if [ -z "$APP_VERSION" ]; then
  echo "ERROR: Unable to determine app version from package.json" >&2
  exit 1
fi

echo "Creating app structure at $APP_DIR..."

# Download Electron binary if not cached
ELECTRON_VERSION="37.2.4"
ELECTRON_CACHE="${HOME}/.cache/electron"
ARCH=$(uname -m)

# Map architecture names
if [ "$ARCH" = "x86_64" ]; then
    ELECTRON_ARCH="x64"
elif [ "$ARCH" = "arm64" ]; then
    ELECTRON_ARCH="arm64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

ELECTRON_ZIP="$ELECTRON_CACHE/electron-v$ELECTRON_VERSION-darwin-$ELECTRON_ARCH.zip"

if [ ! -f "$ELECTRON_ZIP" ]; then
    echo "Downloading Electron v$ELECTRON_VERSION for $ELECTRON_ARCH..."
    mkdir -p "$ELECTRON_CACHE"
    curl -L "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-darwin-$ELECTRON_ARCH.zip" -o "$ELECTRON_ZIP"
fi

# Extract Electron
echo "Extracting Electron..."
unzip -q "$ELECTRON_ZIP" -d "$TEMP_DIR"
mv "$TEMP_DIR/Electron.app" "$APP_DIR"

# Copy app files
echo "Copying app files..."
RESOURCES_DIR="$APP_DIR/Contents/Resources"
APP_ASAR_DIR="$RESOURCES_DIR/app"
mkdir -p "$APP_ASAR_DIR"

# Copy built files
cp -r out "$APP_ASAR_DIR/"
cp package.json "$APP_ASAR_DIR/"

echo "Preparing production dependencies..."
# Ensure local production node_modules exists for the packaged app. In workspaces,
# Bun may hoist to the repo root; create a local node_modules if missing.
if [ ! -d "node_modules" ]; then
  echo "node_modules not found; installing production dependencies with Bun..."
  bun install --frozen-lockfile --production
fi

# echo "Copying dependencies..."
# if [ -d "node_modules" ]; then
#   cp -r node_modules "$APP_ASAR_DIR/"
# else
#   echo "ERROR: node_modules still missing after install. Aborting." >&2
#   exit 1
# fi

# Update Info.plist
echo "Updating app metadata..."
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.cmux.app" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$APP_DIR/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$APP_DIR/Contents/Info.plist"

# Register cmux:// URL scheme so macOS knows to open this app for deep links
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string cmux" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string cmux" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true

# Ensure our app icon is bundled and used by macOS (generated by script above)
ICONSET_SRC="$(pwd)/assets/cmux-logos/cmux.iconset"
BUILD_ICON_ICNS="$(pwd)/build/icon.icns"
if [ -d "$ICONSET_SRC" ]; then
  echo "Copying iconset into Resources..."
  mkdir -p "$RESOURCES_DIR/cmux-logos"
  rsync -a "$ICONSET_SRC/" "$RESOURCES_DIR/cmux-logos/cmux.iconset/"
fi

# Include auto-update configuration required by electron-updater
APP_UPDATE_SRC="$(pwd)/electron/app-update.yml"
if [ ! -f "$APP_UPDATE_SRC" ]; then
  echo "ERROR: Auto-update config missing at $APP_UPDATE_SRC" >&2
  exit 1
fi
cp "$APP_UPDATE_SRC" "$RESOURCES_DIR/app-update.yml"

if [ -f "$BUILD_ICON_ICNS" ]; then
  echo "Installing app icon..."
  cp "$BUILD_ICON_ICNS" "$RESOURCES_DIR/Cmux.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile Cmux" "$APP_DIR/Contents/Info.plist"
else
  echo "WARNING: build/icon.icns not found after generation; app icon may remain default" >&2
fi

# Rename executable
mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$APP_NAME"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP_NAME" "$APP_DIR/Contents/Info.plist"

# Bundle native Rust addon (.node) into Resources so runtime loader can find it
echo "Bundling native Rust addon (.node) into Resources..."
NATIVE_SRC_DIR="$ROOT_DIR/apps/server/native/core"
NATIVE_DST_DIR="$RESOURCES_DIR/native/core"
mkdir -p "$NATIVE_DST_DIR"
shopt -s nullglob
NODE_BINARIES=("$NATIVE_SRC_DIR"/*.node)
if [ ${#NODE_BINARIES[@]} -gt 0 ]; then
  echo "Copying ${#NODE_BINARIES[@]} native binary(ies) from $NATIVE_SRC_DIR to $NATIVE_DST_DIR"
  for f in "${NODE_BINARIES[@]}"; do
    cp -f "$f" "$NATIVE_DST_DIR/"
  done
else
  echo "ERROR: No native .node binary found in $NATIVE_SRC_DIR. Build failed." >&2
  exit 1
fi
shopt -u nullglob

# Create output directory based on architecture
OUTPUT_DIR="dist-electron/mac-$ELECTRON_ARCH"
mkdir -p "$OUTPUT_DIR"

# Move the app
echo "Moving app to $OUTPUT_DIR..."
rm -rf "$OUTPUT_DIR/$APP_NAME.app"
mv "$APP_DIR" "$OUTPUT_DIR/"

# Clean up
rm -rf "$TEMP_DIR"

APP_PATH="$(pwd)/$OUTPUT_DIR/$APP_NAME.app"
echo "Build complete! App is at $APP_PATH"

if [[ "$APP_NAME" == "cmux-staging" ]]; then
  echo "Stopping any running cmux-staging instances before launching the new build..."
  pkill -f "cmux-staging" >/dev/null 2>&1 || true
fi

if command -v open >/dev/null 2>&1; then
  echo "Opening $APP_PATH"
  if ! open "$APP_PATH"; then
    echo "WARNING: Failed to open $APP_PATH" >&2
  fi
else
  echo "Skipping automatic open: open command is unavailable."
fi
