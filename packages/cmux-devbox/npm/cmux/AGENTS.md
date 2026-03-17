# cmux CLI - Agent Instructions

cmux is a CLI for managing cloud development VMs. Use these commands to help users work with remote development environments.

## Quick Reference

```bash
# Authentication
cmux login               # Login (opens browser)
cmux logout              # Logout
cmux whoami              # Show current user and team

# VM Lifecycle
cmux start [path]        # Create VM, optionally sync directory
cmux ls                  # List all VMs
cmux status <id>         # Show VM details and URLs
cmux pause <id>          # Pause VM (preserves state, saves cost)
cmux resume <id>         # Resume paused VM
cmux delete <id>         # Delete VM permanently

# Access VM
cmux code <id>           # Open VS Code in browser
cmux ssh <id>            # SSH into VM
cmux vnc <id>            # Open VNC desktop
cmux pty <id>            # Interactive terminal session

# Work with VM
cmux exec <id> "cmd"     # Run command in VM
cmux sync <id> <path>    # Sync local files to VM
cmux sync <id> <path> --pull  # Pull files from VM

# Browser Automation (control Chrome in VNC)
cmux computer open <id> <url>           # Navigate to URL
cmux computer snapshot <id>             # Get interactive elements (@e1, @e2...)
cmux computer click <id> <selector>     # Click element (@e1 or CSS selector)
cmux computer type <id> "text"          # Type into focused element
cmux computer fill <id> <sel> "value"   # Clear and fill input
cmux computer screenshot <id> [file]    # Take screenshot
cmux computer press <id> <key>          # Press key (enter, tab, escape)
```

## VM IDs

VM IDs look like `cmux_abc12345`. Always use the full ID when running commands.

## Common Workflows

### Create and access a VM
```bash
cmux start ./my-project    # Creates VM, syncs directory, returns ID
cmux code cmux_abc123      # Opens VS Code
```

### Run commands remotely
```bash
cmux exec cmux_abc123 "npm install"
cmux exec cmux_abc123 "npm run dev"
```

### Sync files
```bash
cmux sync cmux_abc123 .              # Push current dir to VM
cmux sync cmux_abc123 ./dist --pull  # Pull build output from VM
```

### Browser automation
```bash
cmux computer open cmux_abc123 "https://localhost:3000"
cmux computer snapshot cmux_abc123   # See clickable elements
cmux computer click cmux_abc123 @e1  # Click first element
```

### End of session
```bash
cmux pause cmux_abc123    # Pause to save costs (can resume later)
# OR
cmux delete cmux_abc123   # Delete permanently
```

## Tips

- Run `cmux login` first if not authenticated
- Use `cmux whoami` to check current user and team
- Use `cmux ls` to see all VMs and their states
- Paused VMs preserve state and can be resumed instantly
- The `cmux pty` command requires an interactive terminal
- Browser automation commands work on the Chrome instance in the VNC desktop
