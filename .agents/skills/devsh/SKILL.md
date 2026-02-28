---
name: devsh
description: CLI for cloud dev VMs. Install via npm for production, or build from local source for development/testing.
---

# devsh - Cloud VMs for Development

> **Note**: `devsh` can be installed via npm for production use, or built from local source (`packages/devsh`) when developing or testing the CLI itself.

| Install | Purpose | Command |
|--------|---------|--------------|
| npm | Production CLI | `npm install -g devsh` |
| source | Development build | `make install-devsh-dev` |

## Pre-flight Check

Before using `devsh` commands, verify installation:

```bash
which devsh || ~/.local/bin/devsh --version

# If not found, build and install from source:
make install-devsh-dev
```

## Quick Start

```bash
devsh auth login              # Authenticate (opens browser)
devsh start ./my-project      # Create VM, sync directory
devsh start -p pve-lxc .      # Create VM with PVE LXC provider
devsh code <id>               # Open VS Code in browser
devsh ssh <id>                # SSH into VM
devsh exec <id> "npm run dev" # Run commands
devsh pause <id>              # Pause VM
devsh resume <id>             # Resume VM
devsh delete <id>             # Delete VM
devsh ls                      # List all VMs
```

## Provider Selection

```bash
# Explicit provider
devsh start -p morph .        # Use Morph
devsh start -p pve-lxc .      # Use PVE LXC (self-hosted)

# Auto-detect from environment
export PVE_API_URL=https://pve.example.com
export PVE_API_TOKEN=root@pam!token=secret
devsh start .                 # Auto-selects pve-lxc when PVE env vars are set
```

## Commands

### Authentication
- `devsh auth login` - Login via browser
- `devsh auth logout` - Clear credentials
- `devsh auth status` - Show authentication status
- `devsh auth whoami` - Show current user
- `devsh login` - Shorthand for `auth login`
- `devsh logout` - Shorthand for `auth logout`
- `devsh whoami` - Shorthand for `auth whoami`

### VM Lifecycle
- `devsh start [path]` - Create VM, optionally sync directory
- `devsh start -p <provider>` - Specify provider (`morph`, `pve-lxc`)
- `devsh pause <id>` - Pause VM
- `devsh resume <id>` - Resume VM
- `devsh delete <id>` - Delete VM
- `devsh ls` - List VMs
- `devsh status <id>` - Show VM status and URLs

### Access VM
- `devsh code <id>` - Open VS Code in browser
- `devsh vnc <id>` - Open VNC desktop
- `devsh ssh <id>` - SSH into VM

### Work with VM
- `devsh exec <id> "<cmd>"` - Run command
- `devsh sync <id> <path>` - Sync files to VM
- `devsh sync <id> <path> --pull` - Pull files from VM

### Task Management
Tasks are the same as in the web app dashboard. CLI and web sync through Convex.

- `devsh task list` - List active tasks
- `devsh task list --archived` - List archived tasks
- `devsh task create --repo owner/repo --agent claude-code "prompt"` - Create task
- `devsh task create --cloud-workspace ...` - Create as cloud workspace (appears in Workspaces section)
- `devsh task show <task-id>` - Get task details and runs
- `devsh task stop <task-id>` - Stop/archive task
- `devsh task memory <task-run-id>` - View agent memory for a task run

### Agent Memory
View agent memory snapshots synced from sandboxes when agents complete.

```bash
devsh task memory <task-id>              # View memory (uses latest run)
devsh task memory <task-run-id>          # View specific run's memory
devsh task memory <task-id> -t knowledge # Filter by type
devsh task memory <task-id> -t daily     # Daily logs only
devsh task memory <task-id> --json       # JSON output
```

Accepts either task ID (`p17...`) or task run ID (`ns7...`).
Memory types: `knowledge`, `daily`, `tasks`, `mailbox`

### Team Management
- `devsh team list` - List your teams
- `devsh team switch <team-slug>` - Switch to a different team

### Agent Management
- `devsh agent list` - List available coding agents

### Browser Automation
- `devsh computer snapshot <id>` - Get accessibility tree
- `devsh computer open <id> <url>` - Navigate browser
- `devsh computer click <id> @e1` - Click element
- `devsh computer screenshot <id>` - Take screenshot

## Building from Source

```bash
# From repo root
make install-devsh-dev

# Or manually
cd packages/devsh
make build-dev
cp bin/devsh ~/.local/bin/
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `PVE_API_URL` | Proxmox VE API URL |
| `PVE_API_TOKEN` | Proxmox VE API token |
| `PVE_PUBLIC_DOMAIN` | Public domain for Cloudflare Tunnel (optional) |
| `PVE_NODE` | Proxmox node name (optional, auto-detected) |
| `PVE_VERIFY_TLS` | Set to `1` to verify PVE TLS certs (optional) |
| `MORPH_API_KEY` | Morph Cloud API key |
| `DEVSH_DEV=1` | Use development backend defaults |

## Create Symlinks for Other Agents

```bash
mkdir -p .claude/skills
ln -s ../../.agents/skills/devsh .claude/skills/devsh
```
