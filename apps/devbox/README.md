# cmux devbox (DevBox Agent) CLI

cmux devbox is a command-line tool that creates isolated, reproducible cloud development environments for AI coding agents. It provides workspace management, service orchestration, file operations, code intelligence, and browser automation capabilities—all running in Morph Cloud VMs.

> **Architecture**: Everything runs in the cloud. The CLI on your local machine communicates with Morph Cloud VMs that contain your dev environment, browser automation (via Chrome DevTools Protocol), VS Code (code-server), and VNC access. The CLI is a single Go binary with no external dependencies.

---

## How It Works (High-Level Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              MORPH CLOUD VM                                      │
│                              (cmux-workspace-xyz)                                 │
│                                                                                  │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │
│  │   code-server     │  │   Your App        │  │   Chrome + CDP            │   │
│  │   (VS Code IDE)   │  │   (dev server)    │  │   (browser automation)    │   │
│  │   :10080          │  │   :10000          │  │   :9222                   │   │
│  └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │
│           │                      │                         │                    │
│           │                      │                         │                    │
│           │              localhost:10000 ◄─────────────────┘                    │
│           │              (browser can access app!)                              │
│                                                                                  │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │
│  │   Devbox/Nix      │  │   TigerVNC        │  │   noVNC                   │   │
│  │   (packages)      │  │   :5901           │  │   :6080                   │   │
│  └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │   nginx (reverse proxy)                                                    │ │
│  │   :80 → routes to code-server, app, vnc, cdp                              │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                  Morph HTTP Exposure  │
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────────┐
│                              LOCAL MACHINE                                       │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                         cmux devbox CLI (single Go binary)                        │ │
│  │                                                                            │ │
│  │  Morph API Client (pure Go)         CDP Browser Client (chromedp)        │ │
│  │  ├─ StartInstance(snapshot_id)      ├─ Connect(cdp_url)                  │ │
│  │  ├─ StopInstance()                  ├─ Snapshot() → [@e1, @e2, ...]     │ │
│  │  ├─ Exec(cmd)                       ├─ Click(@ref)                       │ │
│  │  ├─ ExposeHTTP(port)                ├─ Type/Fill(@ref, text)            │ │
│  │  └─ SaveSnapshot()                  └─ Screenshot()                      │ │
│  │                                                                            │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  User accesses via browser:                                                     │
│  ├─ VS Code:  https://ws-xyz.morph.so/code/                                    │
│  ├─ App:      https://ws-xyz.morph.so/app/                                     │
│  └─ VNC:      https://ws-xyz.morph.so/vnc/                                     │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Workspace** | An isolated cloud dev environment with its own packages, ports, and services |
| **Morph Cloud VM** | Cloud VM running your entire dev stack (app, code-server, browser) |
| **Base Snapshot** | Pre-configured VM image with Chrome, VNC, code-server, nginx - boots in ~0.6s |
| **Element Refs** | AI-friendly element identifiers (@e1, @e2) from `cmux computer snapshot` |
| **Computer Use** | Browser automation using Chrome DevTools Protocol with ref-based element selection |
| **Snapshots** | Save and restore entire VM state including running processes and browser state |

### Key Benefits

| Feature | Description |
|---------|-------------|
| **Zero Dependencies** | Single Go binary - no Python, Node.js, or other runtimes required |
| **Sub-second Boot** | Resume from snapshot in ~0.6s exactly where you left off |
| **True Cloud Dev** | Nothing runs locally except the CLI - everything is in the cloud VM |
| **AI-Optimized** | Ref-based element selection (@e1, @e2) reduces context by 93% vs coordinates |
| **Persistent State** | Snapshot entire dev environment including browser state |
| **Access Anywhere** | VS Code, app, VNC all via web URLs |
| **No Port Conflicts** | Each workspace is an isolated VM |

---

## Prerequisites

### Required

