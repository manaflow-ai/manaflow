// internal/cli/start.go
package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/provider"
	"github.com/karlorz/devsh/internal/pvelxc"
	"github.com/karlorz/devsh/internal/state"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var startCmd = &cobra.Command{
	Use:     "start [path]",
	Aliases: []string{"new"},
	Short:   "Create a new VM",
	Long: `Create a new VM and optionally sync a local directory into it.

Each call creates a NEW VM. Use 'devsh resume <id>' to resume a paused VM.

Examples:
  devsh start                    # Create VM (no sync)
  devsh new                      # Same as 'devsh start'
  devsh start .                  # Create VM, sync current directory
  devsh start ./my-project       # Create VM, sync specific directory
  devsh start --snapshot=snap_x  # Create from specific snapshot
  devsh start -i                 # Create VM and open VS Code
  devsh start --no-auth          # Skip automatic provider auth setup`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		normalized, err := provider.NormalizeProvider(flagProvider)
		if err != nil {
			return err
		}
		selected := normalized
		if selected == "" {
			selected = provider.DetectFromEnv()
		}

		switch selected {
		case provider.PveLxc:
			return runStartPveLxc(cmd, args)
		case provider.Morph:
			return runStartMorph(cmd, args)
		default:
			return fmt.Errorf("unsupported provider: %s", selected)
		}
	},
}

// setupProviderAuthIfNeeded calls SetupProviders on the www API unless --no-auth is set.
func setupProviderAuthIfNeeded(cmd *cobra.Command, ctx context.Context, client *vm.Client, instanceID string) {
	noAuth, _ := cmd.Flags().GetBool("no-auth")
	if noAuth {
		return
	}

	fmt.Println("Setting up provider auth...")
	result, err := client.SetupProviders(ctx, instanceID)
	if err != nil {
		fmt.Printf("Warning: provider auth setup failed: %v\n", err)
		return
	}
	if len(result.Providers) > 0 {
		fmt.Printf("  Providers: %s\n", strings.Join(result.Providers, ", "))
	} else {
		fmt.Println("  No provider keys configured (add API keys in web UI)")
	}
}

