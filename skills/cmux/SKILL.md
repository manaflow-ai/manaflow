---
name: cmux
description: CLI for starting VMs and cloud sandboxes. Use this skill when users want to create, manage, or work with remote cloud development environments, sandboxed coding sessions, browser automation, or running code in isolated cloud instances. Triggers on tasks involving sandbox creation, remote development, VM management, file sync to remote environments, or web testing via headless Chrome.
license: MIT
metadata:
  author: manaflow
  version: "1.0.0"
---

# cmux - Cloud Sandboxes for Development

cmux is a CLI for starting VMs and cloud sandboxes. Use these commands to help users create isolated development environments, sync files, execute commands remotely, and automate browser interactions.

## Installation

```bash
npm install -g cmux
```

## When to Use This Skill

Use this skill when the user wants to:

- Create an isolated cloud sandbox for development or testing
- Run code in a remote VM environment
- Sync local files to a cloud sandbox
- Execute shell commands in a remote environment
- Automate browser interactions (clicking, typing, screenshots)
- Set up a sandboxed coding environment with VS Code
- Clone a git repository into a cloud sandbox

## Quick Reference

```bash
# Authentication
cmux login               # Login via browser (required first time)
cmux logout              # Clear credentials
cmux whoami              # Show current user and team

# Sandbox Lifecycle
cmux start               # Create new sandbox
cmux start .             # Create sandbox and sync current directory
cmux start ./my-project  # Create sandbox and sync specific directory
cmux start https://github.com/user/repo  # Clone git repo into sandbox
cmux start --git user/repo               # Clone using GitHub shorthand
cmux start -o            # Create sandbox and open VS Code automatically
cmux ls                  # List all sandboxes (alias: list)
cmux status <id>         # Show sandbox details and URLs
cmux stop <id>           # Stop sandbox
cmux delete <id>         # Delete sandbox permanently (aliases: rm, kill)
cmux extend <id>         # Extend sandbox timeout

# Access Sandbox
cmux code <id>           # Open VS Code in browser
cmux vnc <id>            # Open VNC desktop in browser
cmux pty <id>            # Interactive terminal session (requires TTY)

# Execute Commands
cmux exec <id> "command" # Run command in sandbox
cmux exec <id> --timeout 120 "npm install"  # With custom timeout

# File Sync (rsync over WebSocket)
cmux sync <id> .                        # Sync current dir to sandbox
cmux sync <id> ./src /home/user/app     # Sync to specific remote path
cmux sync <id> . --watch                # Watch and sync on changes
cmux sync <id> . --delete               # Delete remote files not present locally
cmux sync <id> . -n                     # Dry run (show what would sync)
cmux sync <id> . -e "*.log" -e "tmp/"   # Exclude patterns

# Browser Automation (control Chrome in sandbox)
cmux computer snapshot <id>              # Get accessibility tree with element refs (@e1, @e2...)
cmux computer open <id> <url>            # Navigate to URL
cmux computer click <id> <selector>      # Click element (@e1 or CSS selector)
cmux computer type <id> "text"           # Type into focused element
cmux computer fill <id> <selector> "val" # Clear and fill input field
cmux computer press <id> <key>           # Press key (Enter, Tab, Escape, etc.)
cmux computer scroll <id> <direction>    # Scroll page (up/down)
cmux computer screenshot <id>            # Take screenshot (outputs base64)
cmux computer screenshot <id> file.png   # Save screenshot to file
cmux computer back <id>                  # Navigate back
cmux computer forward <id>               # Navigate forward
cmux computer reload <id>                # Reload current page
cmux computer url <id>                   # Get current page URL
cmux computer title <id>                 # Get current page title
cmux computer wait <id> <selector>       # Wait for element to be visible
cmux computer hover <id> <selector>      # Hover over element
```

## Sandbox IDs

Sandbox IDs look like `cmux_abc12345`. Always use the full ID when running commands. Get the ID from `cmux start` output or `cmux ls`.

## Common Workflows

### Create a sandbox and start coding

```bash
cmux login                     # One-time authentication
cmux start ./my-project        # Creates sandbox, syncs directory
# Output: Created sandbox: cmux_abc123
cmux code cmux_abc123          # Opens VS Code in browser
```

### Clone a repository into a sandbox

```bash
cmux start https://github.com/user/repo
# or with GitHub shorthand:
cmux start --git user/repo --branch main
```

### Run build commands remotely

```bash
cmux exec cmux_abc123 "npm install"
cmux exec cmux_abc123 "npm run build"
cmux exec cmux_abc123 "npm run dev"
```

### Sync files during development

```bash
# Push local changes to sandbox
cmux sync cmux_abc123 .

# Watch mode - auto-sync on file changes
cmux sync cmux_abc123 . --watch

# Sync with exclusions
cmux sync cmux_abc123 . -e "node_modules" -e ".git" -e "dist"
```

### Browser automation for testing

```bash
# Navigate to your app
cmux computer open cmux_abc123 "http://localhost:3000"

# Get interactive elements
cmux computer snapshot cmux_abc123
# Output shows elements like: @e1 button "Submit", @e2 input "Email"

# Interact with elements
cmux computer click cmux_abc123 @e1
cmux computer fill cmux_abc123 @e2 "user@example.com"
cmux computer press cmux_abc123 Enter

# Take a screenshot
cmux computer screenshot cmux_abc123 screenshot.png
```

### End of session

```bash
cmux stop cmux_abc123      # Stop sandbox (can't be resumed)
cmux delete cmux_abc123    # Delete permanently
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (for scripting) |
| `-v, --verbose` | Verbose output |
| `-t, --team <slug>` | Team slug (overrides default from login) |

## Sync Default Excludes

By default, sync excludes common directories:
- `node_modules`
- `.git`
- `.venv`
- `__pycache__`
- `.DS_Store`
- `dist`
- `build`

## Prerequisites

For file sync (`cmux sync`), you need rsync and sshpass installed locally:

```bash
# macOS
brew install rsync sshpass

# Ubuntu/Debian
apt install rsync sshpass
```

## Tips for Agents

1. **Always authenticate first**: Run `cmux login` if not already authenticated. Check with `cmux whoami`.

2. **Use `cmux ls` to find sandboxes**: List all sandboxes to find IDs and check their status.

3. **Prefer `cmux exec` for remote commands**: Instead of SSH, use `cmux exec <id> "command"` for one-off commands.

4. **Use JSON output for parsing**: Add `--json` flag when you need to parse output programmatically.

5. **Browser automation refs**: Use `cmux computer snapshot` first to get element refs (@e1, @e2...), then use those refs with click, fill, etc.

6. **File sync is incremental**: `cmux sync` uses rsync, so repeated syncs only transfer changed files.

7. **The `pty` command needs a TTY**: Only use `cmux pty` when running in an interactive terminal context.

## Troubleshooting

- **"failed to get team"**: Run `cmux login` to authenticate
- **"sandbox not found"**: Check `cmux ls` for valid sandbox IDs
- **"worker URL not available"**: Sandbox may still be starting, wait and retry
- **Sync fails**: Ensure rsync and sshpass are installed locally

## Links

- Homepage: https://cmux.sh
- Documentation: https://cmux.sh/docs
- GitHub: https://github.com/manaflow-ai/cmux
