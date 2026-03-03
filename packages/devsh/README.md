# devsh CLI

devsh - Cloud VMs for development.

## Installation

```bash
cd packages/devsh
make build
./bin/devsh --help
```

Dev install (repo root):

```bash
make install-devsh-dev
```

## Quick Start

```bash
# 1. Login
devsh auth login

# 2. Create a VM
devsh start                     # Creates VM, returns ID (e.g., cmux_abc123)
devsh start ./my-project        # Creates VM and syncs directory

# PVE LXC (self-hosted)
export PVE_API_URL=https://pve.example.com:8006
export PVE_API_TOKEN=root@pam!token=secret
devsh start -p pve-lxc          # Creates a container, returns ID (e.g., pvelxc-abc123)

# 3. Access the VM
devsh code cmux_abc123           # Open VS Code in browser
devsh ssh cmux_abc123            # SSH into VM
devsh vnc cmux_abc123            # Open VNC desktop in browser

# 4. Work with the VM
devsh exec cmux_abc123 "npm install"    # Run commands
devsh sync cmux_abc123 ./my-project     # Sync files to VM

# 5. Manage VM lifecycle
devsh pause cmux_abc123          # Pause (preserves state, saves cost)
devsh resume cmux_abc123         # Resume paused VM
devsh delete cmux_abc123         # Delete VM permanently

# 6. List VMs
devsh ls                        # List all your VMs
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `devsh auth login` | Login via browser (opens auth URL) |
| `devsh auth logout` | Logout and clear credentials |
| `devsh auth status` | Show authentication status |
| `devsh auth whoami` | Show current user |

### VM Lifecycle

| Command | Description |
|---------|-------------|
| `devsh start [path]` | Create new VM, optionally sync directory |
| `devsh start --snapshot <id>` | Create VM from specific snapshot |
| `devsh delete <id>` | Delete VM permanently |
| `devsh pause <id>` | Pause VM (preserves state) |
| `devsh resume <id>` | Resume paused VM |

### Accessing VMs

| Command | Description |
|---------|-------------|
| `devsh code <id>` | Open VS Code in browser |
| `devsh vnc <id>` | Open VNC desktop in browser |
| `devsh ssh <id>` | SSH into VM |

### Working with VMs

| Command | Description |
|---------|-------------|
| `devsh exec <id> "<command>"` | Run a command in VM |
| `devsh sync <id> <path>` | Sync local directory to VM |
| `devsh sync <id> <path> --pull` | Pull files from VM to local |

### Listing and Status

| Command | Description |
|---------|-------------|
| `devsh ls` | List all VMs (aliases: `list`, `ps`) |
| `devsh status <id>` | Show VM status and URLs |

### Browser Automation

| Command | Description |
|---------|-------------|
| `devsh computer snapshot <id>` | Get accessibility tree (interactive elements) |
| `devsh computer open <id> <url>` | Navigate browser to URL |
| `devsh computer click <id> <selector>` | Click an element (@ref or CSS) |
| `devsh computer type <id> <text>` | Type text into focused element |
| `devsh computer fill <id> <selector> <value>` | Clear and fill an input field |
| `devsh computer press <id> <key>` | Press a key (enter, tab, escape, etc.) |
| `devsh computer scroll <id> <direction>` | Scroll page (up, down, left, right) |
| `devsh computer screenshot <id> [file]` | Take a screenshot |
| `devsh computer back <id>` | Navigate back in history |
| `devsh computer forward <id>` | Navigate forward in history |
| `devsh computer reload <id>` | Reload current page |
| `devsh computer url <id>` | Get current page URL |
| `devsh computer title <id>` | Get current page title |
| `devsh computer wait <id> <selector>` | Wait for element |
| `devsh computer hover <id> <selector>` | Hover over element |

### GitHub Projects

| Command | Description |
|---------|-------------|
| `devsh project import <file>` | Import markdown plan as draft issues into a GitHub Project |

### Other

| Command | Description |
|---------|-------------|
| `devsh version` | Show version info |
| `devsh completion <shell>` | Generate shell autocompletions (bash/fish/powershell/zsh) |
| `devsh help [command]` | Show help for any command |

## Global Flags

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help for a command |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |
| `-p, --provider` | Provider (`morph` default, `pve-lxc`) |

## Command Details

### `devsh auth <command>`

Login, logout, and check authentication status.

```bash
devsh auth login
devsh auth logout
devsh auth status
devsh auth whoami
```

## PVE LXC Provider

Provider selection:

```bash
devsh start -p pve-lxc
devsh start -p morph
```

Auto-detection: if `PVE_API_URL` and `PVE_API_TOKEN` are set, `devsh start` defaults to `pve-lxc`.

Required environment variables:

```bash
PVE_API_URL=https://pve.example.com:8006
PVE_API_TOKEN=root@pam!token=secret
```

Optional environment variables:

```bash
PVE_PUBLIC_DOMAIN=example.com   # Enables https://port-<port>-<id>.<domain> URLs
PVE_NODE=pve-node-1             # Avoid auto-detecting node
PVE_VERIFY_TLS=1                # Verify PVE API TLS certs (default is off)
```

E2E test script:

```bash
./scripts/test-devsh-pvelxc.sh
```

### `devsh code <id>`

Open VS Code for a VM in your browser.

```bash
devsh code cmux_abc123
```

### `devsh vnc <id>`

Open the VNC desktop for a VM in your browser.

```bash
devsh vnc cmux_abc123
```

### `devsh ssh <id>`

SSH into a VM.

```bash
devsh ssh cmux_abc123
```

### `devsh completion <shell>`

Generate autocompletion scripts for your shell.

```bash
devsh completion bash
devsh completion fish
devsh completion powershell
devsh completion zsh
```

```bash
devsh completion <shell> --no-descriptions
```

#### Bash

```bash
source <(devsh completion bash)
```

```bash
devsh completion bash > /etc/bash_completion.d/devsh
```

```bash
devsh completion bash > $(brew --prefix)/etc/bash_completion.d/devsh
```

#### Fish

```bash
devsh completion fish | source
```

```bash
devsh completion fish > ~/.config/fish/completions/devsh.fish
```

#### PowerShell

```bash
devsh completion powershell | Out-String | Invoke-Expression
```

#### Zsh

```bash
echo "autoload -U compinit; compinit" >> ~/.zshrc
```

```bash
source <(devsh completion zsh)
```

```bash
devsh completion zsh > "${fpath[1]}/_devsh"
```

```bash
devsh completion zsh > $(brew --prefix)/share/zsh/site-functions/_devsh
```

### `devsh help [command]`

Show help for any command.

```bash
devsh help
devsh help start
devsh start --help
```

### `devsh version`

Print version information.

```bash
devsh version
```

### `devsh start [path]`

Create a new VM. Optionally sync a local directory.

```bash
devsh start                       # Create VM (no sync)
devsh start .                     # Create VM, sync current directory
devsh start ./my-project          # Create VM, sync specific directory
devsh start --snapshot=snap_xxx   # Create from specific snapshot
```

**Output:**
```
Creating VM...
VM created: cmux_abc123
Waiting for VM to be ready...

