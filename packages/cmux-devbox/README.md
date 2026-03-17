# cmux devbox CLI

cmux devbox - Cloud VMs for development.

## Installation

```bash
cd packages/cmux-devbox
make build
./bin/cmux-devbox --help
```

## Quick Start

```bash
# 1. Login
cmux auth login

# 2. Create a VM
cmux start                     # Creates VM, returns ID (e.g., cmux_abc123)
cmux start ./my-project        # Creates VM and syncs directory

# 3. Access the VM
cmux code cmux_abc123           # Open VS Code in browser
cmux ssh cmux_abc123            # SSH into VM
cmux vnc cmux_abc123            # Open VNC desktop in browser

# 4. Work with the VM
cmux exec cmux_abc123 "npm install"    # Run commands
cmux sync cmux_abc123 ./my-project     # Sync files to VM

# 5. Manage VM lifecycle
cmux pause cmux_abc123          # Pause (preserves state, saves cost)
cmux resume cmux_abc123         # Resume paused VM
cmux delete cmux_abc123         # Delete VM permanently

# 6. List VMs
cmux ls                        # List all your VMs
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `cmux auth login` | Login via browser (opens auth URL) |
| `cmux auth logout` | Logout and clear credentials |
| `cmux auth status` | Show authentication status |
| `cmux auth whoami` | Show current user |

### VM Lifecycle

| Command | Description |
|---------|-------------|
| `cmux start [path]` | Create new VM, optionally sync directory |
| `cmux start --snapshot <id>` | Create VM from specific snapshot |
| `cmux delete <id>` | Delete VM permanently |
| `cmux pause <id>` | Pause VM (preserves state) |
| `cmux resume <id>` | Resume paused VM |

### Accessing VMs

| Command | Description |
|---------|-------------|
| `cmux code <id>` | Open VS Code in browser |
| `cmux vnc <id>` | Open VNC desktop in browser |
| `cmux ssh <id>` | SSH into VM |

### Working with VMs

| Command | Description |
|---------|-------------|
| `cmux exec <id> "<command>"` | Run a command in VM |
| `cmux sync <id> <path>` | Sync local directory to VM |
| `cmux sync <id> <path> --pull` | Pull files from VM to local |

### Listing and Status

| Command | Description |
|---------|-------------|
| `cmux ls` | List all VMs (aliases: `list`, `ps`) |
| `cmux status <id>` | Show VM status and URLs |

### Browser Automation

| Command | Description |
|---------|-------------|
| `cmux computer snapshot <id>` | Get accessibility tree (interactive elements) |
| `cmux computer open <id> <url>` | Navigate browser to URL |
| `cmux computer click <id> <selector>` | Click an element (@ref or CSS) |
| `cmux computer type <id> <text>` | Type text into focused element |
| `cmux computer fill <id> <selector> <value>` | Clear and fill an input field |
| `cmux computer press <id> <key>` | Press a key (enter, tab, escape, etc.) |
| `cmux computer scroll <id> <direction>` | Scroll page (up, down, left, right) |
| `cmux computer screenshot <id> [file]` | Take a screenshot |
| `cmux computer back <id>` | Navigate back in history |
| `cmux computer forward <id>` | Navigate forward in history |
| `cmux computer reload <id>` | Reload current page |
| `cmux computer url <id>` | Get current page URL |
| `cmux computer title <id>` | Get current page title |
| `cmux computer wait <id> <selector>` | Wait for element |
| `cmux computer hover <id> <selector>` | Hover over element |

### Other

| Command | Description |
|---------|-------------|
| `cmux version` | Show version info |
| `cmux completion <shell>` | Generate shell autocompletions (bash/fish/powershell/zsh) |
| `cmux help [command]` | Show help for any command |

## Global Flags

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help for a command |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |

## Command Details

### `cmux auth <command>`

Login, logout, and check authentication status.

```bash
cmux auth login
cmux auth logout
cmux auth status
cmux auth whoami
```

### `cmux code <id>`

Open VS Code for a VM in your browser.

```bash
cmux code cmux_abc123
```

### `cmux vnc <id>`

Open the VNC desktop for a VM in your browser.

```bash
cmux vnc cmux_abc123
```

### `cmux ssh <id>`

SSH into a VM.

```bash
cmux ssh cmux_abc123
```

### `cmux completion <shell>`

Generate autocompletion scripts for your shell.

```bash
cmux completion bash
cmux completion fish
cmux completion powershell
cmux completion zsh
```

```bash
cmux completion <shell> --no-descriptions
```

#### Bash

```bash
source <(cmux completion bash)
```

```bash
cmux completion bash > /etc/bash_completion.d/cmux
```

```bash
cmux completion bash > $(brew --prefix)/etc/bash_completion.d/cmux
```

#### Fish

```bash
cmux completion fish | source
```

```bash
cmux completion fish > ~/.config/fish/completions/cmux.fish
```

#### PowerShell

```bash
cmux completion powershell | Out-String | Invoke-Expression
```

#### Zsh

```bash
echo "autoload -U compinit; compinit" >> ~/.zshrc
```

```bash
source <(cmux completion zsh)
```

```bash
cmux completion zsh > "${fpath[1]}/_cmux"
```

```bash
cmux completion zsh > $(brew --prefix)/share/zsh/site-functions/_cmux
```

### `cmux help [command]`

Show help for any command.

```bash
cmux help
cmux help start
cmux start --help
```

### `cmux version`

Print version information.

```bash
cmux version
```

### `cmux start [path]`

Create a new VM. Optionally sync a local directory.

```bash
cmux start                       # Create VM (no sync)
cmux start .                     # Create VM, sync current directory
cmux start ./my-project          # Create VM, sync specific directory
cmux start --snapshot=snap_xxx   # Create from specific snapshot
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

