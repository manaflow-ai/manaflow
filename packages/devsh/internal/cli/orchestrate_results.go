// internal/cli/orchestrate_results.go
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

var orchestrateResultsUseEnvJwt bool

var orchestrateResultsCmd = &cobra.Command{
	Use:   "results <orchestration-id>",
	Short: "Get aggregated results from all sub-agents",
	Long: `Get aggregated results from all sub-agents in an orchestration.

Returns the status of each task, any results or error messages, and overall
orchestration completion status.

Supports two authentication methods:
1. Standard CLI auth (default) - Uses your logged-in credentials
2. JWT auth (--use-env-jwt) - Uses CMUX_TASK_RUN_JWT from environment
   This allows head agents to query results using their task-run JWT.

Examples:
  devsh orchestrate results k97xcv2...
  devsh orchestrate results <orchestration-id> --json
  devsh orchestrate results <orchestration-id> --use-env-jwt`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		orchestrationID := args[0]

		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		// Get JWT from environment if --use-env-jwt flag is set
		var taskRunJwt string
		if orchestrateResultsUseEnvJwt {
			taskRunJwt = os.Getenv("CMUX_TASK_RUN_JWT")
			if taskRunJwt == "" {
				return fmt.Errorf("--use-env-jwt flag set but CMUX_TASK_RUN_JWT environment variable is not set")
			}
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}

		// Only set team slug if not using JWT auth
		if taskRunJwt == "" {
			teamSlug, err := auth.GetTeamSlug()
			if err != nil {
				return fmt.Errorf("failed to get team: %w", err)
			}
			client.SetTeamSlug(teamSlug)
		}

		result, err := client.OrchestrationResults(ctx, orchestrationID, taskRunJwt)
		if err != nil {
			return fmt.Errorf("failed to get orchestration results: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		// Print human-readable output
		fmt.Println("Orchestration Results")
		fmt.Println("=====================")
		fmt.Printf("  Orchestration ID: %s\n", result.OrchestrationID)
		fmt.Printf("  Status:           %s\n", result.Status)
		fmt.Printf("  Total Tasks:      %d\n", result.TotalTasks)
		fmt.Printf("  Completed Tasks:  %d\n", result.CompletedTasks)
		fmt.Println()

		if len(result.Results) == 0 {
			fmt.Println("No tasks found.")
			return nil
		}

		fmt.Println("Task Results")
		fmt.Println("------------")
		for i, task := range result.Results {
			fmt.Printf("\n[%d] Task: %s\n", i+1, task.TaskID)
			fmt.Printf("    Status: %s\n", task.Status)
			if task.AgentName != nil {
				fmt.Printf("    Agent: %s\n", *task.AgentName)
			}
			// Truncate prompt for display
			prompt := task.Prompt
			if len(prompt) > 80 {
				prompt = prompt[:77] + "..."
			}
			fmt.Printf("    Prompt: %s\n", prompt)
			if task.Result != nil {
				result := *task.Result
				if len(result) > 200 {
					result = result[:197] + "..."
				}
				fmt.Printf("    Result: %s\n", result)
			}
			if task.ErrorMessage != nil {
				fmt.Printf("    Error: %s\n", *task.ErrorMessage)
			}
			if task.TaskRunID != nil {
				fmt.Printf("    TaskRun ID: %s\n", *task.TaskRunID)
			}
		}

		return nil
	},
}

func init() {
	orchestrateResultsCmd.Flags().BoolVar(&orchestrateResultsUseEnvJwt, "use-env-jwt", false, "Use CMUX_TASK_RUN_JWT from environment for authentication")
	orchestrateCmd.AddCommand(orchestrateResultsCmd)
}