✓ VM is ready!
  ID:       cmux_abc123
  VS Code:  https://vscode-morphvm-xxx.http.cloud.morph.so
  VNC:      https://vnc-morphvm-xxx.http.cloud.morph.so
```

### `devsh pause <id>`

Pause a VM by its ID. The VM state is preserved and can be resumed later.

```bash
devsh pause cmux_abc123
```

### `devsh resume <id>`

Resume a paused VM by its ID.

```bash
devsh resume cmux_abc123
```

### `devsh delete <id>`

Delete a VM by its ID.

```bash
devsh delete cmux_abc123
```

### `devsh exec <id> "<command>"`

Execute a command in a VM.

```bash
devsh exec cmux_abc123 "ls -la"
devsh exec cmux_abc123 "npm install"
devsh exec cmux_abc123 "whoami && pwd && uname -a"
```

**Output:**
```
root
/root
Linux morphvm 5.10.225 #1 SMP Sun Dec 15 19:32:42 EST 2024 x86_64 GNU/Linux
```

### `devsh sync <id> <path>`

Sync a local directory to/from a VM. Files are synced to `/home/user/project/` in the VM.

```bash
devsh sync cmux_abc123 .                  # Push current directory to VM
devsh sync cmux_abc123 ./my-project       # Push specific directory to VM
devsh sync cmux_abc123 ./output --pull    # Pull from VM to local
```

**Excluded by default:** `.git`, `node_modules`, `.next`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, `target`

### `devsh ls`

List all your VMs. Aliases: `list`, `ps`

```bash
devsh ls
```

**Output:**
```
ID                   STATUS     VS CODE URL
-------------------- ---------- ----------------------------------------
cmux_abc123           running
cmux_def456           paused
```

### `devsh status <id>`

Show detailed status of a VM.

```bash
devsh status cmux_abc123
```

**Output:**
```
ID:       cmux_abc123
Status:   running
VS Code:  https://vscode-morphvm-xxx.http.cloud.morph.so
VNC:      https://vnc-morphvm-xxx.http.cloud.morph.so
```

### `devsh computer <command>`

Browser automation commands for controlling Chrome in the VNC desktop via CDP.

#### `devsh computer snapshot <id>`

Get an accessibility tree snapshot showing interactive elements.

```bash
devsh computer snapshot cmux_abc123
```

**Output:**
```
URL: https://example.com
Title: Example Domain

