// internal/cli/sync.go
package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/spf13/cobra"
)

var syncCmd = &cobra.Command{
	Use:   "sync <id> <path>",
	Short: "Sync files to a VM",
	Long: `Sync a local directory to a VM.

Use --pull to sync from VM to local instead.

Examples:
  cmux sync cmux_abc123 .              # Sync current directory to VM
  cmux sync cmux_abc123 ./my-project   # Sync specific directory
  cmux sync cmux_abc123 ./output --pull  # Pull from VM to local`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		instanceID := args[0]
		localPath := args[1]

		pull, _ := cmd.Flags().GetBool("pull")

		absPath, err := filepath.Abs(localPath)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}

		// Get team slug
		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		if pull {
			// Ensure local directory exists for pull
			if err := os.MkdirAll(absPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory: %w", err)
			}

			fmt.Printf("Pulling from VM %s to %s...\n", instanceID, absPath)
			if err := client.SyncFromVM(ctx, instanceID, absPath); err != nil {
				return fmt.Errorf("failed to sync: %w", err)
			}
			fmt.Println("✓ Files synced from VM")
		} else {
			// Check path exists for push
			info, err := os.Stat(absPath)
			if err != nil {
				return fmt.Errorf("path not found: %w", err)
			}
			if !info.IsDir() {
				return fmt.Errorf("path must be a directory")
			}

			fmt.Printf("Syncing %s to VM %s...\n", absPath, instanceID)
			if err := client.SyncToVM(ctx, instanceID, absPath); err != nil {
				return fmt.Errorf("failed to sync: %w", err)
			}
			fmt.Println("✓ Files synced to VM")
		}

		return nil
	},
}

func init() {
	syncCmd.Flags().Bool("pull", false, "Pull from VM instead of push to VM")
	rootCmd.AddCommand(syncCmd)
}
