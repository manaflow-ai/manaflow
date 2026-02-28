---
name: cmux
description: Alias skill for devsh CLI (formerly cmux). Manage cloud development VMs with built-in browser automation.
---

# devsh - Cloud VMs for Development

devsh manages cloud VMs for development. Use these commands to create, manage, and access remote development environments with built-in browser automation.

> **Note**: This skill documents the Go-based devsh CLI from `packages/devsh`. The npm package `devsh` installs this CLI.

## Installation

```bash
npm install -g devsh
```

Or build from source:
```bash
cd packages/devsh
make build-dev
./bin/devsh --help
```

## Quick Start

```bash
devsh auth login                 # Authenticate (opens browser)
devsh start ./my-project         # Create VM, sync directory, returns ID
devsh start .                    # Or use current directory
devsh code <id>                  # Open VS Code in browser
devsh ssh <id>                   # SSH into VM
devsh vnc <id>                   # Open VNC desktop in browser
devsh exec <id> "npm run dev"    # Run commands in VM
devsh sync <id> ./my-project     # Sync files to VM
devsh pause <id>                 # Pause VM (preserves state)
devsh resume <id>                # Resume paused VM
devsh delete <id>                # Delete VM permanently
devsh ls                         # List all VMs
```

## Commands

### Authentication

```bash
devsh auth login          # Login via browser (opens auth URL)
devsh auth logout         # Logout and clear credentials
devsh auth status         # Show authentication status
devsh auth whoami         # Show current user
```

### VM Lifecycle

```bash
devsh start                       # Create VM (no sync)
devsh start .                     # Create VM, sync current directory
devsh start ./my-project          # Create VM, sync specific directory
devsh start --snapshot=snap_xxx   # Create from specific snapshot
devsh pause <id>                  # Pause VM (preserves state, saves cost)
devsh resume <id>                 # Resume paused VM
devsh delete <id>                 # Delete VM permanently
devsh ls                          # List all VMs (aliases: list, ps)
devsh status <id>                 # Show VM status and URLs
```

### Access VM

```bash
devsh code <id>           # Open VS Code in browser
devsh vnc <id>            # Open VNC desktop in browser
devsh ssh <id>            # SSH into VM
```

### Work with VM

```bash
devsh exec <id> "<command>"       # Run a command in VM
devsh sync <id> <path>            # Sync local directory to VM
devsh sync <id> <path> --pull     # Pull files from VM to local
```

**Excluded by default:** `.git`, `node_modules`, `.next`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, `target`

### Task Management

Tasks are synced between CLI and web app through Convex as the source of truth.

```bash
devsh task list                   # List all active tasks
devsh task list --archived        # List archived tasks
devsh task create "Add tests"     # Create task with prompt only
devsh task create --repo owner/repo --agent claude-code "Fix bug"
devsh task create --repo owner/repo --agent claude-code --agent opencode/gpt-4o "Compare solutions"
devsh task create --cloud-workspace --repo owner/repo --agent claude-code "Long-running workspace"
devsh task show <task-id>         # Get task details and runs
devsh task stop <task-id>         # Stop/archive task
devsh task memory <task-run-id>   # View agent memory for a task run
```

#### Cloud Workspaces

Use `--cloud-workspace` to create tasks that appear in the "Workspaces" section of the web UI instead of "In Progress". Cloud workspaces are designed for long-running development environments.

```bash
devsh task create --cloud-workspace --repo owner/repo --agent claude-code "Set up dev environment"
```

### Agent Memory

View agent memory snapshots (knowledge, daily logs, tasks, mailbox) synced from sandboxes.

```bash
devsh task memory <task-id>                    # View memory (uses latest task run)
devsh task memory <task-run-id>                # View memory for specific run
devsh task memory <task-id> --type knowledge   # Filter by memory type
devsh task memory <task-id> --type daily       # View daily logs only
devsh task memory <task-id> --type tasks       # View task tracking
devsh task memory <task-id> --type mailbox     # View mailbox messages
devsh task memory <task-id> --json             # Output as JSON
```

You can use either:
- **Task ID** (e.g., `p17xyz...`) - automatically uses the latest task run
- **Task run ID** (e.g., `ns7xyz...`) - uses that specific run

Memory types:
- **knowledge**: Accumulated knowledge and learnings (P0/P1/P2 priority tiers)
- **daily**: Daily activity logs (ephemeral, session-specific)
- **tasks**: Task tracking and progress (JSON)
- **mailbox**: Communication messages between agents (JSON)

Memory is synced when an agent completes. If no memory appears, the task run may still be in progress.

### Team Management

```bash
devsh team list                   # List your teams
devsh team switch <team-slug>     # Switch to a different team
```

### Agent Management

```bash
devsh agent list                  # List available coding agents
```

### Model Management

```bash
devsh models list                       # List all available models
devsh models list --provider anthropic  # Filter by vendor
devsh models list --verbose             # Show API keys required
devsh models list --enabled-only        # Only show enabled models
devsh models list --json                # JSON output for scripting
devsh models list claude                # Filter by name
```

