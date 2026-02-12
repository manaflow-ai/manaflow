#!/bin/bash
# Start all services for the cmux E2B sandbox (Docker-enabled version)
# Services: Docker, cmux-code (VSCode), Chrome CDP, VNC, noVNC, worker daemon (Go)

echo "[cmux-e2b] Starting services (Docker-enabled)..."

# Always generate a fresh auth token on startup (security: each instance gets unique token)
AUTH_TOKEN_FILE="/home/user/.worker-auth-token"
VSCODE_TOKEN_FILE="/home/user/.vscode-token"
BOOT_ID_FILE="/home/user/.token-boot-id"

AUTH_TOKEN=$(openssl rand -hex 32)
# Use printf to avoid trailing newline (VSCode requires exact match)
printf "%s" "$AUTH_TOKEN" > "$AUTH_TOKEN_FILE"
chmod 644 "$AUTH_TOKEN_FILE"
chown user:user "$AUTH_TOKEN_FILE"

echo "[cmux-e2b] Auth token generated: ${AUTH_TOKEN:0:8}..."

# Create VSCode connection token file (same as worker auth, no trailing newline)
printf "%s" "$AUTH_TOKEN" > "$VSCODE_TOKEN_FILE"
chmod 644 "$VSCODE_TOKEN_FILE"
chown user:user "$VSCODE_TOKEN_FILE"

# Save current boot ID so worker-daemon knows not to regenerate token
BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "unknown")
echo "$BOOT_ID" > "$BOOT_ID_FILE"
chmod 644 "$BOOT_ID_FILE"
chown user:user "$BOOT_ID_FILE"
echo "[cmux-e2b] Boot ID saved: ${BOOT_ID:0:8}..."

# SSH server is now handled by Go worker daemon with token-as-username auth
# No need for system sshd or password setup
echo "[cmux-e2b] SSH server will be started by Go worker daemon (token-as-username auth)"

# VNC password not needed - auth proxy validates tokens before allowing access
echo "[cmux-e2b] VNC auth handled by token proxy (no VNC password needed)"

# Start Docker daemon
echo "[cmux-e2b] Starting Docker daemon..."
sudo dockerd --host=unix:///var/run/docker.sock --host=tcp://0.0.0.0:2375 &
# Wait for Docker to be ready
for i in {1..30}; do
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
vncserver :1 -geometry 1920x1080 -depth 24 -SecurityTypes None -localhost yes 2>/dev/null &
sleep 3

# Start VNC auth proxy on port 39380 (serves noVNC + proxies WebSocket to VNC)
# This replaces the separate noVNC proxy - architecture matches Morph Go proxy
echo "[cmux-e2b] Starting VNC auth proxy on port 39380..."
node /usr/local/bin/vnc-auth-proxy.js &

# Start cmux-code (our VSCode fork) on port 39378
# Uses connection-token-file for auth (same token as worker + VNC)
echo "[cmux-e2b] Starting cmux-code on port 39378 (token-protected)..."
/app/cmux-code/bin/code-server-oss \
    --host 0.0.0.0 \
    --port 39378 \
    --connection-token-file "$VSCODE_TOKEN_FILE" \
    --disable-workspace-trust \
    --disable-telemetry \
    /home/user/workspace 2>/dev/null &

# Chrome with CDP is started by VNC xstartup (visible browser)
# CDP will be available on port 9222 once VNC desktop is up
echo "[cmux-e2b] Chrome CDP will be available on port 9222 (started via VNC)"

# Start worker daemon on port 39377 (Go binary)
echo "[cmux-e2b] Starting worker daemon on port 39377..."
/usr/local/bin/worker-daemon &

echo "[cmux-e2b] All services started!"
echo "[cmux-e2b] Services:"
echo "  - Docker:  unix:///var/run/docker.sock (also tcp://localhost:2375)"
echo "  - VSCode:  http://localhost:39378?tkn=$AUTH_TOKEN"
echo "  - Worker:  http://localhost:39377 (use Bearer token)"
echo "  - VNC:     http://localhost:39380?tkn=$AUTH_TOKEN"
echo "  - Chrome:  http://localhost:9222"
echo ""
echo "[cmux-e2b] Auth token stored at: $AUTH_TOKEN_FILE"
echo "[cmux-e2b] Both VSCode and VNC use ?tkn= for authentication"

# Keep running
tail -f /dev/null
