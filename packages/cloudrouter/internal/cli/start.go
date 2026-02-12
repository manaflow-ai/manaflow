package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

const (
	// Preset ID from packages/shared/src/e2b-templates.json (stable identifier)
	defaultTemplatePresetID = "cmux-devbox-docker"

	// Template name in E2B (fallback if template list endpoint is unavailable)
	defaultTemplateName = "cmux-devbox-docker"

	// Modal preset IDs from packages/shared/src/modal-templates.json
	modalDefaultPresetID = "cmux-modal-base"
)

var (
	startFlagName     string
	startFlagTemplate string
	startFlagOpen     bool
	startFlagGit      string
	startFlagBranch   string
	startFlagProvider string
	startFlagGPU      string
	startFlagCPU      float64
	startFlagMemory   int
	startFlagImage    string
	startFlagTimeout  int
)

// availableGpus are GPUs that can be used without special approval
var availableGpus = map[string]bool{
	"T4": true, "L4": true, "A10G": true,
}

// isGpuGated returns true if the GPU type requires approval
func isGpuGated(gpu string) bool {
	base := strings.ToUpper(strings.Split(gpu, ":")[0])
	return !availableGpus[base]
}

// isGitURL checks if the string looks like a git URL
func isGitURL(s string) bool {
	return strings.HasPrefix(s, "git@") ||
		strings.HasPrefix(s, "https://github.com/") ||
		strings.HasPrefix(s, "https://gitlab.com/") ||
		strings.HasPrefix(s, "https://bitbucket.org/") ||
		strings.HasSuffix(s, ".git")
}

