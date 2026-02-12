package cli

import (
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/auth"
	"github.com/manaflow-ai/cloudrouter/internal/version"
	"github.com/spf13/cobra"
)

var (
	flagVerbose bool
	flagTeam    string
)

// versionCheckDone signals when version check is complete
var versionCheckDone chan struct{}

// versionCheckResult stores the version check result for post-run hook
var versionCheckResult *version.CheckResult

var rootCmd = &cobra.Command{
	Use:   "cloudrouter",
	Short: "cloudrouter - Cloud sandboxes for development",
	Long: `cloudrouter manages cloud sandboxes for development.

Quick start:
  cloudrouter login                      # Authenticate
  cloudrouter start                      # Create a sandbox
  cloudrouter start --gpu T4             # Create a sandbox with GPU
  cloudrouter start ./my-project         # Create sandbox + upload directory
  cloudrouter code <id>                  # Open VS Code
  cloudrouter pty <id>                   # Open terminal session
  cloudrouter stop <id>                  # Pause sandbox
  cloudrouter resume <id>                # Resume paused sandbox
  cloudrouter delete <id>                # Delete sandbox permanently
  cloudrouter ls                         # List all sandboxes

GPU options (--gpu):
  T4          16GB VRAM  - inference, fine-tuning small models
  L4          24GB VRAM  - inference, image generation
  A10G        24GB VRAM  - training medium models

  The following require approval (contact founders@manaflow.com):
  L40S, A100, A100-80GB, H100, H200, B200`,
	SilenceUsage:  true,
	SilenceErrors: true,
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		auth.SetConfigOverrides("", "", "", "")

		// Start version check in background for long-running commands
		cmdName := cmd.Name()
		if version.IsLongRunningCommand(cmdName) {
			versionCheckDone = make(chan struct{})
			go func() {
				defer close(versionCheckDone)
				versionCheckResult = version.CheckForUpdates()
			}()
		}
	},
	PersistentPostRun: func(cmd *cobra.Command, args []string) {
		// Show version update warning after long-running commands complete
		cmdName := cmd.Name()
		if version.IsLongRunningCommand(cmdName) && versionCheckDone != nil {
			// Wait for version check to complete (with timeout)
			select {
			case <-versionCheckDone:
				// Version check completed
			case <-time.After(5 * time.Second):
				// Timeout - don't block user
				return
			}

			if versionCheckResult != nil {
				if version.PrintUpdateWarning(versionCheckResult) {
					// Auto-update skills when CLI update is available
					_ = AutoUpdateSkillsIfNeeded()
				}
			}
		}
	},
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&flagVerbose, "verbose", "v", false, "Verbose output")
	rootCmd.PersistentFlags().StringVarP(&flagTeam, "team", "t", "", "Team slug (overrides default)")

	// Version command
	rootCmd.AddCommand(versionCmd)

	// Auth commands
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)

	// Instance management
	rootCmd.AddCommand(startCmd)
	rootCmd.AddCommand(listCmd)
	rootCmd.AddCommand(statusCmd)

	// Open commands
	rootCmd.AddCommand(codeCmd)
	rootCmd.AddCommand(vncCmd)
	rootCmd.AddCommand(jupyterCmd)

	// Lifecycle commands
	rootCmd.AddCommand(stopCmd)
	rootCmd.AddCommand(deleteCmd)
	rootCmd.AddCommand(extendCmd)
	rootCmd.AddCommand(pauseCmd)
	rootCmd.AddCommand(resumeCmd)

	// Exec command
	rootCmd.AddCommand(execCmd)

	// File transfer commands
	rootCmd.AddCommand(uploadCmd)
	rootCmd.AddCommand(downloadCmd)

	// Environment variable management
	rootCmd.AddCommand(envCmd)

	// PTY commands (terminal session)
	rootCmd.AddCommand(ptyCmd)
	rootCmd.AddCommand(ptyListCmd)

	// Computer commands (browser automation)
	rootCmd.AddCommand(computerCmd)

	// Templates
	rootCmd.AddCommand(templatesCmd)

	// Skills management
	rootCmd.AddCommand(skillsCmd)
}

func Execute() error {
	return rootCmd.Execute()
}

var (
	versionStr   = "dev"
	commitStr    = "unknown"
	buildTimeStr = "unknown"
	buildMode    = "dev"
)

func SetVersionInfo(version, commit, buildTime string) {
	versionStr = version
	commitStr = commit
	buildTimeStr = buildTime
	rootCmd.Version = version
	rootCmd.SetVersionTemplate("cloudrouter version {{.Version}}\n")
}

func SetBuildMode(mode string) {
	buildMode = mode
}

func getTeamSlug() (string, error) {
	if flagTeam != "" {
		return flagTeam, nil
	}
	return auth.GetTeamSlug()
}
