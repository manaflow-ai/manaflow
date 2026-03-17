// internal/cli/agent_setup.go
package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

var agentSetupCmd = &cobra.Command{
	Use:   "agent-setup",
	Short: "Set up AI agent integration",
	Long: `Set up AI agent integration by installing documentation files.

This command installs AGENTS.md and other files that help AI coding assistants
(like Claude Code, Cursor, GitHub Copilot) understand how to use cmux.

Locations:
  --global    Install to ~/.cmux/AGENTS.md (for all projects)
  --project   Install to ./AGENTS.md (for current project)
  --claude    Install to ~/.claude/commands/cmux.md (Claude Code custom command)

Examples:
  cmux agent-setup --global     # Install globally
  cmux agent-setup --project    # Install in current project
  cmux agent-setup --claude     # Set up Claude Code integration`,
	RunE: runAgentSetup,
}

var (
	agentSetupGlobal  bool
	agentSetupProject bool
	agentSetupClaude  bool
)

func init() {
	agentSetupCmd.Flags().BoolVar(&agentSetupGlobal, "global", false, "Install to ~/.cmux/AGENTS.md")
	agentSetupCmd.Flags().BoolVar(&agentSetupProject, "project", false, "Install to ./AGENTS.md")
	agentSetupCmd.Flags().BoolVar(&agentSetupClaude, "claude", false, "Install Claude Code custom command")

	rootCmd.AddCommand(agentSetupCmd)
}

const agentsMD = `# cmux CLI - Agent Instructions

cmux is a CLI for managing cloud development VMs. Use these commands to help users work with remote development environments.

## Quick Reference

` + "```" + `bash
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
` + "```" + `

## VM IDs

VM IDs look like ` + "`cmux_abc12345`" + `. Always use the full ID when running commands.

## Common Workflows

### Create and access a VM
` + "```" + `bash
cmux start ./my-project    # Creates VM, syncs directory, returns ID
cmux code cmux_abc123      # Opens VS Code
` + "```" + `

### Run commands remotely
` + "```" + `bash
cmux exec cmux_abc123 "npm install"
cmux exec cmux_abc123 "npm run dev"
` + "```" + `

### Sync files
` + "```" + `bash
cmux sync cmux_abc123 .              # Push current dir to VM
cmux sync cmux_abc123 ./dist --pull  # Pull build output from VM
` + "```" + `

### Browser automation
` + "```" + `bash
cmux computer open cmux_abc123 "https://localhost:3000"
cmux computer snapshot cmux_abc123   # See clickable elements
cmux computer click cmux_abc123 @e1  # Click first element
` + "```" + `

### End of session
` + "```" + `bash
cmux pause cmux_abc123    # Pause to save costs (can resume later)
# OR
cmux delete cmux_abc123   # Delete permanently
` + "```" + `

## Tips

- Run ` + "`cmux login`" + ` first if not authenticated
- Use ` + "`cmux whoami`" + ` to check current user and team
- Use ` + "`cmux ls`" + ` to see all VMs and their states
- Paused VMs preserve state and can be resumed instantly
- The ` + "`cmux pty`" + ` command requires an interactive terminal
- Browser automation commands work on the Chrome instance in the VNC desktop
`