var startCmd = &cobra.Command{
	Use:     "start [path-or-git-url]",
	Aliases: []string{"create", "new"},
	Short:   "Create a new sandbox",
	Long: `Create a new sandbox and optionally sync files or clone a git repo.

GPU options (--gpu):
  T4          16GB VRAM  - inference, fine-tuning small models
  L4          24GB VRAM  - inference, image generation
  A10G        24GB VRAM  - training medium models

  The following require approval (contact founders@manaflow.com):
  L40S        48GB VRAM  - inference, video generation
  A100        40GB VRAM  - training large models (7B-70B)
  A100-80GB   80GB VRAM  - very large models
  H100        80GB VRAM  - fast training, research
  H200        141GB VRAM - maximum memory capacity
  B200        192GB VRAM - latest gen, frontier models

Examples:
  cloudrouter start                          # Create a sandbox
  cloudrouter start --gpu T4                 # Sandbox with T4 GPU
  cloudrouter start --gpu A100               # Sandbox with A100 GPU
  cloudrouter start --gpu H100:2             # Sandbox with 2x H100 GPUs
  cloudrouter start .                        # Sync current directory
  cloudrouter start https://github.com/u/r   # Clone git repo`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		// Determine what to do: git clone, sync path, or nothing
		var syncPath string
		var gitURL string
		name := startFlagName

		// Check --git flag first
		if startFlagGit != "" {
			gitURL = startFlagGit
			// Support GitHub shorthand: user/repo -> https://github.com/user/repo
			if !strings.Contains(gitURL, "://") && !strings.HasPrefix(gitURL, "git@") {
				gitURL = "https://github.com/" + gitURL
			}
			// Extract repo name for sandbox name
			if name == "" {
				parts := strings.Split(strings.TrimSuffix(gitURL, ".git"), "/")
				if len(parts) > 0 {
					name = parts[len(parts)-1]
				}
			}
		} else if len(args) > 0 {
			arg := args[0]

			// Check if argument is a git URL
			if isGitURL(arg) {
				gitURL = arg
				// Support GitHub shorthand
				if !strings.Contains(gitURL, "://") && !strings.HasPrefix(gitURL, "git@") && strings.Count(gitURL, "/") == 1 {
					gitURL = "https://github.com/" + gitURL
				}
				// Extract repo name for sandbox name
				if name == "" {
					parts := strings.Split(strings.TrimSuffix(gitURL, ".git"), "/")
					if len(parts) > 0 {
						name = parts[len(parts)-1]
					}
				}
			} else {
				// It's a local path
				absPath, err := filepath.Abs(arg)
				if err != nil {
					return fmt.Errorf("invalid path: %w", err)
				}

				// Check path exists and is a directory
				info, err := os.Stat(absPath)
				if err != nil {
					return fmt.Errorf("path not found: %w", err)
				}
				if !info.IsDir() {
					return fmt.Errorf("path must be a directory")
				}
				syncPath = absPath

				// Use directory name as sandbox name if not specified
				if name == "" {
					name = filepath.Base(absPath)
				}
			}
		}

		client := api.NewClient()
		provider := startFlagProvider

		// If --gpu is specified without --provider, default to modal
		if startFlagGPU != "" && provider == "" {
			provider = "modal"
		}

		// Check if the requested GPU is gated
		if startFlagGPU != "" && isGpuGated(startFlagGPU) {
			return fmt.Errorf("GPU type %q requires approval.\nPlease contact the Manaflow team at founders@manaflow.com for inquiry.\n\nAvailable GPUs: T4, L4, A10G", startFlagGPU)
		}

		// Determine which template to use
		templateID := startFlagTemplate
		if templateID == "" {
			templates, err := client.ListTemplates(teamSlug, provider)
			if err == nil {
				if provider == "modal" {
					// For Modal, pick a GPU template if --gpu is specified
					if startFlagGPU != "" {
						gpuLower := strings.ToLower(startFlagGPU)
						for _, t := range templates {
							if t.Provider == "modal" && t.GPU != "" && strings.ToLower(t.GPU) == gpuLower {
								templateID = t.ID
								break
							}
						}
					}
					// Fallback to default modal template
					if templateID == "" {
						for _, t := range templates {
							if t.Provider == "modal" && t.ID == modalDefaultPresetID {
								templateID = t.ID
								break
							}
						}
					}
					// Still nothing? Use first modal template
					if templateID == "" {
						for _, t := range templates {
							if t.Provider == "modal" {
								templateID = t.ID
								break
							}
						}
					}
				} else {
					// E2B provider (always uses docker template)
					for _, t := range templates {
						if t.PresetID == defaultTemplatePresetID {
							templateID = t.ID
							break
						}
					}
				}
			}

			// Fallback to template name if the template list endpoint isn't
			// available (or isn't returning the expected schema yet).
			if templateID == "" && provider != "modal" {
				templateID = defaultTemplateName
			}
		}

		// Build create request
		createReq := api.CreateInstanceRequest{
			TeamSlugOrID: teamSlug,
			TemplateID:   templateID,
			Name:         name,
			TTLSeconds:   startFlagTimeout,
		}
		if provider != "" {
			createReq.Provider = provider
		}
		if startFlagGPU != "" {
			createReq.GPU = startFlagGPU
		}
		if startFlagCPU > 0 {
			createReq.CPU = startFlagCPU
		}
		if startFlagMemory > 0 {
			createReq.MemoryMiB = startFlagMemory
		}
		if startFlagImage != "" {
			createReq.Image = startFlagImage
		}

		resp, err := client.CreateInstance(createReq)
		if err != nil {
			return err
		}

		// Try to fetch auth token (may need a few retries as sandbox boots)
		var token string
		fmt.Print("Waiting for sandbox to initialize")
		for i := 0; i < 10; i++ {
			time.Sleep(2 * time.Second)
			fmt.Print(".")
			token, err = client.GetAuthToken(teamSlug, resp.DevboxID)
			if err == nil && token != "" {
				break
			}
		}
		fmt.Println()

		// Clone git repo if specified (fast!)
		if gitURL != "" && token != "" {
			fmt.Printf("Cloning %s...\n", gitURL)
			cloneCmd := fmt.Sprintf("cd /home/user/workspace && git clone %s .", gitURL)
			if startFlagBranch != "" {
				cloneCmd = fmt.Sprintf("cd /home/user/workspace && git clone -b %s %s .", startFlagBranch, gitURL)
			}
			execResp, err := client.Exec(teamSlug, resp.DevboxID, cloneCmd, 120)
			if err != nil {
				fmt.Printf("Warning: git clone failed: %v\n", err)
			} else if execResp.ExitCode != 0 {
				fmt.Printf("Warning: git clone failed: %s\n", execResp.Stderr)
			} else {
				fmt.Println("✓ Repository cloned")
			}
		}

		// Sync directory if specified (using rsync over WebSocket SSH)
		if syncPath != "" && token != "" {
			inst, err := client.GetInstance(teamSlug, resp.DevboxID)
			if err == nil && inst.WorkerURL != "" {
				fmt.Printf("Syncing %s to sandbox...\n", syncPath)
				if err := runRsyncOverWebSocket(inst.WorkerURL, token, syncPath, "/home/user/workspace"); err != nil {
					fmt.Printf("Warning: failed to sync files: %v\n", err)
				} else {
					fmt.Println("✓ Files synced")
				}
			}
		}

		// Build authenticated URLs
		var vscodeAuthURL, vncAuthURL string
		if token != "" {
			if resp.VSCodeURL != "" {
				vscodeAuthURL, _ = buildAuthURL(resp.VSCodeURL, token, false)
			}
			if resp.VNCURL != "" {
				vncAuthURL, _ = buildAuthURL(resp.VNCURL, token, true)
			}
		}

		providerLabel := resp.Provider
		if providerLabel == "" {
			providerLabel = "e2b"
		}

		// For Modal, Jupyter URL comes pre-built with token from the backend
		jupyterURL := resp.JupyterURL

		fmt.Printf("Created sandbox: %s\n", resp.DevboxID)
		fmt.Printf("  Provider: %s\n", providerLabel)
		fmt.Printf("  Status:   %s\n", resp.Status)
		if resp.GPU != "" {
			fmt.Printf("  GPU:      %s\n", resp.GPU)
		}
		if jupyterURL != "" {
			fmt.Printf("  Jupyter:  %s\n", jupyterURL)
		}
		if vscodeAuthURL != "" {
			fmt.Printf("  VSCode:   %s\n", vscodeAuthURL)
		} else if resp.VSCodeURL != "" {
			fmt.Printf("  VSCode:   %s\n", resp.VSCodeURL)
		}
		if vncAuthURL != "" {
			fmt.Printf("  VNC:      %s\n", vncAuthURL)
		} else if resp.VNCURL != "" {
			fmt.Printf("  VNC:      %s\n", resp.VNCURL)
		}

		// Auto-open: prefer Jupyter for Modal, VSCode for E2B
		openableURL := vscodeAuthURL
		if jupyterURL != "" {
			openableURL = jupyterURL
		}
		if startFlagOpen && openableURL != "" {
			if jupyterURL != "" {
				fmt.Println("\nOpening Jupyter Lab...")
			} else {
				fmt.Println("\nOpening VSCode...")
			}
			openURL(openableURL)
		}

		return nil
	},
}

