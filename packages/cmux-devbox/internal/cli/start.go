// internal/cli/start.go
package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/state"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/spf13/cobra"
)

var startCmd = &cobra.Command{
	Use:     "start [path]",
	Aliases: []string{"new"},
	Short:   "Create a new VM",
	Long: `Create a new VM and optionally sync a local directory into it.

Each call creates a NEW VM. Use 'cmux resume <id>' to resume a paused VM.

Examples:
  cmux start                    # Create VM (no sync)
  cmux new                      # Same as 'cmux start'
  cmux start .                  # Create VM, sync current directory
  cmux start ./my-project       # Create VM, sync specific directory
  cmux start --snapshot=snap_x  # Create from specific snapshot
  cmux start -i                 # Create VM and open VS Code`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		// Get team slug
		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w\nRun 'cmux auth login' to authenticate", err)
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

		// Save as last used instance
		state.SetLastInstance(instance.ID, teamSlug)

		// Generate auth token for authenticated URLs
		token, err := getAuthToken(ctx, client, instance.ID)
		if err != nil {
			// Fall back to raw URLs if token generation fails
			fmt.Printf("Warning: could not generate auth token: %v\n", err)
			fmt.Println("\n✓ VM is ready!")
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
		fmt.Println("\n✓ VM is ready!")
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
	},
}

func init() {
	startCmd.Flags().String("snapshot", "", "Snapshot ID to create from")
	startCmd.Flags().BoolP("interactive", "i", false, "Open VS Code in browser after creation")
	rootCmd.AddCommand(startCmd)
}
