# Self-Hosting cmux

This guide explains how to self-host cmux using Docker.

## Quick Start

### Option 1: Standalone VS Code Environment

The simplest way to get started is using the standalone docker-compose:

```bash
# Clone or create a workspace directory
mkdir -p workspace

# Pull and run cmux
docker compose -f docker-compose.standalone.yml up -d

# Access VS Code at http://localhost:39378
```

Or run directly with Docker:

```bash
docker run -d \
  --name cmux \
  --privileged \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v $(pwd)/workspace:/root/workspace \
  -p 39378:39378 \
  --tmpfs /run:rw,mode=755 \
  --tmpfs /run/lock:rw,mode=755 \
  --stop-signal SIGRTMIN+3 \
  manaflow/cmux:latest
```

Then open http://localhost:39378 in your browser.

### Option 2: Full Self-Hosted Setup

For the complete cmux experience with task orchestration:

```bash
docker compose -f docker-compose.selfhost.yml up -d
```

This starts:
- **Convex backend** (port 3210) - State management
- **Convex dashboard** (port 6791) - Admin UI
- **cmux worker** (port 39378) - VS Code IDE

## Ports

| Port  | Service                    | Description                      |
|-------|----------------------------|----------------------------------|
| 39378 | VS Code IDE                | Main IDE interface               |
| 39377 | Worker API                 | Socket.IO API for orchestration  |
| 39379 | cmux-proxy                 | Request proxy service            |
| 39380 | VNC websocket              | noVNC for browser preview        |
| 39381 | Chrome DevTools            | Remote debugging                 |
| 39383 | cmux-pty                   | Terminal PTY server              |
| 3210  | Convex API                 | Backend API (selfhost mode)      |
| 3211  | Convex Site                | Backend site (selfhost mode)     |
| 6791  | Convex Dashboard           | Admin interface (selfhost mode)  |

## Environment Variables

| Variable          | Default                | Description                          |
|-------------------|------------------------|--------------------------------------|
| `NODE_ENV`        | `production`           | Node environment                     |
| `WORKER_PORT`     | `39377`                | Worker Socket.IO port                |
| `IS_SANDBOX`      | `1`                    | Enable sandbox mode                  |
| `CONVEX_URL`      | -                      | Convex backend URL                   |
| `CMUX_WORKSPACE`  | `./workspace`          | Host path to mount as workspace      |

## Requirements

- **Docker**: Docker Desktop (macOS/Windows) or Docker Engine (Linux)
- **Privileged mode**: Required for systemd and Docker-in-Docker
- **cgroups v2**: The container needs cgroups mounted for systemd

### Linux-specific

On Linux, ensure cgroups v2 is enabled:

```bash
# Check if using cgroups v2
stat -fc %T /sys/fs/cgroup
# Should output "cgroup2fs"
```

### macOS with OrbStack

OrbStack works out of the box with the provided configurations.

### macOS with Docker Desktop

Docker Desktop on macOS should work, but ensure you have the latest version.

## Volumes

### Workspace Mount

Mount your code directory to `/root/workspace`:

```bash
-v /path/to/your/code:/root/workspace
```

### Docker-in-Docker (Optional)

To enable Docker inside the container:

```bash
-v /var/run/docker.sock:/var/run/docker.sock
```

## Customization

### Using a Specific Version

Instead of `latest`, pin to a specific version:

```bash
docker pull manaflow/cmux:main
# or a specific SHA
docker pull manaflow/cmux:abc1234
```

### Persisting Data

To persist VS Code settings and extensions:

```bash
-v cmux-vscode-data:/root/.vscode-server-oss
```

## Troubleshooting

### Container won't start

1. Ensure privileged mode is enabled
2. Check cgroups mount: `-v /sys/fs/cgroup:/sys/fs/cgroup:rw`
3. Verify stop signal: `--stop-signal SIGRTMIN+3`

### VS Code not accessible

1. Wait 30-60 seconds for services to start
2. Check container logs: `docker logs cmux`
3. Verify port 39378 is not in use

### Services not starting

Check systemd journal inside the container:

```bash
docker exec -it cmux journalctl -u cmux-ide.service
docker exec -it cmux journalctl -u cmux-worker.service
```

## Architecture

The cmux Docker image runs:

1. **systemd** - Service manager (entrypoint)
2. **cmux-code** - VS Code server (forked from OpenVSCode)
3. **cmux-worker** - Task orchestration worker
4. **cmux-proxy** - Request proxy
5. **cmux-pty** - Terminal PTY server
6. **cmux-vnc** - VNC for browser preview (optional)

All services are managed by systemd and start automatically.

## Support

- GitHub Issues: https://github.com/manaflow-ai/cmux/issues
- Discord: https://discord.gg/SDbQmzQhRK