func init() {
	startCmd.Flags().StringVarP(&startFlagName, "name", "n", "", "Name for the sandbox")
	startCmd.Flags().StringVarP(&startFlagTemplate, "template", "T", "", "Template ID")
	startCmd.Flags().BoolVarP(&startFlagOpen, "open", "o", false, "Open VSCode after creation")
	startCmd.Flags().StringVar(&startFlagGit, "git", "", "Git repository URL to clone (or user/repo shorthand)")
	startCmd.Flags().StringVarP(&startFlagBranch, "branch", "b", "", "Git branch to clone")

	// Provider selection
	startCmd.Flags().StringVarP(&startFlagProvider, "provider", "p", "", "Sandbox provider: e2b (default), modal")

	// GPU and resource options
	startCmd.Flags().StringVar(&startFlagGPU, "gpu", "", "GPU type (T4, L4, A10G, L40S, A100, H100, H200, B200)")
	startCmd.Flags().Float64Var(&startFlagCPU, "cpu", 0, "CPU cores (e.g., 4, 8)")
	startCmd.Flags().IntVar(&startFlagMemory, "memory", 0, "Memory in MiB (e.g., 8192, 65536)")
	startCmd.Flags().StringVar(&startFlagImage, "image", "", "Container image (e.g., ubuntu:22.04)")
	startCmd.Flags().IntVar(&startFlagTimeout, "timeout", 600, "Sandbox timeout in seconds (default: 10 minutes)")
}
