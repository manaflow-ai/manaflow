package cli

import (
	"fmt"

	"github.com/cmux-cli/cmux-devbox-2/internal/api"
	"github.com/spf13/cobra"
)

var stopCmd = &cobra.Command{
	Use:   "stop <id>",
	Short: "Stop a sandbox",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.StopInstance(teamSlug, args[0]); err != nil {
			return err
		}
		fmt.Printf("Stopped: %s\n", args[0])
		return nil
	},
}

var deleteCmd = &cobra.Command{
	Use:     "delete <id>",
	Aliases: []string{"rm", "kill"},
	Short:   "Delete a sandbox",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.StopInstance(teamSlug, args[0]); err != nil {
			return err
		}
		fmt.Printf("Deleted: %s\n", args[0])
		return nil
	},
}

var extendFlagTimeout int

var extendCmd = &cobra.Command{
	Use:     "extend <id>",
	Aliases: []string{"ttl"},
	Short:   "Extend sandbox timeout",
	Long:    "Extend the sandbox timeout. Sandboxes auto-stop after their timeout expires.",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.ExtendTimeout(teamSlug, args[0], extendFlagTimeout*1000); err != nil {
			return err
		}
		fmt.Printf("Extended timeout by %d seconds: %s\n", extendFlagTimeout, args[0])
		return nil
	},
}

// These are no-ops for E2B (included for CLI compatibility)
var pauseCmd = &cobra.Command{
	Use:    "pause <id>",
	Short:  "Extend sandbox timeout (pause not supported)",
	Args:   cobra.ExactArgs(1),
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Note: Pause is not supported. Use 'extend' to keep sandbox running longer.")
		return extendCmd.RunE(cmd, args)
	},
}

var resumeCmd = &cobra.Command{
	Use:    "resume <id>",
	Short:  "No-op (sandboxes don't pause)",
	Args:   cobra.ExactArgs(1),
	Hidden: true,
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Note: Sandboxes don't pause. If stopped, create a new one.")
		return nil
	},
}

func init() {
	extendCmd.Flags().IntVar(&extendFlagTimeout, "seconds", 3600, "Timeout in seconds (default: 1 hour)")
}
