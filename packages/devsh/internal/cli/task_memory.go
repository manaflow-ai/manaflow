// internal/cli/task_memory.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	flagMemoryType string
)

var taskMemoryCmd = &cobra.Command{
	Use:   "memory <task-id-or-run-id>",
	Short: "View memory snapshots for a task or task run",
	Long: `View agent memory snapshots (knowledge, daily logs, tasks, mailbox) for a task run.

You can provide either:
  - A task ID (e.g., p17xxx...) - shows memory from the latest task run
  - A task run ID (e.g., ns7xxx...) - shows memory from that specific run

Memory files are synced when an agent completes and include:
  - knowledge: Accumulated knowledge and learnings
  - daily: Daily activity logs
  - tasks: Task tracking and progress
  - mailbox: Communication messages

Examples:
  devsh task memory p17xyz123abc...              # Use latest run from task
  devsh task memory ns7xyz123abc...              # Use specific task run
  devsh task memory p17xyz123abc... --type knowledge
  devsh task memory ns7xyz123abc... --type daily
  devsh task memory p17xyz123abc... --json`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id := args[0]

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

		// Determine if this is a task ID or task run ID
		// Try to resolve as taskId first (tasks endpoint returns 404 for non-task IDs)
		// This is robust because Convex generates random ID prefixes
		taskRunID := id
		task, err := client.GetTask(ctx, id)
		if err == nil {
			// Found as task - get latest run
			if len(task.TaskRuns) == 0 {
				return fmt.Errorf("task has no runs yet")
			}
			taskRunID = task.TaskRuns[0].ID
			fmt.Printf("Using latest run: %s (%s)\n\n", taskRunID, task.TaskRuns[0].Agent)
		} else if isFatalAPIError(err) {
			// Auth/network errors - don't fall back
			return fmt.Errorf("failed to resolve ID: %w", err)
		}
		// else: 404/500 means it's not a taskId (or invalid format) - use id as taskRunId directly

		result, err := client.GetTaskRunMemory(ctx, taskRunID, flagMemoryType)
		if err != nil {
			return fmt.Errorf("failed to get memory: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(result.Memory) == 0 {
			fmt.Println("No memory synced for this task run.")
			fmt.Println()
			fmt.Println("Memory is synced when an agent completes. If the task is still running,")
			fmt.Println("memory will be available after the agent finishes.")
			return nil
		}

		// Group by memory type for display
		byType := make(map[string][]vm.MemorySnapshot)
		for _, snap := range result.Memory {
			byType[snap.MemoryType] = append(byType[snap.MemoryType], snap)
		}

		// Display order
		typeOrder := []string{"knowledge", "daily", "tasks", "mailbox"}
		typeLabels := map[string]string{
			"knowledge": "Knowledge",
			"daily":     "Daily Logs",
			"tasks":     "Tasks",
			"mailbox":   "Mailbox",
		}

		for _, memType := range typeOrder {
			snapshots, ok := byType[memType]
			if !ok || len(snapshots) == 0 {
				continue
			}

			fmt.Printf("=== %s ===\n", typeLabels[memType])
			for _, snap := range snapshots {
				// Show metadata
				if snap.AgentName != "" {
					fmt.Printf("Agent: %s\n", snap.AgentName)
				}
				if snap.Date != "" {
					fmt.Printf("Date: %s\n", snap.Date)
				}
				if snap.CreatedAt > 0 {
					fmt.Printf("Synced: %s\n", time.Unix(snap.CreatedAt/1000, 0).Format(time.RFC3339))
				}
				if snap.Truncated {
					fmt.Println("(Content truncated)")
				}
				fmt.Println()

				// Print content with indentation for readability
				content := strings.TrimSpace(snap.Content)
				if memType == "tasks" || memType == "mailbox" {
					// Try to pretty-print JSON content
					var jsonObj interface{}
					if err := json.Unmarshal([]byte(content), &jsonObj); err == nil {
						prettyJSON, _ := json.MarshalIndent(jsonObj, "", "  ")
						content = string(prettyJSON)
					}
				}
				fmt.Println(content)
				fmt.Println()
			}
		}

		return nil
	},
}

func init() {
	taskCmd.AddCommand(taskMemoryCmd)
	taskMemoryCmd.Flags().StringVarP(&flagMemoryType, "type", "t", "", "Filter by memory type (knowledge, daily, tasks, mailbox)")
}

// isFatalAPIError returns true for errors that should NOT fall back to task-run ID lookup.
// Only auth and network errors are fatal; 404/500 from GetTask just means the ID isn't a task ID.
func isFatalAPIError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	// Auth errors - user needs to re-authenticate
	if strings.Contains(errStr, "(401)") || strings.Contains(errStr, "(403)") {
		return true
	}
	// Network errors - can't reach server
	if strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "no such host") ||
		strings.Contains(errStr, "network is unreachable") ||
		strings.Contains(errStr, "context deadline exceeded") {
		return true
	}
	return false
}