func runStartMorph(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Get team slug
	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return fmt.Errorf("failed to get team: %w\nRun 'devsh auth login' to authenticate", err)
	}

	// Create VM client
	client, err := vm.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	// Get snapshot ID
	snapshotID, _ := cmd.Flags().GetString("snapshot")

	// Determine name from path if provided
	name := ""
	var syncPath string
	if len(args) > 0 {
		syncPath = args[0]
		absPath, err := filepath.Abs(syncPath)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}
		syncPath = absPath

		// Check path exists and is a directory
		info, err := os.Stat(syncPath)
		if err != nil {
			return fmt.Errorf("path not found: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("path must be a directory")
		}
		name = filepath.Base(syncPath)
	}

	fmt.Println("Creating VM...")
	instance, err := client.CreateInstance(ctx, vm.CreateOptions{
		SnapshotID: snapshotID,
		Name:       name,
	})
	if err != nil {
		return fmt.Errorf("failed to create VM: %w", err)
	}

	fmt.Printf("VM created: %s\n", instance.ID)

	// Wait for VM to be ready
	fmt.Println("Waiting for VM to be ready...")
	instance, err = client.WaitForReady(ctx, instance.ID, 2*time.Minute)
	if err != nil {
		return fmt.Errorf("VM failed to start: %w", err)
	}

	// Sync directory if specified
	if syncPath != "" {
		fmt.Printf("Syncing %s to VM...\n", syncPath)
		if err := client.SyncToVM(ctx, instance.ID, syncPath); err != nil {
			fmt.Printf("Warning: failed to sync files: %v\n", err)
		} else {
			fmt.Println("Files synced successfully")
		}
	}

	// Set up provider auth (Claude + Codex)
	setupProviderAuthIfNeeded(cmd, ctx, client, instance.ID)

	// Save as last used instance
	state.SetLastInstance(instance.ID, teamSlug)

	// Generate auth token for authenticated URLs
	token, err := getAuthToken(ctx, client, instance.ID)
	if err != nil {
		// Fall back to raw URLs if token generation fails
		fmt.Printf("Warning: could not generate auth token: %v\n", err)
		fmt.Println("\nVM is ready!")
		fmt.Printf("  ID:       %s\n", instance.ID)
		fmt.Printf("  VS Code:  %s\n", instance.VSCodeURL)
		fmt.Printf("  VNC:      %s\n", instance.VNCURL)
		return nil
	}

	// Build authenticated URLs
	codeAuthURL, err := buildAuthURL(instance.WorkerURL, "/code/?folder=/home/cmux/workspace", token)
	if err != nil {
		return fmt.Errorf("failed to build VS Code URL: %w", err)
	}
	vncAuthURL, err := buildAuthURL(instance.WorkerURL, "/vnc/vnc.html?path=vnc/websockify&resize=scale&quality=9&compression=0", token)
	if err != nil {
		return fmt.Errorf("failed to build VNC URL: %w", err)
	}

	// Output results with authenticated URLs
	fmt.Println("\nVM is ready!")
	fmt.Printf("  ID:       %s\n", instance.ID)
	fmt.Printf("  VS Code:  %s\n", codeAuthURL)
	fmt.Printf("  VNC:      %s\n", vncAuthURL)

	// Open VS Code in browser if interactive mode
	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(codeAuthURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

func runStartPveLxc(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Get snapshot ID (canonical snapshot_*)
	snapshotID, _ := cmd.Flags().GetString("snapshot")

	// Optional: accept a path argument for consistency, but sync is not yet implemented for PVE LXC.
	var syncPath string
	if len(args) > 0 {
		syncPath = args[0]
		absPath, err := filepath.Abs(syncPath)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}
		syncPath = absPath

		info, err := os.Stat(syncPath)
		if err != nil {
			return fmt.Errorf("path not found: %w", err)
		}
		if !info.IsDir() {
			return fmt.Errorf("path must be a directory")
		}
	}

	client, err := pvelxc.NewClientFromEnv()
	if err != nil {
		return fmt.Errorf("failed to create PVE LXC client: %w\nSet PVE_API_URL and PVE_API_TOKEN", err)
	}

	fmt.Println("Creating container...")
	instance, err := client.StartInstance(ctx, pvelxc.StartOptions{
		SnapshotID: snapshotID,
	})
	if err != nil {
		return fmt.Errorf("failed to create container: %w", err)
	}

	fmt.Printf("Container created: %s\n", instance.ID)

	if syncPath != "" {
		fmt.Printf("Warning: sync is not supported for pve-lxc yet (skipping sync of %s)\n", syncPath)
	}

	// Set up provider auth via www API (requires authentication)
	noAuth, _ := cmd.Flags().GetBool("no-auth")
	if !noAuth {
		// PVE LXC path needs a www client for the setup-providers endpoint
		teamSlug, teamErr := auth.GetTeamSlug()
		if teamErr != nil {
			fmt.Printf("Warning: provider auth setup skipped (not authenticated): %v\n", teamErr)
		} else {
			wwwClient, wwwErr := vm.NewClient()
			if wwwErr != nil {
				fmt.Printf("Warning: provider auth setup skipped: %v\n", wwwErr)
			} else {
				wwwClient.SetTeamSlug(teamSlug)
				setupProviderAuthIfNeeded(cmd, ctx, wwwClient, instance.ID)
			}
		}
	}

	// Save as last used instance (team slug not applicable for PVE LXC)
	_ = state.SetLastInstance(instance.ID, "")

	fmt.Println("\nVM is ready!")
	fmt.Printf("  ID:       %s\n", instance.ID)
	if instance.VSCodeURL != "" {
		fmt.Printf("  VS Code:  %s\n", instance.VSCodeURL)
	}
	if instance.VNCURL != "" {
		fmt.Printf("  VNC:      %s\n", instance.VNCURL)
	}
	if instance.XTermURL != "" {
		fmt.Printf("  XTerm:    %s\n", instance.XTermURL)
	}

	interactive, _ := cmd.Flags().GetBool("interactive")
	if interactive && instance.VSCodeURL != "" {
		fmt.Println("\nOpening VS Code in browser...")
		if err := openBrowser(instance.VSCodeURL); err != nil {
			fmt.Printf("Warning: could not open browser: %v\n", err)
		}
	}

	return nil
}

func init() {
	startCmd.Flags().String("snapshot", "", "Snapshot ID to create from")
	startCmd.Flags().BoolP("interactive", "i", false, "Open VS Code in browser after creation")
	startCmd.Flags().Bool("no-auth", false, "Skip automatic provider auth setup")
	rootCmd.AddCommand(startCmd)
}
