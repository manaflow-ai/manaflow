// internal/cli/orchestrate_spawn.go
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

var orchestrateSpawnAgent string
var orchestrateSpawnRepo string
var orchestrateSpawnBranch string
var orchestrateSpawnPRTitle string
var orchestrateSpawnDependsOn []string
var orchestrateSpawnPriority int
var orchestrateSpawnUseEnvJwt bool
var orchestrateSpawnCloudWorkspace bool

var orchestrateSpawnCmd = &cobra.Command{
	Use:   "spawn <prompt>",
	Short: "Spawn an agent with orchestration tracking",
	Long: `Spawn an agent with full orchestration tracking including circuit breaker
health monitoring and Convex persistence.

Creates a tasks record, taskRuns record, and orchestrationTasks record,
then spawns the agent using the standard spawn flow.

Supports two authentication methods:
1. Standard CLI auth (default) - Uses your logged-in credentials
2. JWT auth (--use-env-jwt) - Uses CMUX_TASK_RUN_JWT from environment
   This allows agents to spawn sub-agents using their task-run JWT.

Use --cloud-workspace to spawn as an orchestration head agent that can
coordinate multiple sub-agents. Head agents receive special instructions
and the CMUX_IS_ORCHESTRATION_HEAD=1 environment variable.

Examples:
  devsh orchestrate spawn --agent claude/haiku-4.5 --repo owner/repo "Add tests"
  devsh orchestrate spawn --agent codex/gpt-5.1-codex-mini "Fix the bug"
  devsh orchestrate spawn --agent claude/opus-4.5 --repo owner/repo --pr-title "Fix: auth bug" "Fix auth"
  devsh orchestrate spawn --agent claude/haiku-4.5 --depends-on <task-id> "Task B depends on A"
  devsh orchestrate spawn --agent claude/haiku-4.5 --priority 1 "High priority task"
  devsh orchestrate spawn --agent claude/haiku-4.5 --use-env-jwt "Sub-task from head agent"
  devsh orchestrate spawn --cloud-workspace --agent claude/opus-4.6 "Coordinate feature implementation"`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		prompt := args[0]

		if orchestrateSpawnAgent == "" {
			return fmt.Errorf("--agent flag is required")
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
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

		// Get JWT from environment if --use-env-jwt flag is set
		var taskRunJwt string
		if orchestrateSpawnUseEnvJwt {
			taskRunJwt = os.Getenv("CMUX_TASK_RUN_JWT")
			if taskRunJwt == "" {
				return fmt.Errorf("--use-env-jwt flag set but CMUX_TASK_RUN_JWT environment variable is not set")
			}
		}

		result, err := client.OrchestrationSpawn(ctx, vm.OrchestrationSpawnOptions{
			Prompt:              prompt,
			Agent:               orchestrateSpawnAgent,
			Repo:                orchestrateSpawnRepo,
			Branch:              orchestrateSpawnBranch,
			PRTitle:             orchestrateSpawnPRTitle,
			DependsOn:           orchestrateSpawnDependsOn,
			Priority:            orchestrateSpawnPriority,
			IsCloudMode:         true,
			TaskRunJwt:          taskRunJwt,
			IsCloudWorkspace:    orchestrateSpawnCloudWorkspace,
			IsOrchestrationHead: orchestrateSpawnCloudWorkspace, // Cloud workspaces are orchestration heads
		})
		if err != nil {
			return fmt.Errorf("failed to spawn agent: %w", err)
		}

		if flagJSON {
			data, _ := json.MarshalIndent(result, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		fmt.Println("Agent Spawned")
		fmt.Println("=============")
		fmt.Printf("  Orchestration ID: %s\n", result.OrchestrationTaskID)
		fmt.Printf("  Task ID:          %s\n", result.TaskID)
		fmt.Printf("  Task Run ID:      %s\n", result.TaskRunID)
		fmt.Printf("  Agent:            %s\n", result.AgentName)
		fmt.Printf("  Status:           %s\n", result.Status)
		if result.VSCodeURL != "" {
			fmt.Printf("  VSCode:           %s\n", result.VSCodeURL)
		}

		return nil
	},
}

func init() {
	orchestrateSpawnCmd.Flags().StringVar(&orchestrateSpawnAgent, "agent", "", "Agent to spawn (required)")
	orchestrateSpawnCmd.Flags().StringVar(&orchestrateSpawnRepo, "repo", "", "Repository (owner/repo format)")
	orchestrateSpawnCmd.Flags().StringVar(&orchestrateSpawnBranch, "branch", "", "Base branch")
	orchestrateSpawnCmd.Flags().StringVar(&orchestrateSpawnPRTitle, "pr-title", "", "Pull request title")
	orchestrateSpawnCmd.Flags().StringSliceVar(&orchestrateSpawnDependsOn, "depends-on", nil, "Orchestration task IDs this task depends on (can be specified multiple times)")
	orchestrateSpawnCmd.Flags().IntVar(&orchestrateSpawnPriority, "priority", 5, "Task priority (0=highest, 10=lowest, default 5)")
	orchestrateSpawnCmd.Flags().BoolVar(&orchestrateSpawnUseEnvJwt, "use-env-jwt", false, "Use CMUX_TASK_RUN_JWT from environment for authentication (allows agents to spawn sub-agents)")
	orchestrateSpawnCmd.Flags().BoolVar(&orchestrateSpawnCloudWorkspace, "cloud-workspace", false, "Spawn as an orchestration head agent (cloud workspace for coordinating sub-agents)")
	orchestrateCmd.AddCommand(orchestrateSpawnCmd)
}