const claudeCommandMD = `---
description: Manage cloud development VMs with cmux
---

# cmux - Cloud Development VMs

Use cmux to create, manage, and interact with cloud VMs for development.

## Commands

| Command | Description |
|---------|-------------|
| ` + "`cmux login`" + ` | Login (opens browser) |
| ` + "`cmux whoami`" + ` | Show current user |
| ` + "`cmux start [path]`" + ` | Create VM, optionally sync directory |
| ` + "`cmux ls`" + ` | List all VMs |
| ` + "`cmux status <id>`" + ` | Show VM details and URLs |
| ` + "`cmux code <id>`" + ` | Open VS Code in browser |
| ` + "`cmux ssh <id>`" + ` | SSH into VM |
| ` + "`cmux exec <id> \"cmd\"`" + ` | Run command in VM |
| ` + "`cmux sync <id> <path>`" + ` | Sync files to VM |
| ` + "`cmux pause <id>`" + ` | Pause VM |
| ` + "`cmux resume <id>`" + ` | Resume VM |
| ` + "`cmux delete <id>`" + ` | Delete VM |

## Browser Automation

| Command | Description |
|---------|-------------|
| ` + "`cmux computer open <id> <url>`" + ` | Navigate browser |
| ` + "`cmux computer snapshot <id>`" + ` | Get clickable elements |
| ` + "`cmux computer click <id> @e1`" + ` | Click element |
| ` + "`cmux computer type <id> \"text\"`" + ` | Type text |
| ` + "`cmux computer screenshot <id>`" + ` | Take screenshot |

## Example Workflow

` + "```" + `bash
# Create a VM
cmux start ./my-project
# Output: cmux_abc123

# Access it
cmux code cmux_abc123

# Run commands
cmux exec cmux_abc123 "npm install"
cmux exec cmux_abc123 "npm run dev"

# When done
cmux pause cmux_abc123
` + "```" + `
`

func runAgentSetup(cmd *cobra.Command, args []string) error {
	// If no flags specified, show help
	if !agentSetupGlobal && !agentSetupProject && !agentSetupClaude {
		fmt.Println("Set up AI agent integration for cmux.")
		fmt.Println("")
		fmt.Println("Choose where to install:")
		fmt.Println("  cmux agent-setup --global     Install to ~/.cmux/AGENTS.md")
		fmt.Println("  cmux agent-setup --project    Install to ./AGENTS.md")
		fmt.Println("  cmux agent-setup --claude     Install Claude Code command")
		fmt.Println("")
		fmt.Println("You can combine flags to install to multiple locations.")
		return nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	installed := []string{}

	// Global installation
	if agentSetupGlobal {
		globalDir := filepath.Join(homeDir, ".cmux")
		globalPath := filepath.Join(globalDir, "AGENTS.md")

		if err := os.MkdirAll(globalDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}

		if err := os.WriteFile(globalPath, []byte(agentsMD), 0644); err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		installed = append(installed, globalPath)
	}

	// Project installation
	if agentSetupProject {
		projectPath := "AGENTS.md"

		// Check if file exists
		if _, err := os.Stat(projectPath); err == nil {
			// File exists, append to it
			existing, err := os.ReadFile(projectPath)
			if err != nil {
				return fmt.Errorf("failed to read existing AGENTS.md: %w", err)
			}

			// Check if cmux section already exists
			if !contains(string(existing), "# cmux CLI - Agent Instructions") {
				content := string(existing) + "\n\n" + agentsMD
				if err := os.WriteFile(projectPath, []byte(content), 0644); err != nil {
					return fmt.Errorf("failed to update file: %w", err)
				}
				installed = append(installed, projectPath+" (appended)")
			} else {
				fmt.Println("cmux section already exists in ./AGENTS.md")
			}
		} else {
			// Create new file
			if err := os.WriteFile(projectPath, []byte(agentsMD), 0644); err != nil {
				return fmt.Errorf("failed to write file: %w", err)
			}
			installed = append(installed, projectPath)
		}
	}

	// Claude Code installation
	if agentSetupClaude {
		claudeDir := filepath.Join(homeDir, ".claude", "commands")
		claudePath := filepath.Join(claudeDir, "cmux.md")

		if err := os.MkdirAll(claudeDir, 0755); err != nil {
			return fmt.Errorf("failed to create directory: %w", err)
		}

		if err := os.WriteFile(claudePath, []byte(claudeCommandMD), 0644); err != nil {
			return fmt.Errorf("failed to write file: %w", err)
		}

		installed = append(installed, claudePath)
	}

	if len(installed) > 0 {
		fmt.Println("✓ Agent integration installed:")
		for _, path := range installed {
			fmt.Printf("  %s\n", path)
		}
		fmt.Println("")
		fmt.Println("Your AI coding assistant can now help you use cmux!")
	}

	return nil
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsAt(s, substr, 0))
}

func containsAt(s, substr string, start int) bool {
	for i := start; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
