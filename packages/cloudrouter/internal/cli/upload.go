package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var (
	uploadFlagRemotePath string
	uploadFlagWatch      bool
	uploadFlagDelete     bool
	uploadFlagExclude    []string
	uploadFlagDryRun     bool
)

var uploadCmd = &cobra.Command{
	Use:   "upload <id> [local-path]",
	Short: "Upload files to sandbox",
	Long: `Upload files or directories from local filesystem to a sandbox instance using rsync.

The local path defaults to the current directory if not specified.
The remote path defaults to /home/user/workspace if not specified.

Examples:
  cloudrouter upload cr_abc123                           # Upload current dir to workspace
  cloudrouter upload cr_abc123 ./my-project              # Upload specific directory
  cloudrouter upload cr_abc123 ./config.json             # Upload single file
  cloudrouter upload cr_abc123 . -r /home/user/app       # Upload to specific remote path
  cloudrouter upload cr_abc123 . --watch                 # Watch and upload on changes
  cloudrouter upload cr_abc123 . --delete                # Delete remote files not present locally`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]
		localPath := "."
		if len(args) > 1 {
			localPath = args[1]
		}
		remotePath := uploadFlagRemotePath

		absPath, err := filepath.Abs(localPath)
		if err != nil {
			return fmt.Errorf("invalid path: %w", err)
		}

		info, err := os.Stat(absPath)
		if err != nil {
			return fmt.Errorf("path not found: %w", err)
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

		// Set rsync flags
		rsyncFlagDelete = uploadFlagDelete
		rsyncFlagDryRun = uploadFlagDryRun
		rsyncFlagVerbose = false
		rsyncFlagExclude = uploadFlagExclude

		if info.IsDir() {
			if uploadFlagWatch {
				return watchAndUpload(inst.WorkerURL, token, absPath, remotePath, sandboxID)
			}
			fmt.Printf("Uploading %s to %s:%s...\n", absPath, sandboxID, remotePath)
			return runRsyncOverWebSocket(inst.WorkerURL, token, absPath, remotePath)
		}

		// Single file
		if uploadFlagWatch {
			return fmt.Errorf("--watch is not supported for single file upload")
		}

		// For single file, ensure remote path ends with / so rsync places file inside directory
		fileRemotePath := remotePath
		if !strings.HasSuffix(fileRemotePath, "/") {
			fileRemotePath += "/"
		}

		fmt.Printf("Uploading %s to %s:%s...\n", filepath.Base(absPath), sandboxID, fileRemotePath)
		return runRsyncSingleFile(inst.WorkerURL, token, absPath, fileRemotePath)
	},
}

func watchAndUpload(workerURL, token, localPath, remotePath, sandboxID string) error {
	fmt.Printf("Watching %s for changes (Ctrl+C to stop)...\n", localPath)

	// Initial upload
	fmt.Println("Initial upload...")
	if err := runRsyncOverWebSocket(workerURL, token, localPath, remotePath); err != nil {
		fmt.Printf("Initial upload error: %v\n", err)
	}

	fmt.Println("Polling for changes every 2 seconds...")
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if err := runRsyncOverWebSocket(workerURL, token, localPath, remotePath); err != nil {
			fmt.Printf("Upload error: %v\n", err)
		}
	}
	return nil
}

func init() {
	uploadCmd.Flags().StringVarP(&uploadFlagRemotePath, "remote-path", "r", "/home/user/workspace", "Remote path to upload to")
	uploadCmd.Flags().BoolVarP(&uploadFlagWatch, "watch", "w", false, "Watch for changes and upload continuously")
	uploadCmd.Flags().BoolVar(&uploadFlagDelete, "delete", false, "Delete remote files not present locally")
	uploadCmd.Flags().StringSliceVarP(&uploadFlagExclude, "exclude", "e", nil, "Patterns to exclude")
	uploadCmd.Flags().BoolVarP(&uploadFlagDryRun, "dry-run", "n", false, "Perform a trial run with no changes made")
}