### `cmux pause <id>`

Pause a VM by its ID. The VM state is preserved and can be resumed later.

```bash
cmux pause cmux_abc123
```

### `cmux resume <id>`

Resume a paused VM by its ID.

```bash
cmux resume cmux_abc123
```

### `cmux delete <id>`

Delete a VM by its ID.

```bash
cmux delete cmux_abc123
```

### `cmux exec <id> "<command>"`

Execute a command in a VM.

```bash
cmux exec cmux_abc123 "ls -la"
cmux exec cmux_abc123 "npm install"
cmux exec cmux_abc123 "whoami && pwd && uname -a"
```

**Output:**
```
root
/root
Linux morphvm 5.10.225 #1 SMP Sun Dec 15 19:32:42 EST 2024 x86_64 GNU/Linux
```

### `cmux sync <id> <path>`

Sync a local directory to/from a VM. Files are synced to `/home/user/project/` in the VM.

```bash
cmux sync cmux_abc123 .                  # Push current directory to VM
cmux sync cmux_abc123 ./my-project       # Push specific directory to VM
cmux sync cmux_abc123 ./output --pull    # Pull from VM to local
```

**Excluded by default:** `.git`, `node_modules`, `.next`, `dist`, `build`, `__pycache__`, `.venv`, `venv`, `target`

### `cmux ls`

List all your VMs. Aliases: `list`, `ps`

```bash
cmux ls
```

**Output:**
```
ID                   STATUS     VS CODE URL
-------------------- ---------- ----------------------------------------
cmux_abc123           running
cmux_def456           paused
```

### `cmux status <id>`

Show detailed status of a VM.

```bash
cmux status cmux_abc123
```

**Output:**
```
ID:       cmux_abc123
Status:   running
VS Code:  https://vscode-morphvm-xxx.http.cloud.morph.so
VNC:      https://vnc-morphvm-xxx.http.cloud.morph.so
```

### `cmux computer <command>`

Browser automation commands for controlling Chrome in the VNC desktop via CDP.

#### `cmux computer snapshot <id>`

Get an accessibility tree snapshot showing interactive elements.

```bash
cmux computer snapshot cmux_abc123
```

**Output:**
```
URL: https://example.com
Title: Example Domain

@e1: link "More information..."
@e2: heading "Example Domain"
```

#### `cmux computer open <id> <url>`

Navigate the browser to a URL.

```bash
cmux computer open cmux_abc123 https://google.com
```

#### `cmux computer click <id> <selector>`

Click an element by ref (from snapshot) or CSS selector.

```bash
cmux computer click cmux_abc123 @e1           # Click by ref
cmux computer click cmux_abc123 "#submit"     # Click by CSS selector
cmux computer click cmux_abc123 ".btn-login"  # Click by class
```

#### `cmux computer type <id> <text>`

Type text into the currently focused element.

```bash
cmux computer type cmux_abc123 "hello world"
```

#### `cmux computer fill <id> <selector> <value>`

Clear an input field and fill it with a new value.

```bash
cmux computer fill cmux_abc123 @e2 "user@example.com"
cmux computer fill cmux_abc123 "#email" "user@example.com"
```

#### `cmux computer press <id> <key>`

Press a keyboard key.

```bash
cmux computer press cmux_abc123 enter
cmux computer press cmux_abc123 tab
cmux computer press cmux_abc123 escape
```

**Common keys:** `enter`, `tab`, `escape`, `backspace`, `delete`, `space`, `up`, `down`, `left`, `right`

#### `cmux computer scroll <id> <direction> [amount]`

