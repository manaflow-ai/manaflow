---
name: cmux
description: Manage cloud development sandboxes with cmux. Create, sync, and access remote VMs. Includes browser automation via Chrome CDP for scraping, testing, and web interaction.
---

# cmux - Cloud Sandboxes for Development

cmux manages cloud sandboxes for development. Use these commands to create, manage, and access remote development environments with built-in browser automation.

## Installation

```bash
npm install -g cmux
```

## Quick Start

```bash
cmux login                      # Authenticate (opens browser)
cmux start ./my-project         # Create sandbox, sync directory → returns ID
cmux start .                    # Or use current directory
cmux code <id>                  # Open VS Code
cmux pty <id>                   # Open terminal session
cmux upload <id> ./my-project   # Upload local files to sandbox
cmux download <id> ./output     # Download files from sandbox
cmux computer screenshot <id>   # Take browser screenshot
cmux stop <id>                  # Stop sandbox
cmux delete <id>                # Delete sandbox
cmux ls                         # List all sandboxes
```

> **Preferred:** Always use `cmux start .` or `cmux start <local-path>` to sync your local directory to a cloud sandbox. This is the recommended workflow over cloning from a git repo.

## Commands

### Authentication

```bash
cmux login               # Login (opens browser)
cmux logout              # Logout and clear credentials
cmux whoami              # Show current user and team
```

### Sandbox Lifecycle

```bash
# Preferred: local-to-cloud (syncs your local directory to the sandbox)
cmux start .             # Create sandbox from current directory (recommended)
cmux start ./my-project  # Create sandbox from a specific local directory
cmux start -i .          # Create from local dir and open VS Code immediately

# Alternative: clone from git
cmux start --git user/repo  # Clone a git repo into sandbox

cmux ls                  # List all sandboxes
cmux status <id>         # Show sandbox details and URLs
cmux stop <id>           # Stop sandbox
cmux extend <id>         # Extend sandbox timeout
cmux delete <id>         # Delete sandbox permanently
cmux templates           # List available templates
```

### Access Sandbox

```bash
cmux code <id>           # Open VS Code in browser
cmux vnc <id>            # Open VNC desktop in browser
cmux pty <id>            # Interactive terminal session
```

### Work with Sandbox

```bash
cmux pty <id>                  # Interactive terminal session (use this to run commands)
cmux ssh <id>                  # SSH into sandbox
```

> **Important:** Do NOT use `cmux exec`. Always use `cmux pty` or `cmux ssh` to run commands in the sandbox.

### File Transfer

One-time file transfers between local machine and sandbox.

```bash
cmux upload <id> <local-path>                     # Upload local files to sandbox
cmux upload <id> <local-path> --remote-path /root/code  # Upload to specific remote path
cmux download <id> <local-path>                   # Download files from sandbox to local
cmux download <id> <local-path> --remote-path /root/code  # Download from specific remote path
```

### Browser Automation (cmux computer)

Control Chrome browser via CDP in the sandbox's VNC desktop.

#### Navigation

```bash
cmux computer open <id> <url>    # Navigate to URL
cmux computer back <id>          # Navigate back
cmux computer forward <id>       # Navigate forward
cmux computer reload <id>        # Reload page
cmux computer url <id>           # Get current URL
cmux computer title <id>         # Get page title
```

#### Inspect Page

```bash
cmux computer snapshot <id>             # Get accessibility tree with element refs (@e1, @e2...)
cmux computer screenshot <id>           # Take screenshot (base64 to stdout)
cmux computer screenshot <id> out.png   # Save screenshot to file
```

#### Interact with Elements

```bash
cmux computer click <id> <selector>      # Click element (@e1 or CSS selector)
cmux computer type <id> "text"           # Type into focused element
cmux computer fill <id> <sel> "value"    # Clear input and fill with value
cmux computer press <id> <key>           # Press key (Enter, Tab, Escape, etc.)
cmux computer hover <id> <selector>      # Hover over element
cmux computer scroll <id> [direction]    # Scroll page (up/down/left/right)
cmux computer wait <id> <selector>       # Wait for element to appear
```

#### Element Selectors

Two ways to select elements:
- **Element refs** from snapshot: `@e1`, `@e2`, `@e3`...
- **CSS selectors**: `#id`, `.class`, `button[type="submit"]`

## Sandbox IDs

Sandbox IDs look like `cmux_abc12345`. Use the full ID when running commands. Get IDs from `cmux ls` or `cmux start` output.

## Common Workflows

### Create and develop in a sandbox (preferred: local-to-cloud)

```bash
cmux start ./my-project        # Creates sandbox, syncs files
cmux code cmux_abc123          # Open VS Code
cmux pty cmux_abc123           # Open terminal to run commands (e.g. npm install && npm run dev)
```

### File transfer workflow

```bash
cmux upload cmux_abc123 ./my-project     # Push local files to sandbox
cmux download cmux_abc123 ./output       # Pull files from sandbox to local
```

### Browser automation: Login to a website

```bash
cmux computer open cmux_abc123 "https://example.com/login"
cmux computer snapshot cmux_abc123
# Output: @e1 [input] Email, @e2 [input] Password, @e3 [button] Sign In

cmux computer fill cmux_abc123 @e1 "user@example.com"
cmux computer fill cmux_abc123 @e2 "password123"
cmux computer click cmux_abc123 @e3
cmux computer screenshot cmux_abc123 result.png
```

### Browser automation: Scrape data

```bash
cmux computer open cmux_abc123 "https://example.com/data"
cmux computer snapshot cmux_abc123   # Get structured accessibility tree
cmux computer screenshot cmux_abc123 # Visual capture
```

### Clean up

```bash
cmux stop cmux_abc123      # Stop (can restart later)
cmux delete cmux_abc123    # Delete permanently
```

## Security: Dev Server URLs

**CRITICAL: NEVER share or output raw E2B port-forwarded URLs.**

When a dev server runs in the sandbox (e.g., Vite on port 5173, Next.js on port 3000), E2B creates publicly accessible URLs like `https://5173-xxx.e2b.app`. These URLs have **NO authentication** — anyone with the link can access the running application.

**Rules:**
- **NEVER** output URLs like `https://5173-xxx.e2b.app`, `https://3000-xxx.e2b.app`, or any `https://<port>-xxx.e2b.app` URL
- **NEVER** construct or guess E2B port URLs from sandbox metadata
- **ALWAYS** tell the user to view dev servers through VNC: `cmux vnc <id>`
- VNC is protected by token authentication (`?tkn=`) and is the only safe way to view dev server output
- Only VSCode URLs (`cmux code <id>`) and VNC URLs (`cmux vnc <id>`) should be shared — these have proper token auth

**When a dev server is started:**
```
✓ Dev server running on port 5173
  View it in your sandbox's VNC desktop: cmux vnc <id>
  (The browser inside VNC can access http://localhost:5173)
```

**NEVER do this:**
```
Frontend: https://5173-xxx.e2b.app   ← WRONG: publicly accessible, no auth
```

## Tips

- Run `cmux login` first if not authenticated
- Use `--json` flag for machine-readable output
- Use `-t <team>` to override default team
- Use `-v` for verbose output
- Always run `snapshot` first to see available elements before browser automation
- Use element refs (`@e1`) for reliability over CSS selectors
