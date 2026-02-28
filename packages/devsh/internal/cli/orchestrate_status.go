// internal/cli/orchestrate_status.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var orchestrateStatusWatch bool
var orchestrateStatusInterval int

var orchestrateStatusCmd = &cobra.Command{
	Use:   "status <orch-task-id>",
	Short: "Get orchestration task status",
	Long: `Get the status and details of a specific orchestration task,
including linked task run information when available.

Use --watch to continuously monitor status changes until the task
reaches a terminal state (completed, failed, or cancelled).

Examples:
  devsh orchestrate status k97xcv2...
  devsh orchestrate status <orch-task-id> --json
  devsh orchestrate status <orch-task-id> --watch
  devsh orchestrate status <orch-task-id> --watch --interval 5`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		orchTaskID := args[0]

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		// If watch mode, enter continuous polling loop
		if orchestrateStatusWatch {
			return watchOrchestrationStatus(client, orchTaskID)
		}

		// Single status check
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		result, err := client.OrchestrationStatus(ctx, orchTaskID)
		if err != nil {
			return fmt.Errorf("failed to get orchestration status: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		printOrchestrationStatus(result)
		return nil
	},
}

// watchOrchestrationStatus continuously polls for status changes until terminal state
func watchOrchestrationStatus(client *vm.Client, orchTaskID string) error {
	interval := time.Duration(orchestrateStatusInterval) * time.Second
	if interval < time.Second {
		interval = 3 * time.Second // Default to 3 seconds
	}

	var lastStatus string
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Check immediately first
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	result, err := client.OrchestrationStatus(ctx, orchTaskID)
	cancel()
	if err != nil {
		return fmt.Errorf("failed to get orchestration status: %w", err)
	}

	// Clear screen and print initial status
	fmt.Print("\033[H\033[2J") // ANSI escape codes to clear screen
	fmt.Printf("[%s] Watching orchestration task: %s\n", time.Now().Format("15:04:05"), orchTaskID)
	fmt.Println("Press Ctrl+C to stop watching")
	fmt.Println()
	printOrchestrationStatus(result)
	lastStatus = result.Task.Status

	// Check if already in terminal state
	if isTerminalStatus(lastStatus) {
		fmt.Printf("\nTask reached terminal state: %s\n", lastStatus)
		return nil
	}

	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			result, err := client.OrchestrationStatus(ctx, orchTaskID)
			cancel()
			if err != nil {
				fmt.Fprintf(os.Stderr, "[%s] Error polling status: %v\n", time.Now().Format("15:04:05"), err)
				continue
			}

			// Only update display if status changed
			if result.Task.Status != lastStatus {
				fmt.Print("\033[H\033[2J") // Clear screen
				fmt.Printf("[%s] Watching orchestration task: %s (status changed: %s -> %s)\n",
					time.Now().Format("15:04:05"), orchTaskID, lastStatus, result.Task.Status)
				fmt.Println("Press Ctrl+C to stop watching")
				fmt.Println()
				printOrchestrationStatus(result)
				lastStatus = result.Task.Status

				// Exit if terminal state reached
				if isTerminalStatus(lastStatus) {
					fmt.Printf("\nTask reached terminal state: %s\n", lastStatus)
					return nil
				}
			} else {
				// Update timestamp without clearing screen
				fmt.Printf("\r[%s] Status: %s (polling...)", time.Now().Format("15:04:05"), lastStatus)
			}
		}
	}
}

// isTerminalStatus checks if the status is a terminal state
func isTerminalStatus(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled"
}

// printOrchestrationStatus prints the orchestration status in human-readable format
func printOrchestrationStatus(result *vm.OrchestrationStatusResult) {
	task := result.Task
	fmt.Println("Orchestration Task")
	fmt.Println("==================")
	fmt.Printf("  ID:       %s\n", task.ID)
	fmt.Printf("  Status:   %s\n", task.Status)
	fmt.Printf("  Priority: %d\n", task.Priority)
	fmt.Printf("  Prompt:   %s\n", task.Prompt)

	if task.AssignedAgentName != nil {
		fmt.Printf("  Agent:    %s\n", *task.AssignedAgentName)
	}
	if task.TaskID != nil {
		fmt.Printf("  Task ID:  %s\n", *task.TaskID)
	}
	if task.TaskRunID != nil {
		fmt.Printf("  Run ID:   %s\n", *task.TaskRunID)
	}
	if task.ErrorMessage != nil {
		fmt.Printf("  Error:    %s\n", *task.ErrorMessage)
	}
	if task.Result != nil {
		fmt.Printf("  Result:   %s\n", *task.Result)
	}
	fmt.Printf("  Created:  %s\n", time.Unix(task.CreatedAt/1000, 0).Format(time.RFC3339))
	if task.StartedAt != nil {
		fmt.Printf("  Started:  %s\n", time.Unix(*task.StartedAt/1000, 0).Format(time.RFC3339))
	}
	if task.CompletedAt != nil {
		fmt.Printf("  Finished: %s\n", time.Unix(*task.CompletedAt/1000, 0).Format(time.RFC3339))
	}

	if result.TaskRun != nil {
		fmt.Println()
		fmt.Println("Linked Task Run")
		fmt.Println("---------------")
		fmt.Printf("  ID:     %s\n", result.TaskRun.ID)
		fmt.Printf("  Agent:  %s\n", result.TaskRun.Agent)
		fmt.Printf("  Status: %s\n", result.TaskRun.Status)
		if result.TaskRun.VSCodeURL != "" {
			fmt.Printf("  VSCode: %s\n", result.TaskRun.VSCodeURL)
		}
		if result.TaskRun.PullRequestURL != "" {
			fmt.Printf("  PR:     %s\n", result.TaskRun.PullRequestURL)
		}
	}
}

func init() {
	orchestrateStatusCmd.Flags().BoolVarP(&orchestrateStatusWatch, "watch", "w", false, "Continuously poll for status changes until terminal state")
	orchestrateStatusCmd.Flags().IntVar(&orchestrateStatusInterval, "interval", 3, "Polling interval in seconds (default: 3)")
	orchestrateCmd.AddCommand(orchestrateStatusCmd)
}
