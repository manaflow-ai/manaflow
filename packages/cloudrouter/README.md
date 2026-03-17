# cloudrouter

Cloud sandboxes for development. Spin up a sandbox from your local directory, run commands, transfer files, and automate browsers — all from the command line or as an agent skill.

## Install

Install cloudrouter as a skill for Claude Code, Codex, or other coding agents:

```bash
npx skills add manaflow-ai/cloudrouter
```

Or install as a standalone CLI:

```bash
npm install -g @manaflow-ai/cloudrouter
```

Then authenticate:

```bash
cloudrouter login
```

### Build from source

```bash
cd packages/cloudrouter
make build-dev
make install-dev
```

## Quick start

```bash
# Create a sandbox from the current directory
cloudrouter start .

# Open VS Code in the browser
cloudrouter code cr_abc123

# Or get a terminal
cloudrouter pty cr_abc123

# Run a command
cloudrouter exec cr_abc123 "npm install && npm run dev"

# Open VNC desktop
cloudrouter vnc cr_abc123

# Open Jupyter Lab
cloudrouter jupyter cr_abc123
```

## Size presets

```bash
cloudrouter start --size small       # 2 vCPU,  8 GB RAM,  20 GB disk
cloudrouter start --size medium      # 4 vCPU, 16 GB RAM,  40 GB disk
cloudrouter start --size large       # 8 vCPU, 32 GB RAM,  80 GB disk (default)
cloudrouter start --gpu T4           # GPU sandbox with NVIDIA T4
cloudrouter start --gpu B200         # GPU sandbox with NVIDIA B200
```

## Browser automation

Every sandbox includes Chrome with CDP integration. Navigate, interact with elements using accessibility tree refs, take screenshots, and scrape data.

```bash
# Get the accessibility tree with element refs
cloudrouter browser snapshot cr_abc123
# → @e1 [link] About  @e2 [input] Search  @e3 [button] Submit

# Interactive elements only
cloudrouter browser snapshot -i cr_abc123

# Open a URL in the sandbox browser
cloudrouter browser open cr_abc123 "https://example.com"

# Interact with elements by ref or CSS selector
cloudrouter browser click cr_abc123 @e3
cloudrouter browser type cr_abc123 @e2 "search query"
cloudrouter browser fill cr_abc123 "#email" "user@example.com"

# Take a screenshot
cloudrouter browser screenshot cr_abc123 result.png

# Evaluate JavaScript
cloudrouter browser eval cr_abc123 "document.title"
```

### Navigation

```bash
cloudrouter browser open <id> <url>           # Navigate to URL
cloudrouter browser back <id>                 # Navigate back
cloudrouter browser forward <id>              # Navigate forward
cloudrouter browser reload <id>               # Reload page
cloudrouter browser close <id>                # Close current tab
```

### Interaction

```bash
cloudrouter browser click <id> <selector>           # Click element
cloudrouter browser dblclick <id> <selector>         # Double-click element
cloudrouter browser type <id> <selector> <text>      # Type text into element
cloudrouter browser fill <id> <selector> <value>     # Clear and fill input
cloudrouter browser press <id> <key>                 # Press key (Enter, Tab, Escape, etc.)
cloudrouter browser hover <id> <selector>            # Hover over element
cloudrouter browser focus <id> <selector>            # Focus element
cloudrouter browser select <id> <selector> <value>   # Select dropdown option
cloudrouter browser check <id> <selector>            # Check checkbox
cloudrouter browser uncheck <id> <selector>          # Uncheck checkbox
cloudrouter browser scroll <id> <direction> [pixels] # Scroll (up/down/left/right)
cloudrouter browser scrollintoview <id> <selector>   # Scroll element into view
cloudrouter browser drag <id> <source> <target>      # Drag and drop
cloudrouter browser upload <id> <selector> <files>   # Upload files to input
```

### Information retrieval

```bash
cloudrouter browser url <id>                         # Get current URL
cloudrouter browser title <id>                       # Get page title
cloudrouter browser get-text <id> <selector>         # Get element text
cloudrouter browser get-html <id> <selector>         # Get element innerHTML
cloudrouter browser get-value <id> <selector>        # Get input value
cloudrouter browser get-attr <id> <selector> <attr>  # Get element attribute
cloudrouter browser get-count <id> <selector>        # Count matching elements
cloudrouter browser get-box <id> <selector>          # Get bounding box (x, y, w, h)
```

### State verification

