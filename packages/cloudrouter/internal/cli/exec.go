package cli

import (
	"fmt"
	"strings"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var execFlagTimeout int

var execCmd = &cobra.Command{
	Use:   "exec <id> <command...>",
	Short: "Execute a command in a sandbox",
	Args:  cobra.MinimumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		id := args[0]
		command := strings.Join(args[1:], " ")

		client := api.NewClient()
		resp, err := client.Exec(teamSlug, id, command, execFlagTimeout)
		if err != nil {
			return err
		}

		if resp.Stdout != "" {
			fmt.Print(resp.Stdout)
		}
		if resp.Stderr != "" {
			fmt.Print(resp.Stderr)
		}
		if resp.ExitCode != 0 {
			return fmt.Errorf("exit code: %d", resp.ExitCode)
		}
		return nil
	},
}

func init() {
	execCmd.Flags().IntVar(&execFlagTimeout, "timeout", 30, "Command timeout in seconds")
}
