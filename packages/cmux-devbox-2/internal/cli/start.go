package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/cmux-cli/cmux-devbox-2/internal/api"
	"github.com/spf13/cobra"
)

const (
	// Preset IDs from packages/shared/src/e2b-templates.json (stable identifiers)
	defaultTemplatePresetID = "cmux-devbox-base"
	dockerTemplatePresetID  = "cmux-devbox-docker"

	// Template names in E2B (fallback if template list endpoint is unavailable)
	defaultTemplateName = "cmux-devbox"
	dockerTemplateName  = "cmux-devbox-docker"
)

var (
	startFlagName     string
	startFlagTemplate string
	startFlagOpen     bool
	startFlagGit      string
	startFlagBranch   string
	startFlagDocker   bool
)

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

Examples:
  cmux start                              # Create empty sandbox
  cmux start .                            # Create sandbox, sync current directory
  cmux start ./my-project                 # Create sandbox, sync specific directory
  cmux start https://github.com/user/repo # Clone git repo into sandbox
  cmux start --git https://github.com/x/y # Clone git repo (explicit)
  cmux start --git user/repo              # Clone from GitHub shorthand
  cmux start -o                           # Create sandbox and open VS Code
  cmux start --docker                     # Create sandbox with Docker support`,
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

		// Determine which template to use
		templateID := startFlagTemplate
		if templateID == "" {
			templates, err := client.ListTemplates(teamSlug)
			if err == nil {
				presetID := defaultTemplatePresetID
				if startFlagDocker {
					presetID = dockerTemplatePresetID
				}
				for _, t := range templates {
					if t.PresetID == presetID {
						templateID = t.ID
						break
					}
				}
			}

			// Fallback to E2B template name if the template list endpoint isn't
			// available (or isn't returning the expected schema yet).
			if templateID == "" {
				if startFlagDocker {
					templateID = dockerTemplateName
				} else {
					templateID = defaultTemplateName
				}
			}
		}

		resp, err := client.CreateInstance(teamSlug, templateID, name)
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

		if flagJSON {
			output := map[string]interface{}{
				"id":     resp.DevboxID,
				"status": resp.Status,
			}
			if vscodeAuthURL != "" {
				output["vscodeUrl"] = vscodeAuthURL
			} else if resp.VSCodeURL != "" {
				output["vscodeUrl"] = resp.VSCodeURL
			}
			if vncAuthURL != "" {
				output["vncUrl"] = vncAuthURL
			} else if resp.VNCURL != "" {
				output["vncUrl"] = resp.VNCURL
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Printf("Created sandbox: %s\n", resp.DevboxID)
			fmt.Printf("  Status: %s\n", resp.Status)
			if vscodeAuthURL != "" {
				fmt.Printf("  VSCode: %s\n", vscodeAuthURL)
			} else if resp.VSCodeURL != "" {
				fmt.Printf("  VSCode: %s\n", resp.VSCodeURL)
			}
			if vncAuthURL != "" {
				fmt.Printf("  VNC:    %s\n", vncAuthURL)
			} else if resp.VNCURL != "" {
				fmt.Printf("  VNC:    %s\n", resp.VNCURL)
			}
		}

		if startFlagOpen && vscodeAuthURL != "" {
			fmt.Println("\nOpening VSCode...")
			openURL(vscodeAuthURL)
		}

		return nil
	},
}

func init() {
	startCmd.Flags().StringVarP(&startFlagName, "name", "n", "", "Name for the sandbox")
	startCmd.Flags().StringVarP(&startFlagTemplate, "template", "T", "", "Template ID (overrides --docker)")
	startCmd.Flags().BoolVarP(&startFlagOpen, "open", "o", false, "Open VSCode after creation")
	startCmd.Flags().StringVar(&startFlagGit, "git", "", "Git repository URL to clone (or user/repo shorthand)")
	startCmd.Flags().StringVarP(&startFlagBranch, "branch", "b", "", "Git branch to clone")
	startCmd.Flags().BoolVar(&startFlagDocker, "docker", false, "Use template with Docker support (slower to build but includes Docker)")
}
