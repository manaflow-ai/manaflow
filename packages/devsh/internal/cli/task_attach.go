// internal/cli/task_attach.go
package cli

import (
	"context"
	"fmt"
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

Uses WebSocket connection to the cmux-pty server for interactive terminal access.

Examples:
  devsh task attach p17erbkc77h59gcv...`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		taskRunID := args[0]

		// Use a short timeout for the API lookup only, not the interactive session
		apiCtx, apiCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer apiCancel()

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
		taskRun, err := client.GetTaskRunWithPty(apiCtx, taskRunID)
		if err != nil {
			return fmt.Errorf("failed to get task run: %w", err)
		}

		if taskRun.Status != "running" {
			return fmt.Errorf("task run is not running (status: %s)", taskRun.Status)
		}

		// Get sandbox ID from vscode container info
		sandboxID := taskRun.SandboxID
		if sandboxID == "" {
			return fmt.Errorf("no sandbox ID found for this task run")
		}

		fmt.Printf("Attaching to task run %s...\n", taskRunID)
		fmt.Printf("  Agent:    %s\n", taskRun.AgentName)
		fmt.Printf("  Sandbox:  %s\n", sandboxID)
		if taskRun.PtySessionID != "" {
			fmt.Printf("  Backend:  %s\n", taskRun.PtyBackend)
			fmt.Printf("  Session:  %s\n", taskRun.PtySessionID)
		}
		fmt.Println()

		// Get instance info for WebSocket URL
		instance, err := client.GetInstance(apiCtx, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get sandbox instance: %w", err)
		}

		if instance.WorkerURL == "" {
			return fmt.Errorf("sandbox worker URL not available")
		}

		// Generate auth token for WebSocket connection
		token, err := getAuthToken(apiCtx, client, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to generate auth token: %w", err)
		}

		// Determine session ID to attach to
		sessionID := taskRun.PtySessionID
		backend := taskRun.PtyBackend

		// Handle tmux backend - requires SSH access, not WebSocket
		if backend == "tmux" {
			fmt.Println("This task uses tmux backend (not cmux-pty WebSocket).")
			fmt.Println()
			fmt.Println("To attach, SSH into the sandbox and run:")
			fmt.Printf("  tmux attach -t %s\n", sessionID)
			fmt.Println()
			fmt.Println("Or use the VSCode terminal in your browser.")
			return nil
		}

		if sessionID == "" {
			// No PTY session stored - try to find one from the cmux-pty server
			fmt.Println("No PTY session ID stored, listing available sessions...")
			sessions, listErr := client.ListPtySessions(apiCtx, sandboxID)
			if listErr != nil {
				return fmt.Errorf("failed to list PTY sessions: %w", listErr)
			}
			if len(sessions) == 0 {
				return fmt.Errorf("no PTY sessions found in sandbox")
			}
			if len(sessions) > 1 {
				fmt.Printf("  Warning: %d sessions found, attaching to most recent.\n", len(sessions))
				fmt.Println("  Use 'devsh pty <sandbox-id> --session=<id>' for a specific session.")
			}
			// Pick the most recently created session (likely the agent)
			best := sessions[0]
			for _, s := range sessions[1:] {
				if s.CreatedAt > best.CreatedAt {
					best = s
				}
			}
			sessionID = best.ID
			fmt.Printf("  Session: %s\n\n", sessionID)
		}

		// Build WebSocket URL to the PTY session
		wsURL, err := buildPtyWebSocketURL(instance.WorkerURL, sessionID, token)
		if err != nil {
			return fmt.Errorf("failed to build WebSocket URL: %w", err)
		}

		fmt.Println("Connected. Press Ctrl+C to detach.")
		fmt.Println()

		// Run interactive PTY session (no timeout - runs until user detaches)
		return runPtySession(wsURL)
	},
}

func init() {
	taskCmd.AddCommand(taskAttachCmd)
}
