#!/bin/bash
# Setup wrapper scripts for claude/npx/bunx to support OAuth token injection.
# This allows cmux to inject CLAUDE_CODE_OAUTH_TOKEN at runtime without needing
# to set it as an environment variable (which doesn't work due to OAuth check timing).
set -eux

# Create the env file directory
mkdir -p /etc/claude-code
touch /etc/claude-code/env
chmod 644 /etc/claude-code/env

# Add bun global bin to PATH (where bun add -g installs binaries)
export PATH="/root/.bun/bin:$PATH"

# Find the real claude binary location
CLAUDE_PATH="$(which claude 2>/dev/null || true)"
if [ -z "$CLAUDE_PATH" ]; then
    echo "claude not found in PATH, skipping wrapper setup"
    exit 0
fi

echo "Found claude at: $CLAUDE_PATH"
CLAUDE_DIR="$(dirname "$CLAUDE_PATH")"
echo "Claude directory: $CLAUDE_DIR"

# If claude is already a wrapper (not a symlink), skip
if [ -f "$CLAUDE_PATH" ] && ! [ -L "$CLAUDE_PATH" ]; then
    if head -1 "$CLAUDE_PATH" 2>/dev/null | grep -q "^#!/bin/bash"; then
        echo "claude already appears to be a wrapper, skipping"
        exit 0
    fi
fi

# Move claude to claude-real (works for both symlinks and regular files)
mv "$CLAUDE_DIR/claude" "$CLAUDE_DIR/claude-real"

# Create claude wrapper that calls the real binary
cat > "$CLAUDE_DIR/claude" << WRAPPER
#!/bin/bash
# Source claude-code env vars if file exists
if [ -f /etc/claude-code/env ]; then
    set -a
    source /etc/claude-code/env
    set +a
fi
exec "$CLAUDE_DIR/claude-real" "\$@"
WRAPPER
chmod +x "$CLAUDE_DIR/claude"

# Setup bunx wrapper if bunx exists (used by cmux to run claude-code)
BUNX_PATH="$(which bunx 2>/dev/null || true)"
if [ -n "$BUNX_PATH" ]; then
    echo "Found bunx at: $BUNX_PATH"
    BUNX_DIR="$(dirname "$BUNX_PATH")"

    # Only wrap if it's a symlink (not already wrapped)
    if [ -L "$BUNX_PATH" ]; then
        mv "$BUNX_DIR/bunx" "$BUNX_DIR/bunx-real"
        cat > "$BUNX_DIR/bunx" << WRAPPER
#!/bin/bash
# If running claude-code (with or without version suffix), source env vars
case "\$1" in
    @anthropic-ai/claude-code|@anthropic-ai/claude-code@*|claude-code|claude-code@*)
        if [ -f /etc/claude-code/env ]; then
            set -a
            source /etc/claude-code/env
            set +a
        fi
        ;;
esac
exec "$BUNX_DIR/bunx-real" "\$@"
WRAPPER
        chmod +x "$BUNX_DIR/bunx"
    fi
fi

# Setup npx wrapper if npx exists
NPX_PATH="$(which npx 2>/dev/null || true)"
if [ -n "$NPX_PATH" ]; then
    echo "Found npx at: $NPX_PATH"
    NPX_DIR="$(dirname "$NPX_PATH")"

    # Only wrap if it's a symlink (not already wrapped)
    if [ -L "$NPX_PATH" ]; then
        mv "$NPX_DIR/npx" "$NPX_DIR/npx-real"
        cat > "$NPX_DIR/npx" << WRAPPER
#!/bin/bash
# If running claude-code (with or without version suffix), source env vars
case "\$1" in
    @anthropic-ai/claude-code|@anthropic-ai/claude-code@*|claude-code|claude-code@*)
        if [ -f /etc/claude-code/env ]; then
            set -a
            source /etc/claude-code/env
            set +a
        fi
        ;;
esac
exec "$NPX_DIR/npx-real" "\$@"
WRAPPER
        chmod +x "$NPX_DIR/npx"
    fi
fi

echo "Claude OAuth wrappers setup complete"
echo "claude wrapper:"
ls -la "$CLAUDE_DIR/claude" "$CLAUDE_DIR/claude-real" 2>/dev/null || true
cat "$CLAUDE_DIR/claude"
