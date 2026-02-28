// internal/cli/task_create.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/socketio"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	taskCreateRepo           string
	taskCreateBranch         string
	taskCreateAgents         []string
	taskCreateNoSandbox      bool
	taskCreateRealtime       bool
	taskCreateLocal          bool
	taskCreateImages         []string
	taskCreatePRTitle        string
	taskCreateEnv            string
	taskCreateCloudWorkspace bool
)

var taskCreateCmd = &cobra.Command{
	Use:   "create [prompt]",
	Short: "Create a new task and start agents",
	Long: `Create a new task with a prompt and start sandbox(es) to run the agent(s).
This is equivalent to creating a task in the web app dashboard.

By default, if agents are specified, sandboxes will be provisioned and agents started.
Use --no-sandbox to create the task without starting sandboxes.
Use --realtime to use socket.io for real-time feedback (same as web app flow).
Use --local to create a local workspace with codex-style worktrees (requires local server).
Use --env to specify a custom environment (if omitted, auto-selects latest for repo).
Use --cloud-workspace to create a cloud workspace (prompt is optional, defaults to empty).

Examples:
  devsh task create "Add unit tests for auth module"
  devsh task create --repo owner/repo "Implement dark mode"
  devsh task create --repo owner/repo --agent claude-code "Fix the login bug"
  devsh task create --repo owner/repo --agent claude-code --agent opencode/gpt-4o "Add tests"
  devsh task create --repo owner/repo --agent claude-code --image ./screenshot.png "Fix the UI bug shown in the image"
  devsh task create --repo owner/repo --agent claude-code --no-sandbox "Just create task"
  devsh task create --repo owner/repo --agent claude-code --realtime "With real-time updates"
  devsh task create --repo owner/repo --agent claude-code --local "Local worktree mode"
  devsh task create --repo owner/repo --env env_abc123 --agent claude-code "With custom environment"
  devsh task create --repo owner/repo --cloud-workspace --agent claude-code "Create as cloud workspace"
  devsh task create --repo owner/repo --cloud-workspace  # No prompt (interactive TUI session)`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		var prompt string
		if len(args) > 0 {
			prompt = args[0]
		}

		// Prompt is required unless --cloud-workspace is specified
		if strings.TrimSpace(prompt) == "" && !taskCreateCloudWorkspace {
			return fmt.Errorf("prompt is required (or use --cloud-workspace for interactive TUI session)")
		}

		// Use longer timeout for sandbox provisioning
		timeout := 60 * time.Second
		if len(taskCreateAgents) > 0 && !taskCreateNoSandbox {
			timeout = 5 * time.Minute // Sandbox provisioning can take a while
		}
		if taskCreateCloudWorkspace && !taskCreateNoSandbox {
			timeout = 5 * time.Minute // Cloud workspace creation includes sandbox provisioning
		}
		if len(taskCreateImages) > 0 && timeout < 2*time.Minute {
			timeout = 2 * time.Minute // Uploading images can take a bit
		}

		ctx, cancel := context.WithTimeout(context.Background(), timeout)
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

		// Upload images (if any) to Convex storage and attach to the task.
		var uploadedImages []vm.TaskImage
		if len(taskCreateImages) > 0 {
			for _, imagePath := range taskCreateImages {
				if strings.TrimSpace(imagePath) == "" {
					continue
				}
				fileName := filepath.Base(imagePath)
				storageID, err := client.UploadFileToStorage(ctx, imagePath)
				if err != nil {
					return fmt.Errorf("failed to upload image %q: %w", imagePath, err)
				}
				uploadedImages = append(uploadedImages, vm.TaskImage{
					StorageID: storageID,
					FileName:  fileName,
					AltText:   fileName,
				})
			}

			if len(uploadedImages) > 0 {
				// Ensure prompt includes image references so the backend can replace
				// them with the sanitized file paths in /root/prompt/*.
				var b strings.Builder
				b.WriteString(prompt)
				b.WriteString("\n\nImages:\n")
				for _, img := range uploadedImages {
					if img.FileName != "" {
						b.WriteString("- ")
						b.WriteString(img.FileName)
						b.WriteString("\n")
					}
				}
				prompt = strings.TrimSpace(b.String())
			}
		}

		// Resolve environment ID
		environmentID := taskCreateEnv
		if environmentID == "" && taskCreateRepo != "" {
			// Auto-select the latest environment for this repo
			envID, err := client.FindEnvironmentForRepo(ctx, taskCreateRepo)
			if err != nil {
				// Non-fatal: just log and continue without environment
				if !flagJSON {
					fmt.Printf("Warning: failed to lookup environments: %s\n", err)
				}
			} else if envID != "" {
				environmentID = envID
				if !flagJSON {
					fmt.Printf("Auto-selected environment: %s\n", envID)
				}
			}
		}

		opts := vm.CreateTaskOptions{
			Prompt:           prompt,
			Repository:       taskCreateRepo,
			BaseBranch:       taskCreateBranch,
			Agents:           taskCreateAgents,
			Images:           uploadedImages,
			PRTitle:          taskCreatePRTitle,
			EnvironmentID:    environmentID,
			IsCloudWorkspace: taskCreateCloudWorkspace,
		}

		// Create task and task runs (with JWTs)
		result, err := client.CreateTask(ctx, opts)
		if err != nil {
			return fmt.Errorf("failed to create task: %w", err)
		}

		// Build repo URL if repository specified
		var repoURL string
		if taskCreateRepo != "" {
			repoURL = fmt.Sprintf("https://github.com/%s", taskCreateRepo)
		}

		// Agent spawn results
		var agents []agentInfo

		// Cloud workspace without agents: use dedicated endpoint to spawn sandbox
		if taskCreateCloudWorkspace && len(taskCreateAgents) == 0 && !taskCreateNoSandbox {
			cfg := auth.GetConfig()
			if cfg.ServerURL == "" {
				return fmt.Errorf("CMUX_SERVER_URL not configured. Set via environment variable or use --no-sandbox")
			}

			if !flagJSON {
				fmt.Printf("Task created: %s\n", result.TaskID)
				fmt.Println("Creating cloud workspace...")
			}

			cwResult, err := client.CreateCloudWorkspace(ctx, vm.CreateCloudWorkspaceOptions{
				TaskID:          result.TaskID,
				EnvironmentID:   environmentID,
				ProjectFullName: taskCreateRepo,
				RepoURL:         repoURL,
			})
			if err != nil {
				if !flagJSON {
					fmt.Printf("  Failed to create cloud workspace: %s\n", err)
				}
				return fmt.Errorf("failed to create cloud workspace: %w", err)
			}

			if !flagJSON {
				fmt.Println("Cloud workspace created successfully")
				fmt.Printf("  Task ID: %s\n", result.TaskID)
				fmt.Printf("  Task Run ID: %s\n", cwResult.TaskRunID)
				if cwResult.VSCodeURL != "" {
					fmt.Printf("  VSCode: %s\n", cwResult.VSCodeURL)
				}
				if cwResult.VNCURL != "" {
					fmt.Printf("  VNC: %s\n", cwResult.VNCURL)
				}
			}

			if flagJSON {
				output := map[string]interface{}{
					"taskId":    result.TaskID,
					"taskRunId": cwResult.TaskRunID,
					"vscodeUrl": cwResult.VSCodeURL,
					"vncUrl":    cwResult.VNCURL,
					"status":    "running",
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
			}
			return nil
		}

		if len(result.TaskRuns) > 0 && !taskCreateNoSandbox {
			// Check if ServerURL is configured
			cfg := auth.GetConfig()
			if cfg.ServerURL == "" {
				return fmt.Errorf("CMUX_SERVER_URL not configured. Set via environment variable or use --no-sandbox")
			}

			if !flagJSON {
				fmt.Printf("Task created: %s\n", result.TaskID)
				if taskCreateRealtime {
					fmt.Printf("Starting %d agent(s) via socket.io (realtime)...\n", len(result.TaskRuns))
				} else if taskCreateLocal {
					fmt.Printf("Starting %d agent(s) in local mode (worktree)...\n", len(result.TaskRuns))
				} else {
					fmt.Printf("Starting %d agent(s) via apps/server...\n", len(result.TaskRuns))
				}
			}

			// Collect task run IDs for batch agent spawning
			taskRunIDs := make([]string, 0, len(result.TaskRuns))
			selectedAgents := make([]string, 0, len(result.TaskRuns))
			for _, run := range result.TaskRuns {
				taskRunIDs = append(taskRunIDs, run.TaskRunID)
				selectedAgents = append(selectedAgents, run.AgentName)
			}

			if taskCreateRealtime {
				// Use socket.io client for real-time feedback (identical to web app flow)
				agents, err = startTaskViaSocketIO(ctx, cfg.ServerURL, socketio.StartTaskData{
					TaskID:          result.TaskID,
					TaskDescription: prompt,
					ProjectFullName: taskCreateRepo,
					RepoURL:         repoURL,
					Branch:          taskCreateBranch,
					TaskRunIDs:      taskRunIDs,
					SelectedAgents:  selectedAgents,
					IsCloudMode:     !taskCreateLocal,
				}, result.TaskRuns)
				if err != nil && !flagJSON {
					fmt.Printf("  Socket.io error: %s\n", err)
				}
			} else {
				// Use StartTaskAgents to spawn agents via apps/server HTTP API
				// This uses the same code path as web app's socket.io "start-task"
				agentResult, err := client.StartTaskAgents(ctx, vm.StartTaskAgentsOptions{
					TaskID:          result.TaskID,
					TaskDescription: prompt,
					ProjectFullName: taskCreateRepo,
					RepoURL:         repoURL,
					Branch:          taskCreateBranch,
					TaskRunIDs:      taskRunIDs,
					SelectedAgents:  selectedAgents,
					IsCloudMode:     !taskCreateLocal,
					PRTitle:         taskCreatePRTitle,
				})

				if err != nil {
					// If StartTaskAgents fails entirely, mark all as failed
					if !flagJSON {
						fmt.Printf("  Failed to start agents: %s\n", err)
					}
					for _, run := range result.TaskRuns {
						agents = append(agents, agentInfo{
							TaskRunID: run.TaskRunID,
							AgentName: run.AgentName,
							Status:    "failed",
							Error:     err.Error(),
						})
					}
				} else {
					// Process individual agent results
					for _, r := range agentResult.Results {
						info := agentInfo{
							TaskRunID: r.TaskRunID,
							AgentName: r.AgentName,
							VSCodeURL: r.VSCodeURL,
						}
						if r.Success {
							info.Status = "running"
							if !flagJSON {
								fmt.Printf("  Started: %s\n", r.AgentName)
								if r.VSCodeURL != "" {
									fmt.Printf("    VSCode: %s\n", r.VSCodeURL)
								}
							}
						} else {
							info.Status = "failed"
							info.Error = r.Error
							if !flagJSON {
								fmt.Printf("  Failed: %s - %s\n", r.AgentName, r.Error)
							}
						}
						agents = append(agents, info)
					}
				}
			}
		}

		if flagJSON {
			output := map[string]interface{}{
				"taskId": result.TaskID,
				"status": result.Status,
			}
			if len(agents) > 0 {
				output["agents"] = agents
			} else if len(result.TaskRuns) > 0 {
				// No agents started (--no-sandbox mode)
				output["taskRuns"] = result.TaskRuns
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(agents) == 0 {
			fmt.Println("Task created successfully")
			fmt.Printf("  Task ID: %s\n", result.TaskID)
			if len(result.TaskRuns) > 0 {
				fmt.Println("  Task Runs:")
				for _, run := range result.TaskRuns {
					fmt.Printf("    - %s (%s)\n", run.TaskRunID, run.AgentName)
				}
				fmt.Println("  Note: Use web app to start agents, or re-run without --no-sandbox")
			}
		} else {
			fmt.Println("\nTask created and agents started")
			fmt.Printf("  Task ID: %s\n", result.TaskID)
		}

		return nil
	},
}

// startTaskViaSocketIO uses socket.io to start task with real-time feedback
func startTaskViaSocketIO(ctx context.Context, serverURL string, data socketio.StartTaskData, taskRuns []vm.TaskRunWithJWT) ([]agentInfo, error) {
	var agents []agentInfo

	client, err := socketio.NewClient(serverURL)
	if err != nil {
		return nil, fmt.Errorf("failed to create socket.io client: %w", err)
	}
	defer client.Close()

	if err := client.Connect(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	if err := client.Authenticate(ctx); err != nil {
		return nil, fmt.Errorf("failed to authenticate: %w", err)
	}

	result, err := client.EmitStartTask(ctx, data)
	if err != nil {
		// Mark all as failed
		for _, run := range taskRuns {
			agents = append(agents, agentInfo{
				TaskRunID: run.TaskRunID,
				AgentName: run.AgentName,
				Status:    "failed",
				Error:     err.Error(),
			})
		}
		return agents, err
	}

	// Process result - socket.io returns single TaskStartedResult
	// For multi-agent, we may need to handle differently
	if result.Error != "" {
		for _, run := range taskRuns {
			agents = append(agents, agentInfo{
				TaskRunID: run.TaskRunID,
				AgentName: run.AgentName,
				Status:    "failed",
				Error:     result.Error,
			})
		}
	} else {
		// Mark as running (socket.io flow handles spawning)
		for _, run := range taskRuns {
			agents = append(agents, agentInfo{
				TaskRunID: run.TaskRunID,
				AgentName: run.AgentName,
				Status:    "running",
			})
			if !flagJSON {
				fmt.Printf("  Started: %s\n", run.AgentName)
			}
		}
	}

	return agents, nil
}

// agentInfo type for task create results (defined here for startTaskViaSocketIO)
type agentInfo struct {
	TaskRunID string `json:"taskRunId"`
	AgentName string `json:"agentName"`
	VSCodeURL string `json:"vscodeUrl,omitempty"`
	Status    string `json:"status"`
	Error     string `json:"error,omitempty"`
}

func init() {
	taskCreateCmd.Flags().StringVar(&taskCreateRepo, "repo", "", "Repository (owner/name)")
	taskCreateCmd.Flags().StringVar(&taskCreateBranch, "branch", "main", "Base branch")
	taskCreateCmd.Flags().StringVar(&taskCreateEnv, "env", "", "Environment ID (if omitted, auto-selects latest for repo)")
	taskCreateCmd.Flags().StringArrayVar(&taskCreateAgents, "agent", nil, "Agent(s) to run (can specify multiple)")
	taskCreateCmd.Flags().StringArrayVar(&taskCreateImages, "image", nil, "Image file path(s) to attach (can specify multiple)")
	taskCreateCmd.Flags().BoolVar(&taskCreateNoSandbox, "no-sandbox", false, "Create task without starting sandboxes")
	taskCreateCmd.Flags().BoolVar(&taskCreateRealtime, "realtime", false, "Use socket.io for real-time feedback")
	taskCreateCmd.Flags().BoolVar(&taskCreateLocal, "local", false, "Use local workspace mode (codex-style worktrees)")
	taskCreateCmd.Flags().StringVar(&taskCreatePRTitle, "pr-title", "", "Optional pull request title to save on the task")
	taskCreateCmd.Flags().BoolVar(&taskCreateCloudWorkspace, "cloud-workspace", false, "Create as a cloud workspace (appears in Workspaces section)")
	taskCmd.AddCommand(taskCreateCmd)
}
