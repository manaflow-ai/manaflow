# Cloudrouter Sandbox Template

Sandbox template with VSCode, VNC desktop, and Chrome browser.

## Features

- **Ubuntu 22.04** base image
- **TigerVNC** + noVNC for web-based desktop access
- **Chrome** browser (opens by default in VNC)
- **OpenVSCode Server** for browser-based IDE
- **Chrome CDP** for headless browser automation
- **Node.js 20**, Bun, Git, GitHub CLI

## Ports

| Service | Port | Description |
|---------|------|-------------|
| Worker API | 39377 | Auth-protected worker daemon |
| VSCode | 39378 | OpenVSCode Server (token auth) |
| VNC (noVNC) | 39380 | Web-based VNC desktop |
| VNC (native) | 5901 | TigerVNC server |
| Chrome CDP | 9222 | Headless Chrome DevTools Protocol |

## Build Template

```bash
# Set E2B API key
export E2B_API_KEY="your-api-key"

# Build the template
cd packages/cloudrouter
e2b template build

# Or with custom name
e2b template build --name cloudrouter-devbox
```

## Use with CLI

```bash
# Install CLI
cd packages/cloudrouter
make build-dev && make install-dev

# Create sandbox
cloudrouter start --name test -t <team>

# Open VNC (Chrome opens automatically)
cloudrouter vnc <id>

# Open VSCode
cloudrouter code <id>
```

## What's Inside

### VNC Desktop
- **TigerVNC** server on display :1
- **XFCE4** desktop environment
- **Chrome** opens maximized on startup
- **noVNC** web proxy on port 39380

### VSCode
- OpenVSCode Server with token authentication
- Workspace at `/home/user/workspace`

### Chrome
- **Visible instance**: Opens in VNC desktop for manual browsing
- **Headless instance**: CDP on port 9222 for automation

## Authentication

Each sandbox generates a unique auth token on startup:
- **VSCode**: `?tkn=<token>` query parameter
- **VNC**: First 8 chars of token as password
- **Worker API**: `Authorization: Bearer <token>` header

Token is stored at `/home/user/.worker-auth-token` inside the sandbox.

## Rebuild After Changes

If you modify the Dockerfile or scripts:

```bash
cd packages/cloudrouter
e2b template build
```

New sandboxes will use the updated template.