Scroll the page. Default amount is 300 pixels.

```bash
cmux computer scroll cmux_abc123 down
cmux computer scroll cmux_abc123 up 500
```

**Directions:** `up`, `down`, `left`, `right`

#### `cmux computer screenshot <id> [output-file]`

Take a screenshot. If no file is specified, outputs base64-encoded PNG.

```bash
cmux computer screenshot cmux_abc123                    # Output base64
cmux computer screenshot cmux_abc123 screenshot.png    # Save to file
cmux computer screenshot cmux_abc123 --full-page       # Full page capture
```

#### `cmux computer back/forward/reload <id>`

Navigation history controls.

```bash
cmux computer back cmux_abc123
cmux computer forward cmux_abc123
cmux computer reload cmux_abc123
```

#### `cmux computer url/title <id>`

Get current page URL or title.

```bash
cmux computer url cmux_abc123     # Output: https://example.com
cmux computer title cmux_abc123   # Output: Example Domain
```

#### `cmux computer wait <id> <selector>`

Wait for an element to be in a specific state.

```bash
cmux computer wait cmux_abc123 "#content"                   # Wait for visible
cmux computer wait cmux_abc123 "#loading" --state=hidden    # Wait for hidden
cmux computer wait cmux_abc123 ".modal" --timeout=10000     # Custom timeout
```

**States:** `visible` (default), `hidden`, `attached`

#### `cmux computer hover <id> <selector>`

Hover over an element.

```bash
cmux computer hover cmux_abc123 @e5
cmux computer hover cmux_abc123 ".dropdown-trigger"
```

## Examples

### Typical Development Workflow

```bash
# Start of day: create or resume a VM
cmux start ./my-project
# → cmux_abc123

# Work on your code
cmux code cmux_abc123        # Opens VS Code in browser

# Run commands
cmux exec cmux_abc123 "npm run dev"

# Sync changes
cmux sync cmux_abc123 ./my-project

# End of day: pause to save costs
cmux pause cmux_abc123

# Next day: resume where you left off
cmux resume cmux_abc123
```

### Multiple VMs

```bash
# Create multiple VMs for different tasks
cmux start ./frontend    # → cmux_frontend1
cmux start ./backend     # → cmux_backend1

# Work on them independently
cmux code cmux_frontend1
cmux code cmux_backend1

# List all
cmux ls
```

### Browser Automation

```bash
# Navigate to a website
cmux computer open cmux_abc123 https://github.com/login

# Get interactive elements
cmux computer snapshot cmux_abc123
# Output:
# @e1: textbox "Username or email address"
# @e2: textbox "Password"
# @e3: button "Sign in"

# Fill in the login form
cmux computer fill cmux_abc123 @e1 "username"
cmux computer fill cmux_abc123 @e2 "password"

# Click the submit button
cmux computer click cmux_abc123 @e3

# Wait for page to load
cmux computer wait cmux_abc123 ".dashboard"

# Take a screenshot
cmux computer screenshot cmux_abc123 result.png
```

### Pull Files from VM

```bash
# After building/generating files in VM
cmux exec cmux_abc123 "npm run build"

# Pull the output
cmux sync cmux_abc123 ./dist --pull
```

### Shell Completion

```bash
# Bash
cmux completion bash > /etc/bash_completion.d/cmux

# Zsh
cmux completion zsh > "${fpath[1]}/_cmux"

# Fish
cmux completion fish > ~/.config/fish/completions/cmux.fish

# PowerShell
cmux completion powershell | Out-String | Invoke-Expression
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CMUX_DEVBOX_DEV=1` | Use development environment |

## Development

```bash
# Build
make build

# Run directly
./bin/cmux-devbox --help

# Build with race detector
make build-race
```

## Testing Browser Automation

