package cli

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var (
	downloadFlagRemotePath string
)

var downloadCmd = &cobra.Command{
	Use:   "download <id> [local-path]",
	Short: "Download files from sandbox",
	Long: `Download files from a sandbox instance to local filesystem using rsync.

The remote path defaults to /home/user/workspace if not specified.
The local path defaults to the current directory if not specified.

Examples:
  cloudrouter download cr_abc123                          # Download workspace to current dir
  cloudrouter download cr_abc123 ./output                 # Download workspace to ./output
  cloudrouter download cr_abc123 . -r /home/user/app      # Download specific remote path`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]
		localPath := "."
		if len(args) > 1 {
			localPath = args[1]
		}
		remotePath := downloadFlagRemotePath

		// Get absolute path for local destination
		absPath, err := filepath.Abs(localPath)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}

		// Create local directory if it doesn't exist
		if err := os.MkdirAll(absPath, 0755); err != nil {
			return fmt.Errorf("failed to create local directory: %w", err)
		}

		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()

		// Get sandbox info
		inst, err := client.GetInstance(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		// Get auth token
		token, err := client.GetAuthToken(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		// Reset rsync flags
		rsyncFlagDelete = false
		rsyncFlagDryRun = false
		rsyncFlagVerbose = false
		rsyncFlagExclude = nil

		fmt.Printf("Downloading %s:%s to %s...\n", sandboxID, remotePath, absPath)
		return runRsyncDownload(inst.WorkerURL, token, remotePath, absPath)
	},
}

func init() {
	downloadCmd.Flags().StringVarP(&downloadFlagRemotePath, "remote-path", "r", "/home/user/workspace", "Remote path to download")
}
