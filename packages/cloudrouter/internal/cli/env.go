package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var envCmd = &cobra.Command{
	Use:   "env",
	Short: "Manage environment variables for a sandbox",
	Long: `Interact with environment variables for a sandbox.

Commands:

  push    <id> [filename]     Push environment variables from a local file to a sandbox
  pull    <id> [filename]     Pull environment variables from a sandbox to a local file [.env.local]

Environment variables are sent securely via the worker API (not via file upload).
If envctl is available on the sandbox, variables are also loaded into the
envctl daemon for secure shell injection.

Examples:
  cmux env push <id>              # Push .env from current directory
  cmux env push <id> .env.local   # Push specific env file
  cmux env pull <id>              # Pull env vars to stdout
  cmux env pull <id> .env.local   # Pull env vars to file`,
}

var envPushCmd = &cobra.Command{
	Use:   "push <id> [env-file]",
	Short: "Push environment variables to a sandbox",
	Long: `Push environment variables from a local .env file to a sandbox.

The env file defaults to .env in the current directory if not specified.
Variables are sent securely via the worker API (not via file upload).
If envctl is available on the sandbox, variables are also loaded into the
envctl daemon for secure shell injection.

Examples:
  cmux env push cmux_abc123                  # Push ./.env
  cmux env push cmux_abc123 .env.local       # Push specific file
  cmux env push cmux_abc123 ~/project/.env   # Push from absolute path`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]
		envFile := ".env"
		if len(args) > 1 {
			envFile = args[1]
		}

		absPath, err := filepath.Abs(envFile)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}

		content, err := os.ReadFile(absPath)
		if err != nil {
			return fmt.Errorf("failed to read env file %s: %w", absPath, err)
		}

		if len(content) == 0 {
			return fmt.Errorf("env file %s is empty", absPath)
		}

		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()

		inst, err := client.GetInstance(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		token, err := client.GetAuthToken(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		fmt.Printf("Pushing env vars from %s to %s...\n", filepath.Base(absPath), sandboxID)
		if err := api.UploadEnvToWorker(inst.WorkerURL, token, string(content)); err != nil {
			return fmt.Errorf("failed to push env vars: %w", err)
		}

		fmt.Println("Environment variables pushed successfully.")
		return nil
	},
}

var envPullCmd = &cobra.Command{
	Use:   "pull <id> [filename]",
	Short: "Pull environment variables from a sandbox",
	Long: `Pull environment variables from a sandbox.

If a filename is specified, the env vars are written to that file.
Otherwise, they are printed to stdout.

Examples:
  cmux env pull cmux_abc123                  # Print to stdout
  cmux env pull cmux_abc123 .env.local       # Save to file`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]
		var outputFile string
		if len(args) > 1 {
			outputFile = args[1]
		}

		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()

		inst, err := client.GetInstance(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		token, err := client.GetAuthToken(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		content, err := api.DownloadEnvFromWorker(inst.WorkerURL, token)
		if err != nil {
			return fmt.Errorf("failed to pull env vars: %w", err)
		}

		if content == "" {
			fmt.Println("No environment variables set in sandbox.")
			return nil
		}

		if outputFile != "" {
			absPath, err := filepath.Abs(outputFile)
			if err != nil {
				return fmt.Errorf("invalid output path: %w", err)
			}
			if err := os.WriteFile(absPath, []byte(content), 0600); err != nil {
				return fmt.Errorf("failed to write env file: %w", err)
			}
			fmt.Printf("Environment variables saved to %s\n", absPath)
		} else {
			fmt.Print(content)
		}

		return nil
	},
}

func init() {
	envCmd.AddCommand(envPushCmd)
	envCmd.AddCommand(envPullCmd)
}