| Dependency | Version | Purpose | Installation |
|------------|---------|---------|--------------|
| **Go** | 1.21+ | Build the CLI | [golang.org](https://golang.org/dl/) |

### Required API Keys

| Variable | Description | Get it from |
|----------|-------------|-------------|
| `MORPH_API_KEY` | Morph Cloud API key | [cloud.morph.so](https://cloud.morph.so) |

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Intel) | Supported | Full functionality |
| macOS (Apple Silicon) | Supported | Full functionality |
| Linux (x86_64) | Supported | Full functionality |
| Linux (ARM64) | Supported | Full functionality |
| Windows | Not Supported | WSL2 with Linux may work |

---

## Installation

```bash
# Clone the repository
git clone https://github.com/anthropics/cmux-devbox-cli.git
cd cmux-devbox-cli/dba

# Build the CLI
make build

# Add to PATH (optional)
export PATH="$PWD/bin:$PATH"

# Verify installation
./bin/cmux-devbox --help
```

---

## Quick Start

```bash
# 1. Set your API key
export MORPH_API_KEY="your-api-key"

# 2. Start the daemon
cmux daemon start

# 3. Create a workspace
cmux create my-app --template=node

# 4. Get your workspace ID
cmux list
# Find your workspace ID (e.g., ws_abc123)

# 5. Start the Morph Cloud VM
cmux computer start -w ws_abc123
# Output shows URLs for VS Code, VNC, and App

# 6. Open a website in the cloud browser
cmux computer open "https://example.com" -w ws_abc123

# 7. Get interactive elements (THE KEY FEATURE!)
cmux computer snapshot -i -w ws_abc123
# Output:
# @e1: link "More information..."

# 8. Interact with elements using refs
cmux computer click @e1 -w ws_abc123

# 9. Take a screenshot to verify
cmux computer screenshot --output=result.png -w ws_abc123

# 10. Save state for later
cmux computer save --name=my-checkpoint -w ws_abc123

# 11. Stop when done
cmux computer stop -w ws_abc123

# 12. Later, resume exactly where you left off
cmux computer start --from=my-checkpoint -w ws_abc123
# Browser state, processes - everything restored!
```

---

## Configuration

### Environment Variables

```bash
# Required - Morph Cloud API key
export MORPH_API_KEY="your-api-key-here"

# Optional - Override base snapshot
export cmux devbox_BASE_SNAPSHOT="snapshot_3namut0l"
```

### Config File (Optional)

Create `~/.cmux/config.yaml`:

```yaml
# Morph Cloud settings
morph:
  api_key: "${MORPH_API_KEY}"
  base_snapshot_id: "snapshot_3namut0l"
  vm:
    vcpus: 2
    memory: 4096
    disk_size: 32768
    ttl_seconds: 3600  # Auto-stop after 1 hour idle
```

---

## Commands Reference

> **Important**: Throughout this documentation, examples using `-w $WS_ID` or similar are placeholders. Replace with your actual workspace ID (e.g., `-w ws_abc123`). Use `cmux list` to find workspace IDs.

### Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | | Output as JSON (machine-readable) |
| `--workspace` | `-w` | Workspace ID (e.g., `ws_9fce9a7e`) or path |
| `--verbose` | `-v` | Verbose output |
| `--timeout` | | Command timeout (default: 5m) |
| `--help` | `-h` | Help for any command |

---

## Daemon Commands

The daemon manages workspace state and provides IPC.

### `cmux daemon start`
Start the background daemon.

```bash
cmux daemon start
# Output: {"pid": 12345, "socket": "/Users/.../.cmux/daemon.sock", "status": "started"}
```

### `cmux daemon stop`
Stop the running daemon.

### `cmux daemon status`
Check daemon status.

---

## Workspace Commands

### `cmux create <name>`
Create a new workspace.

```bash
# Basic creation
cmux create my-app --template=node

# With git clone
cmux create my-app --template=node --clone=https://github.com/org/repo

# With additional packages
cmux create my-app --template=python --packages=pytorch,numpy
```

**Templates:** `node`, `nextjs`, `python`, `go`, `react`, `rust`

### `cmux list`
List all workspaces.

### `cmux status`
Get workspace status including Morph VM state and detected ports.

### `cmux destroy <workspace>`
Destroy a workspace and its cloud resources.

---

## Computer Use Commands

Browser automation via Morph Cloud VM and Chrome DevTools Protocol.

### VM Lifecycle

#### `cmux computer start`
Start the Morph Cloud VM.

```bash
# Start from base snapshot
cmux computer start -w $WS_ID

# Start from a saved snapshot
cmux computer start --from=logged-in -w $WS_ID

# Start from specific snapshot ID
cmux computer start --snapshot=snap_abc123 -w $WS_ID
```

**Output:**
```
Starting Morph VM...
VM started successfully!
Status: running
Instance: morphvm-xyz
VS Code: https://ws-abc123.morph.so/code/
VNC:     https://ws-abc123.morph.so/vnc/
```

#### `cmux computer stop`
Stop the VM.

```bash
cmux computer stop -w $WS_ID

# Save snapshot before stopping
cmux computer stop --save=my-state -w $WS_ID
```

#### `cmux computer status`
Show VM status and URLs.

```bash
cmux computer status -w $WS_ID
cmux computer status --json -w $WS_ID
```

#### `cmux computer save`
Save current state as a snapshot.

```bash
cmux computer save --name=after-login -w $WS_ID
```

#### `cmux computer vnc`
Open VNC viewer in browser.

```bash
cmux computer vnc -w $WS_ID
```

### Element Discovery

#### `cmux computer snapshot`
Get interactive elements with refs. **This is the key command for AI agents.**

```bash
cmux computer snapshot -i -w $WS_ID
```

**Output:**
```
@e1: button "Login"
@e2: input "Email address"
@e3: input "Password"
@e4: link "Forgot password?"
@e5: button "Sign up"
```

### Interaction Commands

#### `cmux computer click`
Click an element by ref, CSS selector, or text.

```bash
cmux computer click @e1 -w $WS_ID           # By ref
cmux computer click "#submit-btn" -w $WS_ID # By CSS selector
cmux computer click "text=Login" -w $WS_ID  # By visible text
```

#### `cmux computer dblclick`
Double-click an element.

#### `cmux computer type`
Type text into an element (appends to existing content).

```bash
cmux computer type @e2 "additional text" -w $WS_ID
```

#### `cmux computer fill`
Clear and fill an element with text.

```bash
cmux computer fill @e2 "test@example.com" -w $WS_ID
```

#### `cmux computer press`
Press a keyboard key.

```bash
cmux computer press Enter -w $WS_ID
cmux computer press Tab -w $WS_ID
cmux computer press Control+a -w $WS_ID
```

#### `cmux computer hover`
Hover over an element.

#### `cmux computer select`
Select an option in a dropdown.

```bash
cmux computer select @e5 "Option 2" -w $WS_ID
```

#### `cmux computer scroll`
Scroll the page.

```bash
cmux computer scroll down -w $WS_ID
cmux computer scroll up 500 -w $WS_ID
```

### Navigation Commands

#### `cmux computer open`
Navigate to a URL.

```bash
cmux computer open "https://example.com" -w $WS_ID
cmux computer open "http://localhost:10000" -w $WS_ID
```

#### `cmux computer back / forward / reload`
Browser history navigation.

```bash
cmux computer back -w $WS_ID
cmux computer forward -w $WS_ID
cmux computer reload -w $WS_ID
```

### Information Commands

#### `cmux computer screenshot`
Take a screenshot.

```bash
cmux computer screenshot -w $WS_ID                    # Base64 to stdout
cmux computer screenshot --output=shot.png -w $WS_ID  # Save to file
cmux computer screenshot --full -w $WS_ID             # Full page
```

#### `cmux computer get`
Get information from the page.

```bash
cmux computer get title -w $WS_ID           # Page title
cmux computer get url -w $WS_ID             # Current URL
cmux computer get text @e1 -w $WS_ID        # Element text
cmux computer get value @e2 -w $WS_ID       # Input value
cmux computer get attr @e1 href -w $WS_ID   # Element attribute
```

#### `cmux computer is`
Check element state.

```bash
cmux computer is visible @e1 -w $WS_ID
cmux computer is enabled @e2 -w $WS_ID
cmux computer is checked @e3 -w $WS_ID
```

### Wait Commands

#### `cmux computer wait`
Wait for elements or conditions.

```bash
cmux computer wait @e1 -w $WS_ID                    # Wait for element
cmux computer wait 2000 -w $WS_ID                   # Wait 2 seconds
cmux computer wait --text "Success" -w $WS_ID       # Wait for text
cmux computer wait --url "/dashboard" -w $WS_ID     # Wait for URL
cmux computer wait @e1 --timeout=10000 -w $WS_ID    # Custom timeout
```

### Utility Commands

#### `cmux computer app`
Open the app in browser and show interactive elements.

```bash
cmux computer app -w $WS_ID               # Auto-detect app port
cmux computer app --port=3000 -w $WS_ID   # Specific port
```

#### `cmux computer ports`
List active ports in the VM.

```bash
cmux computer ports -w $WS_ID
cmux computer ports --json -w $WS_ID
```

---

## Service Commands

Manage services inside the workspace.

### `cmux up [services...]`
Start workspace services.

```bash
cmux up -w $WS_ID           # Start all services
cmux up web api -w $WS_ID   # Start specific services
```

### `cmux down [services...]`
Stop services.

### `cmux ps`
List running services.

### `cmux logs [service]`
View service logs.

```bash
cmux logs -w $WS_ID
cmux logs web -f -w $WS_ID  # Follow logs
```

### `cmux restart [services...]`
Restart services.

---

## Testing

### Running Unit Tests

```bash
cd dba # Note: the package directory is still named 'dba'

# Run all unit tests
go test ./... -v

# Run tests for a specific package
go test ./internal/morph/... -v
go test ./internal/browser/... -v

# Run with coverage
go test ./... -coverprofile=coverage.out
go tool cover -html=coverage.out -o coverage.html
```

### Manual Testing Walkthrough

```bash
# 1. Build and prepare
cd dba # Note: the package directory is still named 'dba'
make build
export PATH="$PWD/bin:$PATH"
export MORPH_API_KEY="your-api-key"

# 2. Start the daemon
cmux daemon start

# 3. Create a test workspace
cmux create test-manual --template=node
cmux list
# Note the workspace ID (e.g., ws_9fce9a7e)
export WS_ID=ws_9fce9a7e  # Replace with your actual ID

# 4. Start the Morph VM
cmux computer start -w $WS_ID

# 5. Test browser navigation
cmux computer open "https://example.com" -w $WS_ID
cmux computer get url -w $WS_ID
cmux computer get title -w $WS_ID

# 6. Test element discovery
cmux computer snapshot -i -w $WS_ID

# 7. Test element interaction
cmux computer click @e1 -w $WS_ID

# 8. Test screenshot
cmux computer screenshot --output=/tmp/test.png -w $WS_ID
ls -la /tmp/test.png

# 9. Clean up
cmux computer stop -w $WS_ID
cmux destroy test-manual --force
cmux daemon stop

echo "All tests passed!"
```

---

## Best Practices for AI Agents

### 1. Always Refresh Refs After Navigation

Refs become stale after page changes. Always get fresh refs:

```bash
cmux computer open "https://example.com" -w $WS_ID
cmux computer snapshot -i -w $WS_ID  # Get refs: @e1, @e2, @e3

cmux computer click @e1 -w $WS_ID    # This navigates to new page

# WRONG: Using old refs
cmux computer click @e2 -w $WS_ID    # May fail - ref is stale!

# RIGHT: Refresh refs first
cmux computer snapshot -i -w $WS_ID  # Get NEW refs
cmux computer click @e1 -w $WS_ID    # Click on NEW @e1
```

### 2. Verify Actions

```bash
cmux computer fill @e2 "test@example.com" -w $WS_ID
cmux computer get value @e2 -w $WS_ID  # Verify it was filled
```

### 3. Use Waits for Dynamic Content

```bash
cmux computer click @e1 -w $WS_ID
cmux computer wait --text "Loading complete" -w $WS_ID
cmux computer snapshot -i -w $WS_ID  # Now get fresh refs
```

### 4. Save Snapshots at Checkpoints

```bash
# After complex setup
cmux computer save --name=setup-complete -w $WS_ID

# If something goes wrong, resume from checkpoint
cmux computer start --from=setup-complete -w $WS_ID
```

### 5. Take Screenshots for Debugging

```bash
cmux computer screenshot --output=/tmp/before.png -w $WS_ID
cmux computer click @e1 -w $WS_ID
cmux computer screenshot --output=/tmp/after.png -w $WS_ID
```

---

## Troubleshooting

### VM Won't Start

```bash
# Check if MORPH_API_KEY is set
echo $MORPH_API_KEY

# Verify API connection
cmux daemon status
```

### Browser Commands Fail

```bash
# Check VM is running
cmux computer status -w $WS_ID
# Must show "Status: running"

# If commands timeout, try reconnecting
cmux computer status -w $WS_ID
```

### Element Not Found

```bash
# Refs may be stale - refresh them
cmux computer snapshot -i -w $WS_ID

# Check if element is visible
cmux computer is visible @e1 -w $WS_ID

# Try using CSS selector instead
cmux computer click "#submit-btn" -w $WS_ID

# Or use text selector
cmux computer click "text=Submit" -w $WS_ID
```

### Page Loads But No Elements Found

```bash
# Wait for page to fully load
cmux computer wait 3000 -w $WS_ID
cmux computer snapshot -i -w $WS_ID

# Or wait for specific content
cmux computer wait --text "Welcome" -w $WS_ID
cmux computer snapshot -i -w $WS_ID
```

---

## Base Snapshot Information

The pre-built base snapshot (`snapshot_3namut0l`) includes:

| Component | Version | Port | Purpose |
|-----------|---------|------|---------|
| Chrome + CDP | 131.x | 9222 | Browser automation via CDP |
| code-server | latest | 10080 | VS Code in browser |
| TigerVNC | latest | 5901 | Remote desktop |
| noVNC | latest | 6080 | VNC in browser |
| nginx | latest | 80 | Reverse proxy for all services |
| Node.js | 20.x | - | Development runtime |
| Python | 3.11 | - | Development runtime |
| Devbox/Nix | latest | - | Package management |

**Snapshot ID:** `snapshot_3namut0l`
**Boot Time:** ~0.6s from snapshot

---

## Available Computer Commands Summary

| Command | Description |
|---------|-------------|
| `computer start` | Start Morph VM |
| `computer stop` | Stop Morph VM |
| `computer status` | Show VM status and URLs |
| `computer save` | Save VM state as snapshot |
| `computer vnc` | Open VNC in browser |
| `computer snapshot` | Get interactive elements (@e1, @e2, ...) |
| `computer click` | Click an element |
| `computer dblclick` | Double-click an element |
| `computer type` | Type text (append) |
| `computer fill` | Clear and fill text |
| `computer press` | Press keyboard key |
| `computer hover` | Hover over element |
| `computer select` | Select dropdown option |
| `computer scroll` | Scroll page |
| `computer open` | Navigate to URL |
| `computer back` | Browser back |
| `computer forward` | Browser forward |
| `computer reload` | Reload page |
| `computer screenshot` | Take screenshot |
| `computer get` | Get text/value/title/url/attr |
| `computer is` | Check visible/enabled/checked |
| `computer wait` | Wait for element/text/url/time |
| `computer app` | Open app and show interactive elements |
| `computer ports` | List active ports in VM |

---

## License

MIT