```bash
cloudrouter browser is-visible <id> <selector>       # Check if visible
cloudrouter browser is-enabled <id> <selector>       # Check if enabled
cloudrouter browser is-checked <id> <selector>       # Check if checked
```

### Screenshots & visual

```bash
cloudrouter browser screenshot <id> [file]           # Save screenshot (or base64 to stdout)
cloudrouter browser pdf <id> [file]                  # Save page as PDF
cloudrouter browser highlight <id> <selector>        # Highlight element visually
```

### Tab management

```bash
cloudrouter browser tab-list <id>                    # List open tabs
cloudrouter browser tab-new <id> [url]               # Open new tab
cloudrouter browser tab-switch <id> <index>          # Switch to tab by index
cloudrouter browser tab-close <id> [index]           # Close tab
```

### Cookies & storage

```bash
cloudrouter browser cookies <id>                     # List cookies
cloudrouter browser cookies-set <id> <name> <value>  # Set cookie
cloudrouter browser cookies-clear <id>               # Clear all cookies
cloudrouter browser storage-local <id> [key]         # Get localStorage
cloudrouter browser storage-local-set <id> <k> <v>   # Set localStorage
cloudrouter browser storage-local-clear <id>         # Clear localStorage
cloudrouter browser storage-session <id> [key]       # Get sessionStorage
cloudrouter browser storage-session-set <id> <k> <v> # Set sessionStorage
cloudrouter browser storage-session-clear <id>       # Clear sessionStorage
```

### Mouse control

```bash
cloudrouter browser mouse-move <id> <x> <y>          # Move mouse
cloudrouter browser mouse-down <id> [button]          # Press mouse button
cloudrouter browser mouse-up <id> [button]            # Release mouse button
cloudrouter browser mouse-wheel <id> <deltaY> [dX]    # Mouse wheel scroll
```

### Dialog handling

```bash
cloudrouter browser dialog-accept <id> [text]         # Accept alert/confirm/prompt
cloudrouter browser dialog-dismiss <id>               # Dismiss dialog
```

### Browser configuration

```bash
cloudrouter browser set-viewport <id> <w> <h>         # Set viewport size
cloudrouter browser set-device <id> <device>           # Emulate device
cloudrouter browser set-media <id> <dark|light>        # Set color scheme
cloudrouter browser set-geo <id> <lat> <lng>           # Set geolocation
cloudrouter browser set-offline <id> [on|off]          # Toggle offline mode
cloudrouter browser set-headers <id> <json>            # Set custom headers
cloudrouter browser set-credentials <id> <user> <pass> # Set HTTP auth
```

### Debugging

```bash
cloudrouter browser console <id>                      # Get console output
cloudrouter browser errors <id>                       # Get JavaScript errors
cloudrouter browser trace-start <id> [path]           # Start tracing
cloudrouter browser trace-stop <id> [path]            # Stop tracing
```

### Advanced

```bash
cloudrouter browser wait <id> <selector-or-ms>        # Wait for element or time
cloudrouter browser frame <id> [selector]             # Switch to frame (omit for main)
cloudrouter browser find <id> <type> <value> <action>  # Find by semantic locator
cloudrouter browser state-save <id> <path>            # Save browser state
cloudrouter browser state-load <id> <path>            # Load browser state
```

## File transfer

```bash
# Upload files to sandbox
cloudrouter upload cr_abc123 ./src /home/user/project/src

# Download from sandbox
cloudrouter download cr_abc123 /home/user/project/dist ./dist

# Watch mode — auto re-upload on changes
cloudrouter upload cr_abc123 ./src /home/user/project/src --watch
```

## Sandbox management

```bash
# Create sandboxes
cloudrouter start                      # Empty sandbox
cloudrouter start .                    # From current directory
cloudrouter start --gpu T4             # With GPU
cloudrouter start --size small         # Smaller sandbox

# List running sandboxes
cloudrouter ls

# Check status
cloudrouter status cr_abc123

# Extend timeout
cloudrouter extend cr_abc123

# Stop/pause a sandbox
cloudrouter stop cr_abc123

# Resume a paused sandbox
cloudrouter resume cr_abc123

# Delete a sandbox
cloudrouter delete cr_abc123
```

## Flags

| Flag | Description |
|------|-------------|
| `-t, --team` | Team slug (auto-detected from login) |
| `-o, --open` | Open VSCode after creation (with `start`) |
| `--size` | Size preset: small, medium, large (default: large) |
| `--gpu` | GPU type: T4, B200, etc. |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |

## License

MIT