@e1: link "More information..."
@e2: heading "Example Domain"
```

#### `devsh computer open <id> <url>`

Navigate the browser to a URL.

```bash
devsh computer open cmux_abc123 https://google.com
```

#### `devsh computer click <id> <selector>`

Click an element by ref (from snapshot) or CSS selector.

```bash
devsh computer click cmux_abc123 @e1           # Click by ref
devsh computer click cmux_abc123 "#submit"     # Click by CSS selector
devsh computer click cmux_abc123 ".btn-login"  # Click by class
```

#### `devsh computer type <id> <text>`

Type text into the currently focused element.

```bash
devsh computer type cmux_abc123 "hello world"
```

#### `devsh computer fill <id> <selector> <value>`

Clear an input field and fill it with a new value.

```bash
devsh computer fill cmux_abc123 @e2 "user@example.com"
devsh computer fill cmux_abc123 "#email" "user@example.com"
```

#### `devsh computer press <id> <key>`

Press a keyboard key.

```bash
devsh computer press cmux_abc123 enter
devsh computer press cmux_abc123 tab
devsh computer press cmux_abc123 escape
```

**Common keys:** `enter`, `tab`, `escape`, `backspace`, `delete`, `space`, `up`, `down`, `left`, `right`

#### `devsh computer scroll <id> <direction> [amount]`

Scroll the page. Default amount is 300 pixels.

```bash
devsh computer scroll cmux_abc123 down
devsh computer scroll cmux_abc123 up 500
```

**Directions:** `up`, `down`, `left`, `right`

#### `devsh computer screenshot <id> [output-file]`

Take a screenshot. If no file is specified, outputs base64-encoded PNG.

```bash
devsh computer screenshot cmux_abc123                    # Output base64
devsh computer screenshot cmux_abc123 screenshot.png    # Save to file
devsh computer screenshot cmux_abc123 --full-page       # Full page capture
```

#### `devsh computer back/forward/reload <id>`

Navigation history controls.

```bash
devsh computer back cmux_abc123
devsh computer forward cmux_abc123
devsh computer reload cmux_abc123
```

#### `devsh computer url/title <id>`

Get current page URL or title.

```bash
devsh computer url cmux_abc123     # Output: https://example.com
devsh computer title cmux_abc123   # Output: Example Domain
```

#### `devsh computer wait <id> <selector>`

Wait for an element to be in a specific state.

```bash
devsh computer wait cmux_abc123 "#content"                   # Wait for visible
devsh computer wait cmux_abc123 "#loading" --state=hidden    # Wait for hidden
devsh computer wait cmux_abc123 ".modal" --timeout=10000     # Custom timeout
```

**States:** `visible` (default), `hidden`, `attached`

#### `devsh computer hover <id> <selector>`

Hover over an element.

```bash
devsh computer hover cmux_abc123 @e5
devsh computer hover cmux_abc123 ".dropdown-trigger"
```

### `devsh project import <file>`

Import a markdown plan file into a GitHub Project as draft issues. Each H2 section (`## Section Title`) becomes a separate draft issue.

```bash
devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345
devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345 --dry-run
```

**Required flags:**
- `--project-id`: GitHub Project node ID (e.g., `PVT_kwHOCIJ7ws4BQeq2`). Get it via `gh project list --owner <owner> --format json | jq '.projects[].id'`
- `--installation-id`: GitHub App installation ID (required unless using `--dry-run`). Find it in the cmux database or via the team's provider connections.

