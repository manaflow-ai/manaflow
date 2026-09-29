#!/bin/bash
# Keep service credentials private even if the image's default umask changes.
umask 077
set -euo pipefail

# Start all services for the cmux E2B sandbox (Docker-enabled version)
# Services: Docker, cmux-code (VSCode), Chrome CDP, VNC, noVNC, worker daemon (Go)

echo "[cmux-e2b] Starting services (Docker-enabled)..."

# Always generate a fresh auth token on startup (security: each instance gets unique token)
AUTH_TOKEN_FILE="/home/user/.worker-auth-token"
VSCODE_TOKEN_FILE="/home/user/.vscode-token"
BOOT_ID_FILE="/home/user/.token-boot-id"

AUTH_TOKEN=$(openssl rand -hex 32)

# Write root-created credentials through a private temporary file. Direct
# redirection would follow a symlink planted in the user-owned home directory.
write_private_file() {
    local target="$1"
    local value="$2"
    local directory tmp
    directory=$(dirname -- "$target")
    if [ "$(readlink -f -- "$directory")" != "$directory" ]; then
        echo "[cmux-e2b] Refusing symlinked secret directory: $directory" >&2
        return 1
    fi
    tmp=$(mktemp "$directory/.worker-secret.XXXXXX")
    if ! printf "%s" "$value" > "$tmp"; then
        rm -f -- "$tmp"
        return 1
    fi
    chmod 600 "$tmp"
    chown user:user "$tmp"
    # -T makes replacement atomic even when an attacker races a directory
    # into the destination path. The destination is never followed.
    mv -fT -- "$tmp" "$target"
}

# Use printf to avoid trailing newline (VSCode requires exact match).
write_private_file "$AUTH_TOKEN_FILE" "$AUTH_TOKEN"

echo "[cmux-e2b] Auth token generated"

# Create VSCode connection token file (same as worker auth, no trailing newline)
write_private_file "$VSCODE_TOKEN_FILE" "$AUTH_TOKEN"

# Save current boot ID so worker-daemon knows not to regenerate token
BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "unknown")
write_private_file "$BOOT_ID_FILE" "$BOOT_ID"
echo "[cmux-e2b] Boot ID saved: ${BOOT_ID:0:8}..."

# SSH server is now handled by Go worker daemon with token-as-username auth
# No need for system sshd or password setup
echo "[cmux-e2b] SSH server will be started by Go worker daemon (token-as-username auth)"

# VNC password not needed - auth proxy validates tokens before allowing access
echo "[cmux-e2b] VNC auth handled by token proxy (no VNC password needed)"

# Start Docker daemon
echo "[cmux-e2b] Starting Docker daemon..."
# The Docker API is available only through the root-owned Unix socket. An
# unauthenticated TCP listener would let any network client control the daemon.
sudo dockerd --host=unix:///var/run/docker.sock &
# Wait for Docker to be ready
for _ in {1..30}; do
    if docker info >/dev/null 2>&1; then
        echo "[cmux-e2b] Docker daemon is ready"
        break
    fi
    sleep 1
done

# Start D-Bus for desktop environment
echo "[cmux-e2b] Starting D-Bus..."
sudo mkdir -p /run/dbus 2>/dev/null || true
sudo dbus-daemon --system --fork 2>/dev/null || true

# Start VNC server on display :1 (port 5901) - localhost only, auth handled by proxy on 39380
echo "[cmux-e2b] Starting VNC server on display :1 (localhost only - auth via proxy)..."
rm -f /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
sudo -u user -H vncserver :1 -geometry 1920x1080 -depth 24 -SecurityTypes None -localhost yes 2>/dev/null &
sleep 3

# VNC auth proxy on port 39380 is now part of the Go worker daemon

# Start cmux-code (our VSCode fork) on port 39378
# Uses connection-token-file for auth (same token as worker + VNC)
echo "[cmux-e2b] Starting cmux-code on port 39378 (token-protected)..."
sudo -u user -H env HOME=/home/user /app/cmux-code/bin/code-server-oss \
    --host 0.0.0.0 \
    --port 39378 \
    --connection-token-file "$VSCODE_TOKEN_FILE" \
    --disable-workspace-trust \
    --disable-telemetry \
    /home/user/workspace 2>/dev/null &

# Chrome with CDP is started by VNC xstartup (visible browser)
# CDP will be available on port 9222 once VNC desktop is up
echo "[cmux-e2b] Chrome CDP will be available on port 9222 (started via VNC)"

# Create agent-browser wrapper that auto-connects to Chrome CDP on first use
cat > /usr/local/bin/ab << 'WRAPPER_EOF'
#!/bin/bash
# Auto-connect to Chrome CDP if not already connected
if [ ! -S "$HOME/.agent-browser/default.sock" ] || ! agent-browser get url >/dev/null 2>&1; then
  mkdir -p "$HOME/.agent-browser"
  agent-browser connect 9222 >/dev/null 2>&1
fi
exec agent-browser "$@"
WRAPPER_EOF
chmod +x /usr/local/bin/ab

# Start JupyterLab on port 8888 (token-protected, same auth token)
echo "[cmux-e2b] Starting JupyterLab on port 8888..."
# Keep the token out of the process list and shell logs. Jupyter reads this
# private config file as the unprivileged user.
JUPYTER_CONFIG_DIR="/home/user/.jupyter"
sudo -u user -H mkdir -p -- "$JUPYTER_CONFIG_DIR"
sudo -u user -H chmod 700 -- "$JUPYTER_CONFIG_DIR"
printf -v JUPYTER_CONFIG "c.ServerApp.token = '%s'\n" "$AUTH_TOKEN"
write_private_file "$JUPYTER_CONFIG_DIR/jupyter_server_config.py" "$JUPYTER_CONFIG"
sudo -u user -H env HOME=/home/user JUPYTER_CONFIG_DIR="$JUPYTER_CONFIG_DIR" jupyter lab --ip=0.0.0.0 --port=8888 --no-browser \
    --ServerApp.root_dir=/home/user/workspace \
    2>/dev/null &

# Start worker daemon on port 39377 (Go binary)
echo "[cmux-e2b] Starting worker daemon on port 39377..."
sudo -u user -H env HOME=/home/user /usr/local/bin/worker-daemon &

echo "[cmux-e2b] All services started!"
echo "[cmux-e2b] Services:"
echo "  - Docker:  unix:///var/run/docker.sock"
echo "  - VSCode:  http://localhost:39378 (token file authentication)"
echo "  - Jupyter: http://localhost:8888 (token authentication)"
echo "  - Worker:  http://localhost:39377 (use Bearer token)"
echo "  - VNC:     http://localhost:39380 (token authentication)"
echo "  - Chrome:  http://localhost:9222"
echo ""
echo "[cmux-e2b] Auth token stored at: $AUTH_TOKEN_FILE"
echo "[cmux-e2b] VSCode and VNC use ?tkn=, Jupyter uses ?token= for authentication"

# Keep running
tail -f /dev/null