The browser automation commands use a worker daemon running inside the VM that wraps `agent-browser` (Vercel's CLI tool) and connects to Chrome via CDP.

### Architecture

```
CLI (your machine)
    │
    ├─→ cmux exec: read /var/run/cmux/worker-token
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
./bin/cmux-devbox exec <id> "npm install -g agent-browser"

# 2. Upload the worker daemon script
cat packages/cmux-devbox/worker/server.js | base64 | tr -d '\n' > /tmp/worker_b64.txt
B64=$(cat /tmp/worker_b64.txt)
./bin/cmux-devbox exec <id> "echo '$B64' | base64 -d > /usr/local/bin/cmux-devbox-worker && chmod +x /usr/local/bin/cmux-devbox-worker"

# 3. Create token directory and start worker
./bin/cmux-devbox exec <id> "mkdir -p /var/run/cmux"
./bin/cmux-devbox exec <id> "nohup node /usr/local/bin/cmux-devbox-worker > /var/log/cmux-devbox-worker.log 2>&1 &"

# 4. Verify worker is running
./bin/cmux-devbox exec <id> "curl -s http://localhost:39377/health"
# Output: {"status":"ok"}

# 5. Get the auth token
./bin/cmux-devbox exec <id> "cat /var/run/cmux/worker-token"
```

### Test Commands

```bash
# Get accessibility tree (shows interactive elements with refs like @e1, @e2)
./bin/cmux-devbox computer snapshot <id>

# Navigate to a URL
./bin/cmux-devbox computer open <id> "https://example.com"

# Get snapshot after navigation
./bin/cmux-devbox computer snapshot <id>

# Click an element by ref
./bin/cmux-devbox computer click <id> @e2

# Take a screenshot
./bin/cmux-devbox computer screenshot <id> /tmp/test.png

# Verify screenshot
file /tmp/test.png
# Output: /tmp/test.png: PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
```

### Test Worker API Directly (inside VM)

```bash
# Get the token
TOKEN=$(./bin/cmux-devbox exec <id> "cat /var/run/cmux/worker-token")

# Test health (no auth required)
./bin/cmux-devbox exec <id> "curl -s http://localhost:39377/health"

# Test snapshot with auth
./bin/cmux-devbox exec <id> "curl -s -X POST http://localhost:39377/snapshot -H 'Authorization: Bearer $TOKEN'"

# Test open URL
./bin/cmux-devbox exec <id> "curl -s -X POST http://localhost:39377/open -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '{\"url\":\"https://google.com\"}'"

# Test without auth (should fail)
./bin/cmux-devbox exec <id> "curl -s -X POST http://localhost:39377/snapshot"
# Output: {"error":"Unauthorized","message":"Valid Bearer token required"}
```

### Testing JWT Authentication

The browser automation commands use Stack Auth JWT authentication. When a new VM is created, the owner's user ID and Stack Auth project ID are injected into the VM, and the worker daemon validates JWTs on each request.

#### Quick Test

```bash
# 1. Build and login
cd packages/cmux-devbox
make build
./bin/cmux-devbox login

# 2. Create a new VM
./bin/cmux-devbox start
# Output: cmux_abc123

# 3. Verify auth config was injected
./bin/cmux-devbox exec cmux_abc123 "cat /var/run/cmux/owner-id"
# Should output your user ID (UUID format)

./bin/cmux-devbox exec cmux_abc123 "cat /var/run/cmux/stack-project-id"
# Should output the Stack Auth project ID

# 4. Check worker daemon is running with auth config
./bin/cmux-devbox exec cmux_abc123 "systemctl status cmux-devbox-worker"
# Should show: "Auth config loaded: owner=..., project=..."

# 5. Test browser commands (uses JWT auth automatically)
./bin/cmux-devbox computer snapshot cmux_abc123
# Should return accessibility tree (e.g., "- document")

./bin/cmux-devbox computer open cmux_abc123 "https://example.com"
# Should output: "Navigated to: https://example.com"

./bin/cmux-devbox computer snapshot cmux_abc123
# Should show Example Domain content with refs like @e1, @e2
```

#### How JWT Auth Works

1. **Instance Creation**: When `cmux start` creates a VM, the Convex backend injects:
   - `/var/run/cmux/owner-id` - The authenticated user's Stack Auth subject ID
   - `/var/run/cmux/stack-project-id` - The Stack Auth project ID for JWKS validation

2. **Worker Startup**: The `cmux-devbox-worker` systemd service reads these files and configures JWT validation

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
./bin/cmux-devbox exec <id> "ls -la /var/run/cmux/"
./bin/cmux-devbox exec <id> "wc -c /var/run/cmux/owner-id"  # Should be 36-37 bytes

# Check worker logs
./bin/cmux-devbox exec <id> "journalctl -u cmux-devbox-worker -n 50"

# Restart worker after manual changes
./bin/cmux-devbox exec <id> "systemctl restart cmux-devbox-worker"

# Test worker health (no auth required)
./bin/cmux-devbox exec <id> "curl -s http://localhost:39377/health"
```

### Rebuilding the Snapshot

To include agent-browser and the worker daemon in new VMs:

```bash
cd /path/to/cmux/apps/devbox/scripts
python create_base_snapshot.py
```

This runs `setup_base_snapshot.sh` which:
1. Installs agent-browser globally via npm
2. Embeds the cmux-devbox-worker script at `/usr/local/bin/cmux-devbox-worker`
3. Creates a systemd service `cmux-devbox-worker.service`
4. Configures Chrome to listen on `127.0.0.1:9222` only (not externally accessible)
