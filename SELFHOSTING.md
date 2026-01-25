# cmux Self-Hosting Guide

This guide explains how to self-host cmux, the parallel agent orchestration platform.

## Quick Start

The fastest way to get started is with the standalone mode:

```bash
# Pull the cmux image
docker pull manaflow/cmux:latest

# Run in standalone mode (simple isolated dev environment)
docker run -d \
  --name cmux \
  --privileged \
  --cgroupns host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 8080:39378 \
  -p 8081:39380 \
  -e ANTHROPIC_API_KEY=your-api-key \
  manaflow/cmux:latest

# Access the IDE at http://localhost:8080
# Access VNC at http://localhost:8081
```

## Prerequisites

- Docker 24.0+ with Docker Compose v2
- At least 8GB RAM (16GB recommended for running multiple agents)
- Linux host (Ubuntu 22.04+ recommended) or macOS with Docker Desktop
- For full orchestration: Convex backend

## Architecture Overview

cmux consists of several components:

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
      ┌───────▼───────┐     ┌───────▼───────┐
      │  cmux Worker  │     │    Convex     │
      │   (Sandbox)   │◄────│   Backend     │
      └───────────────┘     └───────────────┘
              │
    ┌─────────┴─────────┐
    │  Agent Process    │
    │  (Claude Code,    │
    │   Cursor, etc.)   │
    └───────────────────┘
```

### Components

1. **cmux Worker** (`manaflow/cmux`): The sandbox environment where coding agents run
   - Web-based VS Code IDE
   - Terminal with tmux
   - Docker-in-Docker support
   - VNC for GUI access
   - Pre-installed dev tools (Node.js, Python, Go, Rust)

2. **Convex Backend**: Database and real-time sync (optional for standalone mode)

## Deployment Options

### Option 1: Standalone Mode (Simplest)

Run a single sandbox without orchestration. Perfect for local development.

```bash
docker pull manaflow/cmux:latest

docker run -d \
  --name cmux \
  --privileged \
  --cgroupns host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v cmux-workspace:/root/workspace \
  -v cmux-docker:/var/lib/docker \
  -p 8080:39378 \
  -p 8081:39380 \
  -e ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} \
  -e GITHUB_TOKEN=${GITHUB_TOKEN} \
  manaflow/cmux:latest
```

Access:
- **VS Code IDE**: http://localhost:8080
- **VNC Desktop**: http://localhost:8081

### Option 2: Docker Compose (Full Stack)

For full orchestration with Convex backend:

```bash
# Clone the repository (or just download the compose file)
git clone https://github.com/manaflow-ai/cmux.git
cd cmux

# Copy and configure environment
cp .env.selfhost.template .env.selfhost

# Generate required secrets
echo "CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)" >> .env.selfhost
echo "CMUX_TASK_RUN_JWT_SECRET=$(openssl rand -hex 32)" >> .env.selfhost

# Add your API keys
echo "ANTHROPIC_API_KEY=your-key" >> .env.selfhost

# Start services
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d

# View logs
docker compose -f docker-compose.selfhost.yml logs -f
```

### Option 3: Kubernetes (Production)

For production deployments, use the Helm chart (coming soon) or create your own manifests:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cmux-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cmux-worker
  template:
    metadata:
      labels:
        app: cmux-worker
    spec:
      containers:
      - name: cmux
        image: manaflow/cmux:latest
        securityContext:
          privileged: true
        ports:
        - containerPort: 39378
          name: ide
        - containerPort: 39377
          name: worker
        - containerPort: 39380
          name: vnc
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: cmux-secrets
              key: anthropic-api-key
        volumeMounts:
        - name: workspace
          mountPath: /root/workspace
        - name: cgroup
          mountPath: /sys/fs/cgroup
      volumes:
      - name: workspace
        persistentVolumeClaim:
          claimName: cmux-workspace
      - name: cgroup
        hostPath:
          path: /sys/fs/cgroup
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | For Claude | - |
| `OPENAI_API_KEY` | OpenAI API key | For OpenAI agents | - |
| `GITHUB_TOKEN` | GitHub PAT for private repos | No | - |
| `WORKER_ID` | Unique worker identifier | No | `cmux-worker-1` |
| `CONVEX_URL` | Convex backend URL | For orchestration | - |
| `CMUX_TASK_RUN_JWT_SECRET` | JWT signing secret | For orchestration | - |

### Ports

| Port | Service | Description |
|------|---------|-------------|
| 39375 | Exec Service | HTTP API for commands |
| 39377 | Worker | Socket.IO for orchestration |
| 39378 | IDE | VS Code web interface |
| 39379 | Proxy | cmux HTTP/2 proxy |
| 39380 | VNC | VNC websocket (noVNC) |
| 39381 | CDP | Chrome DevTools Protocol |
| 39382 | CDP Target | Chrome DevTools target |
| 39383 | PTY | Terminal server |

### Volumes

| Path | Description | Recommendation |
|------|-------------|----------------|
| `/root/workspace` | Project files | Mount your projects here |
| `/var/lib/docker` | Docker data | Persist for caching |
| `/sys/fs/cgroup` | Cgroups | Required, mount from host |

## Running Agents

### Claude Code

```bash
# From inside the container terminal
claude