**Optional flags:**
- `--dry-run`: Parse and preview items without importing (does not require `--installation-id`)

**GitHub App Permission Requirements:**

GitHub Apps **cannot access user-owned Projects v2** - this is a GitHub platform limitation. Only organization projects work with GitHub App authentication.

For organization projects, the GitHub App requires "Organization projects: Read and write" permission.

If you see "Resource not accessible by integration" errors:
1. Make sure you're using an **organization** project (not a user project)
2. Verify the GitHub App has "Organization projects" permission

**Workaround for user projects:** Use the `gh` CLI directly (requires OAuth token with `project` scope):

```bash
# Create draft issues manually with gh CLI
gh project item-create 3 --owner karlorz --title "My Task" --body "Description"
```

## Examples

### Typical Development Workflow

```bash
# Start of day: create or resume a VM
devsh start ./my-project
# → cmux_abc123

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

### Multiple VMs

```bash
# Create multiple VMs for different tasks
devsh start ./frontend    # → cmux_frontend1
devsh start ./backend     # → cmux_backend1

# Work on them independently
devsh code cmux_frontend1
devsh code cmux_backend1

# List all
devsh ls
```

### Browser Automation

```bash
# Navigate to a website
devsh computer open cmux_abc123 https://github.com/login

# Get interactive elements
devsh computer snapshot cmux_abc123
# Output:
# @e1: textbox "Username or email address"
# @e2: textbox "Password"
# @e3: button "Sign in"

# Fill in the login form
devsh computer fill cmux_abc123 @e1 "username"
devsh computer fill cmux_abc123 @e2 "password"

# Click the submit button
devsh computer click cmux_abc123 @e3

# Wait for page to load
devsh computer wait cmux_abc123 ".dashboard"

# Take a screenshot
devsh computer screenshot cmux_abc123 result.png
```

### Pull Files from VM

```bash
# After building/generating files in VM
devsh exec cmux_abc123 "npm run build"

# Pull the output
devsh sync cmux_abc123 ./dist --pull
```

### Shell Completion

```bash
# Bash
devsh completion bash > /etc/bash_completion.d/devsh

# Zsh
devsh completion zsh > "${fpath[1]}/_devsh"

# Fish
devsh completion fish > ~/.config/fish/completions/devsh.fish

# PowerShell
devsh completion powershell | Out-String | Invoke-Expression
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DEVSH_DEV=1` | Use development environment |

## Development

```bash
# Build
make build

# Run directly
./bin/devsh --help

# Build with race detector
make build-race
```

## Testing Browser Automation

The browser automation commands use a worker daemon running inside the VM that wraps `agent-browser` (Vercel's CLI tool) and connects to Chrome via CDP.

### Architecture

```
CLI (your machine)
    │
    ├─→ devsh exec: read /var/run/cmux/worker-token
    │
    ↓
