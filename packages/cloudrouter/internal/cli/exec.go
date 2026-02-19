package cli

import (
	"fmt"
	"os"
	"strings"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

func init() {
	// Stop parsing flags after the first positional arg (the sandbox ID).
	// This ensures "ssh <id> ls -la" works without quoting.
	execCmd.Flags().SetInterspersed(false)
}

var execCmd = &cobra.Command{
	Use:     "ssh <id> <command...>",
	Aliases: []string{"exec"},
	Short:   "Run a command in a sandbox via SSH",
	Args:    cobra.MinimumNArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		id := args[0]
		command := strings.Join(args[1:], " ")

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, id)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			if flagVerbose {
				fmt.Fprintln(os.Stderr, "[debug] worker URL unavailable, falling back to API exec")
			}
			execResp, err := client.Exec(teamSlug, id, command, 600)
			if err != nil {
				return fmt.Errorf("failed to execute command: %w", err)
			}
			if execResp.Stdout != "" {
				fmt.Print(execResp.Stdout)
			}
			if execResp.Stderr != "" {
				fmt.Fprint(os.Stderr, execResp.Stderr)
			}
			if execResp.ExitCode != 0 {
				return fmt.Errorf("exit code: %d", execResp.ExitCode)
			}
			return nil
		}

		token, err := client.GetAuthToken(teamSlug, id)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		if flagVerbose {
			fmt.Fprintf(os.Stderr, "[debug] SSH command: %s\n", command)
		}

		stdout, stderr, exitCode, err := runSSHCommand(inst.WorkerURL, token, command)
		if err != nil {
			return err
		}

		if stdout != "" {
			fmt.Print(stdout)
		}
		if stderr != "" {
			fmt.Fprint(os.Stderr, stderr)
		}
		if exitCode != 0 {
			return fmt.Errorf("exit code: %d", exitCode)
		}
		return nil
	},
}