# Or with a specific task
claude "Review this code and suggest improvements"
```

### Cursor

```bash
cursor-agent --prompt "Add authentication to this API"
```

### Other Agents

The container includes support for:
- Codex CLI
- Gemini CLI
- Amp
- Opencode

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name cmux.example.com;

    ssl_certificate /etc/ssl/certs/cmux.crt;
    ssl_certificate_key /etc/ssl/private/cmux.key;

    # VS Code IDE
    location / {
        proxy_pass http://localhost:39378;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # VNC
    location /vnc/ {
        proxy_pass http://localhost:39380/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Caddy

```caddyfile
cmux.example.com {
    reverse_proxy localhost:39378
}

vnc.cmux.example.com {
    reverse_proxy localhost:39380
}
```

## Troubleshooting

### Container won't start

**Symptom**: Container exits immediately

**Solution**: Ensure you're using `--privileged` and mounting cgroups:
```bash
docker run --privileged --cgroupns host -v /sys/fs/cgroup:/sys/fs/cgroup:rw ...
```

### IDE not loading

**Symptom**: Port 39378 not responding

**Solution**: Check if systemd services are running:
```bash
docker exec cmux systemctl status cmux.target
docker exec cmux journalctl -u cmux-ide
```

### Docker-in-Docker not working

**Symptom**: `docker: command not found` or socket errors

**Solution**: Wait for dockerd to start (can take 30-60s):
```bash
docker exec cmux systemctl status cmux-dockerd
docker exec cmux docker info
```

### VNC not accessible

**Symptom**: Port 39380 not responding

**Solution**: Check VNC services:
```bash
docker exec cmux systemctl status cmux-tigervnc
docker exec cmux systemctl status cmux-vnc-proxy
```

### View logs

```bash
# All cmux services
docker exec cmux journalctl -u 'cmux-*' -f

# Specific service
docker exec cmux journalctl -u cmux-worker -f

# Worker application logs
docker exec cmux tail -f /var/log/cmux/worker.log
```

## Security Considerations

### Production Recommendations

1. **Network Isolation**: Run in a private network, expose only necessary ports
2. **API Keys**: Use secrets management (Vault, AWS Secrets Manager)
3. **Resource Limits**: Set memory and CPU limits
4. **Updates**: Regularly pull new images for security patches

### Resource Limits

```bash
docker run -d \
  --name cmux \
  --privileged \
  --memory=8g \
  --cpus=4 \
  ...
```

## Health Checks

The container includes a health check that verifies the worker service:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' cmux

# Manual health check
curl http://localhost:39377/health
```

## Upgrading

```bash
# Pull latest image
docker pull manaflow/cmux:latest

# Stop and remove old container
docker stop cmux && docker rm cmux

# Start with new image (your volumes persist)
docker run -d --name cmux ... manaflow/cmux:latest
```

## Support

- **Issues**: https://github.com/manaflow-ai/cmux/issues
- **Discussions**: https://github.com/manaflow-ai/cmux/discussions

## License

cmux is open source. See [LICENSE](LICENSE) for details.