Worker daemon (https://worker-xxx.http.cloud.morph.so:39377)
    │ Bearer token auth required
    ↓
agent-browser --cdp 9222
    │ localhost only
    ↓
Chrome CDP (127.0.0.1:9222)
```

### Manual Testing on Existing VM

If the VM doesn't have the worker daemon set up yet, you can install it manually:

```bash
# 1. Install agent-browser
./bin/devsh exec <id> "npm install -g agent-browser"

# 2. Upload the worker daemon script
cat packages/devsh/worker/server.js | base64 | tr -d '\n' > /tmp/worker_b64.txt
B64=$(cat /tmp/worker_b64.txt)
./bin/devsh exec <id> "echo '$B64' | base64 -d > /usr/local/bin/devsh-worker && chmod +x /usr/local/bin/devsh-worker"

# 3. Create token directory and start worker
./bin/devsh exec <id> "mkdir -p /var/run/cmux"
./bin/devsh exec <id> "nohup node /usr/local/bin/devsh-worker > /var/log/devsh-worker.log 2>&1 &"

# 4. Verify worker is running
./bin/devsh exec <id> "curl -s http://localhost:39377/health"
# Output: {"status":"ok"}

# 5. Get the auth token
./bin/devsh exec <id> "cat /var/run/cmux/worker-token"
```

### Test Commands

```bash
# Get accessibility tree (shows interactive elements with refs like @e1, @e2)
./bin/devsh computer snapshot <id>

# Navigate to a URL
./bin/devsh computer open <id> "https://example.com"

# Get snapshot after navigation
./bin/devsh computer snapshot <id>

# Click an element by ref
./bin/devsh computer click <id> @e2

# Take a screenshot
./bin/devsh computer screenshot <id> /tmp/test.png

# Verify screenshot
file /tmp/test.png
# Output: /tmp/test.png: PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
```

### Test Worker API Directly (inside VM)

```bash
# Get the token
TOKEN=$(./bin/devsh exec <id> "cat /var/run/cmux/worker-token")

# Test health (no auth required)
./bin/devsh exec <id> "curl -s http://localhost:39377/health"

# Test snapshot with auth
./bin/devsh exec <id> "curl -s -X POST http://localhost:39377/snapshot -H 'Authorization: Bearer $TOKEN'"

# Test open URL
./bin/devsh exec <id> "curl -s -X POST http://localhost:39377/open -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '{\"url\":\"https://google.com\"}'"

# Test without auth (should fail)
./bin/devsh exec <id> "curl -s -X POST http://localhost:39377/snapshot"
# Output: {"error":"Unauthorized","message":"Valid Bearer token required"}
```

### Testing JWT Authentication

The browser automation commands use Stack Auth JWT authentication. When a new VM is created, the owner's user ID and Stack Auth project ID are injected into the VM, and the worker daemon validates JWTs on each request.

#### Quick Test

```bash
# 1. Build and login
cd packages/devsh
make build
./bin/devsh login

# 2. Create a new VM
./bin/devsh start
# Output: cmux_abc123

# 3. Verify auth config was injected
./bin/devsh exec cmux_abc123 "cat /var/run/cmux/owner-id"
# Should output your user ID (UUID format)

./bin/devsh exec cmux_abc123 "cat /var/run/cmux/stack-project-id"
# Should output the Stack Auth project ID

# 4. Check worker daemon is running with auth config
./bin/devsh exec cmux_abc123 "systemctl status devsh-worker"
# Should show: "Auth config loaded: owner=..., project=..."

# 5. Test browser commands (uses JWT auth automatically)
./bin/devsh computer snapshot cmux_abc123
# Should return accessibility tree (e.g., "- document")

./bin/devsh computer open cmux_abc123 "https://example.com"
# Should output: "Navigated to: https://example.com"

./bin/devsh computer snapshot cmux_abc123
# Should show Example Domain content with refs like @e1, @e2
```

#### How JWT Auth Works

1. **Instance Creation**: When `devsh start` creates a VM, the Convex backend injects:
   - `/var/run/cmux/owner-id` - The authenticated user's Stack Auth subject ID
   - `/var/run/cmux/stack-project-id` - The Stack Auth project ID for JWKS validation

2. **Worker Startup**: The `devsh-worker` systemd service reads these files and configures JWT validation

3. **Request Flow**:
   ```
   CLI → gets JWT from ~/.config/cmux/credentials.json
       → sends request to worker URL with Authorization: Bearer <JWT>
       → worker validates JWT signature via Stack Auth JWKS
       → worker checks JWT subject matches owner-id file
       → if valid, executes browser command via agent-browser
   ```

4. **Security**: Only the instance owner can control the browser. The worker URL is public but requires a valid JWT from the correct user.

#### Troubleshooting

```bash
# Check if auth files exist and have content
./bin/devsh exec <id> "ls -la /var/run/cmux/"
./bin/devsh exec <id> "wc -c /var/run/cmux/owner-id"  # Should be 36-37 bytes

# Check worker logs
./bin/devsh exec <id> "journalctl -u devsh-worker -n 50"

# Restart worker after manual changes
./bin/devsh exec <id> "systemctl restart devsh-worker"

# Test worker health (no auth required)
./bin/devsh exec <id> "curl -s http://localhost:39377/health"
```

### Rebuilding the Snapshot

To include agent-browser and the worker daemon in new VMs:

```bash
cd /path/to/cmux/apps/devbox/scripts
python create_base_snapshot.py
```

This runs `setup_base_snapshot.sh` which:
1. Installs agent-browser globally via npm
2. Embeds the devsh-worker script at `/usr/local/bin/devsh-worker`
3. Creates a systemd service `devsh-worker.service`
4. Configures Chrome to listen on `127.0.0.1:9222` only (not externally accessible)
