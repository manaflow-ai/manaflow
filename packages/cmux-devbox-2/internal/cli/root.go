package cli

import (
	"time"

	"github.com/cmux-cli/cmux-devbox-2/internal/auth"
	"github.com/cmux-cli/cmux-devbox-2/internal/version"
	"github.com/spf13/cobra"
)

var (
	flagJSON    bool
	flagVerbose bool
	flagTeam    string
)

// versionCheckDone signals when version check is complete
var versionCheckDone chan struct{}

// versionCheckResult stores the version check result for post-run hook
var versionCheckResult *version.CheckResult

var rootCmd = &cobra.Command{
	Use:   "cmux",
	Short: "cmux - Cloud sandboxes for development",
	Long: `cmux manages cloud sandboxes for development.

Quick start:
  cmux login                      # Authenticate (or: cmux auth login)
  cmux start ./my-project         # Create sandbox, upload directory → returns ID
  cmux code <id>                  # Open VS Code
  cmux pty <id>                   # Open terminal session
  cmux upload <id> ./my-project   # Upload files to sandbox
  cmux download <id> ./output     # Download files from sandbox
  cmux computer screenshot <id>   # Take browser screenshot
  cmux stop <id>                  # Stop sandbox
  cmux delete <id>                # Delete sandbox
  cmux ls                         # List all sandboxes`,
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
	rootCmd.PersistentFlags().BoolVar(&flagJSON, "json", false, "Output as JSON")
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
	rootCmd.SetVersionTemplate("cmux version {{.Version}}\n")
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
