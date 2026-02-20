package cli

import (
	"fmt"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var stopCmd = &cobra.Command{
	Use:   "stop <id>",
	Short: "Pause a sandbox (preserves state)",
	Long:  "Pause a sandbox. The sandbox state is preserved and can be resumed later with 'resume'.",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.PauseInstance(teamSlug, args[0]); err != nil {
			return err
		}
		fmt.Printf("Paused: %s\n", args[0])
		return nil
	},
}

var pauseCmd = &cobra.Command{
	Use:   "pause <id>",
	Short: "Pause a sandbox (preserves state)",
	Long:  "Pause a sandbox. The sandbox state is preserved and can be resumed later with 'resume'.",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.PauseInstance(teamSlug, args[0]); err != nil {
			return err
		}
		fmt.Printf("Paused: %s\n", args[0])
		return nil
	},
}

var resumeCmd = &cobra.Command{
	Use:   "resume <id>",
	Short: "Resume a paused sandbox",
	Long:  "Resume a previously paused sandbox so it becomes active again.",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.ResumeInstance(teamSlug, args[0]); err != nil {
			return err
		}
		fmt.Printf("Resumed: %s\n", args[0])
		return nil
	},
}

var deleteCmd = &cobra.Command{
	Use:     "delete <id>",
	Aliases: []string{"rm", "kill"},
	Short:   "Delete a sandbox (terminates and removes)",
	Long:    "Permanently delete a sandbox. This terminates the sandbox and removes all records.",
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		if err := client.DeleteInstance(teamSlug, args[0]); err != nil {
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

func init() {
	extendCmd.Flags().IntVar(&extendFlagTimeout, "seconds", 3600, "Timeout in seconds (default: 1 hour)")
}