### Browser Automation (devsh computer)

Control Chrome browser via CDP in the VM's VNC desktop.

#### Navigation

```bash
devsh computer open <id> <url>    # Navigate to URL
devsh computer back <id>          # Navigate back
devsh computer forward <id>       # Navigate forward
devsh computer reload <id>        # Reload page
devsh computer url <id>           # Get current URL
devsh computer title <id>         # Get page title
```

#### Inspect Page

```bash
devsh computer snapshot <id>             # Get accessibility tree with element refs (@e1, @e2...)
devsh computer screenshot <id>           # Take screenshot (base64 to stdout)
devsh computer screenshot <id> out.png   # Save screenshot to file
devsh computer screenshot <id> --full-page  # Full page capture
```

#### Interact with Elements

```bash
devsh computer click <id> <selector>      # Click element (@e1 or CSS selector)
devsh computer type <id> "text"           # Type into focused element
devsh computer fill <id> <sel> "value"    # Clear input and fill with value
devsh computer press <id> <key>           # Press key (enter, tab, escape, etc.)
devsh computer hover <id> <selector>      # Hover over element
devsh computer scroll <id> <direction>    # Scroll page (up/down/left/right)
devsh computer scroll <id> down 500       # Scroll with custom amount (pixels)
devsh computer wait <id> <selector>       # Wait for element to appear
devsh computer wait <id> <sel> --state=hidden  # Wait for element to be hidden
```

#### Element Selectors

Two ways to select elements:
- **Element refs** from snapshot: `@e1`, `@e2`, `@e3`...
- **CSS selectors**: `#id`, `.class`, `button[type="submit"]`

## VM IDs

VM IDs look like `cmux_abc12345`. Use the full ID when running commands. Get IDs from `devsh ls` or `devsh start` output.

## Common Workflows

### Create and develop in a VM

```bash
devsh start ./my-project        # Creates VM, syncs files
devsh code cmux_abc123          # Open VS Code
devsh exec cmux_abc123 "npm install && npm run dev"
```

### File sync workflow

```bash
devsh sync cmux_abc123 ./my-project       # Push local files to VM
# ... do work in VM ...
devsh sync cmux_abc123 ./output --pull    # Pull files from VM to local
```

### Browser automation: Login to a website

```bash
devsh computer open cmux_abc123 "https://example.com/login"
devsh computer snapshot cmux_abc123
# Output: @e1 [input] Email, @e2 [input] Password, @e3 [button] Sign In

devsh computer fill cmux_abc123 @e1 "user@example.com"
devsh computer fill cmux_abc123 @e2 "password123"
devsh computer click cmux_abc123 @e3
devsh computer screenshot cmux_abc123 result.png
```

### Typical development workflow

```bash
# Start of day: create or resume a VM
devsh start ./my-project
# -> cmux_abc123

# Work on your code
devsh code cmux_abc123        # Opens VS Code in browser

# Run commands
devsh exec cmux_abc123 "npm run dev"

# Sync changes
devsh sync cmux_abc123 ./my-project

# End of day: pause to save costs
devsh pause cmux_abc123

# Next day: resume where you left off
devsh resume cmux_abc123
```

### Clean up

```bash
devsh pause cmux_abc123     # Pause (can resume later)
devsh delete cmux_abc123    # Delete permanently
```

## Global Flags

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help for a command |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |
| `-p, --provider` | Sandbox provider: `morph`, `pve-lxc` (auto-detected from env) |

## Shorthand Commands

```bash
devsh login              # Shorthand for devsh auth login
devsh logout             # Shorthand for devsh auth logout
devsh whoami             # Shorthand for devsh auth whoami
```

## Security: Dev Server URLs

**CRITICAL: NEVER share or output raw port-forwarded URLs.**

When a dev server runs in the VM (e.g., Vite on port 5173), the provider may create publicly accessible URLs. These URLs have **NO authentication**.

**Rules:**
- **ALWAYS** tell the user to view dev servers through VNC: `devsh vnc <id>`
- VNC is protected by token authentication and is the only safe way to view dev server output
- Only VS Code URLs (`devsh code <id>`) and VNC URLs (`devsh vnc <id>`) should be shared

## Tips

- Run `devsh auth login` first if not authenticated
- Use `--json` flag for machine-readable output
- Use `-v` for verbose output
- Always run `snapshot` first to see available elements before browser automation
- Use element refs (`@e1`) for reliability over CSS selectors
- Use `devsh pause` to preserve state and save costs when not actively working

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DEVSH_DEV=1` | Use development environment |
| `PVE_API_URL` | Proxmox VE API URL (enables pve-lxc provider) |
| `PVE_API_TOKEN` | Proxmox VE API token |
| `PVE_PUBLIC_DOMAIN` | Public domain for Cloudflare Tunnel |
| `MORPH_API_KEY` | Morph Cloud API key |
