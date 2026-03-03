// internal/cli/task_attach.go
package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var taskAttachCmd = &cobra.Command{
	Use:   "attach <task-run-id>",
	Short: "Attach to a running task's terminal",
	Long: `Attach to a running task's terminal session.

This command connects to the PTY session of a running task, allowing you
to observe the agent's TUI (Terminal UI) in real-time.

For tmux-based sessions, this opens an interactive tmux attach session.
For cmux-pty sessions, this streams the terminal output to your console.

Examples:
  devsh task attach p17erbkc77h59gcv...
  devsh task attach <task-run-id> --follow`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskRunID := args[0]

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		// Get task run with PTY info
		taskRun, err := client.GetTaskRunWithPty(ctx, taskRunID)
		if err != nil {
			return fmt.Errorf("failed to get task run: %w", err)
		}

		if taskRun.Status != "running" {
			return fmt.Errorf("task run is not running (status: %s)", taskRun.Status)
		}

		if taskRun.PtySessionID == "" {
			return fmt.Errorf("no PTY session found for this task run")
		}

		// Get sandbox ID from vscode URL or container name
		sandboxID := taskRun.SandboxID
		if sandboxID == "" {
			return fmt.Errorf("no sandbox ID found for this task run")
		}

		fmt.Printf("Attaching to task run %s...\n", taskRunID)
		fmt.Printf("  Agent:    %s\n", taskRun.AgentName)
		fmt.Printf("  Backend:  %s\n", taskRun.PtyBackend)
		fmt.Printf("  Session:  %s\n", taskRun.PtySessionID)
		fmt.Printf("  Sandbox:  %s\n", sandboxID)
		fmt.Println()

		// For tmux backend, use tmux attach
		if taskRun.PtyBackend == "tmux" {
			return attachTmux(ctx, client, sandboxID, taskRun.PtySessionID)
		}

		// For cmux-pty backend, we would need WebSocket connection
		// For now, fall back to tmux attach since cmux-pty also creates tmux session as fallback
		fmt.Println("Note: cmux-pty WebSocket attach not yet implemented, using tmux fallback")
		return attachTmux(ctx, client, sandboxID, "cmux")
	},
}

func attachTmux(ctx context.Context, client *vm.Client, sandboxID, sessionName string) error {
	// Execute tmux attach in the sandbox
	// This requires an interactive PTY, so we use devsh exec with PTY mode
	command := fmt.Sprintf("tmux attach -t %s", sessionName)

	fmt.Printf("Running: devsh exec %s %q\n", sandboxID, command)
	fmt.Println("Press Ctrl+B then D to detach from tmux session")
	fmt.Println()

	// Use os/exec to run devsh exec interactively
	execCmd := exec.CommandContext(ctx, "devsh", "exec", sandboxID, command)
	execCmd.Stdin = os.Stdin
	execCmd.Stdout = os.Stdout
	execCmd.Stderr = os.Stderr

	return execCmd.Run()
}

func init() {
	taskCmd.AddCommand(taskAttachCmd)
}
