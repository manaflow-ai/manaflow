// internal/cli/pause.go
package cli

import (
	"context"
	"fmt"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/spf13/cobra"
)

var pauseCmd = &cobra.Command{
	Use:   "pause <id>",
	Short: "Pause a VM",
	Long: `Pause a VM by its ID. The VM state is preserved and can be resumed.

Examples:
  cmux pause cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]

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

		fmt.Printf("Pausing VM %s...\n", instanceID)
		if err := client.PauseInstance(ctx, instanceID); err != nil {
			return fmt.Errorf("failed to pause VM: %w", err)
		}

		fmt.Println("✓ VM paused")
		fmt.Printf("  Resume with: cmux resume %s\n", instanceID)
		return nil
	},
}

func init() {
	rootCmd.AddCommand(pauseCmd)
}
