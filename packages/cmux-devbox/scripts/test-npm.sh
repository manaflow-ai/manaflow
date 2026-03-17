#!/bin/bash
# Test npm packages locally before publishing

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR/../npm"
TEST_DIR=$(mktemp -d)

echo "📦 Testing npm packages locally..."
echo "   Test directory: $TEST_DIR"
echo ""

# Auth config for build (can be overridden via environment variables)
# Defaults are dev Stack Auth publishable keys (designed to be public)
# Same env vars work at runtime to override build-time values.
: "${STACK_PROJECT_ID:=1467bed0-8522-45ee-a8d8-055de324118c}"
: "${STACK_PUBLISHABLE_CLIENT_KEY:=pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0}"
: "${CMUX_API_URL:=http://localhost:9779}"
: "${CONVEX_SITE_URL:=https://famous-camel-162.convex.site}"

# Build binaries first
echo "1. Building binaries..."
cd "$SCRIPT_DIR/.."
make build-npm \
  STACK_PROJECT_ID="$STACK_PROJECT_ID" \
  STACK_PUBLISHABLE_CLIENT_KEY="$STACK_PUBLISHABLE_CLIENT_KEY" \
  CMUX_API_URL="$CMUX_API_URL" \
  CONVEX_SITE_URL="$CONVEX_SITE_URL"

# Pack all packages
echo ""
echo "2. Packing packages..."
cd "$PKG_DIR"

for pkg in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do
  if [ -d "$pkg" ]; then
    cd "$pkg"
    npm pack --pack-destination "$TEST_DIR" 2>/dev/null
    cd ..
  fi
done

cd cmux
npm pack --pack-destination "$TEST_DIR" 2>/dev/null
cd ..

echo ""
echo "3. Installing packages in test directory..."
cd "$TEST_DIR"

# Initialize a test project
npm init -y > /dev/null 2>&1

# Install platform package first (only for current platform)
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "arm64" ]; then
  PKG_FILE="cmux-darwin-arm64-0.1.0.tgz"
elif [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x86_64" ]; then
  PKG_FILE="cmux-darwin-x64-0.1.0.tgz"
elif [ "$PLATFORM" = "linux" ] && [ "$ARCH" = "aarch64" ]; then
  PKG_FILE="cmux-linux-arm64-0.1.0.tgz"
elif [ "$PLATFORM" = "linux" ] && [ "$ARCH" = "x86_64" ]; then
  PKG_FILE="cmux-linux-x64-0.1.0.tgz"
else
  echo "⚠️  Unknown platform: $PLATFORM-$ARCH"
  PKG_FILE=""
fi

if [ -n "$PKG_FILE" ] && [ -f "$PKG_FILE" ]; then
  echo "   Installing $PKG_FILE..."
  npm install "./$PKG_FILE" > /dev/null 2>&1
fi

# Install main package
echo "   Installing cmux-0.1.0.tgz..."
npm install "./cmux-0.1.0.tgz" > /dev/null 2>&1

echo ""
echo "4. Testing cmux command..."
echo "   ----------------------------------------"
./node_modules/.bin/cmux version
echo "   ----------------------------------------"

echo ""
echo "5. Testing help..."
echo "   ----------------------------------------"
./node_modules/.bin/cmux --help | head -15
echo "   ..."
echo "   ----------------------------------------"

echo ""
echo "✅ Test passed!"
echo ""
echo "📍 Test directory preserved at: $TEST_DIR"
echo "   To test manually:"
echo "   cd $TEST_DIR && ./node_modules/.bin/cmux --help"
echo ""
echo "   To clean up:"
echo "   rm -rf $TEST_DIR"
