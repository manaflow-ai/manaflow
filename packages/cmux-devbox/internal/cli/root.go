// internal/cli/root.go
package cli

import (
	"os"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/spf13/cobra"
)

var (
	// Global flags
	flagJSON    bool
	flagVerbose bool

	// Config override flags
	flagAPIURL        string
	flagConvexSiteURL string
)

var rootCmd = &cobra.Command{
	Use:   "cmux",
	Short: "cmux devbox - Cloud VMs for development",
	Long: `cmux devbox manages cloud VMs for development.

Quick start:
  cmux login                      # Authenticate (or: cmux auth login)
  cmux start ./my-project         # Create VM, sync directory → returns ID
  cmux new                        # Same as 'cmux start'
  cmux code <id>                  # Open VS Code
  cmux ssh <id>                   # SSH into VM
  cmux sync <id> ./my-project     # Sync files to VM
  cmux pause <id>                 # Pause VM (preserves state)
  cmux resume <id>                # Resume paused VM
  cmux delete <id>                # Delete VM
  cmux ls                         # List all VMs`,
	// Silence usage and errors - we handle our own error output
	SilenceUsage:  true,
	SilenceErrors: true,
	// Apply config overrides before any command runs
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		// Set config overrides from CLI flags (empty strings are ignored)
		auth.SetConfigOverrides("", "", flagAPIURL, flagConvexSiteURL)
	},
}

func init() {
	// Global flags available to all commands
	rootCmd.PersistentFlags().BoolVar(&flagJSON, "json", false, "Output as JSON")
	rootCmd.PersistentFlags().BoolVarP(&flagVerbose, "verbose", "v", false, "Verbose output")

	// Config override flags (override env vars and build-time values)
	rootCmd.PersistentFlags().StringVar(&flagAPIURL, "api-url", "", "Override API URL (default: https://manaflow.com)")
	rootCmd.PersistentFlags().StringVar(&flagConvexSiteURL, "convex-url", "", "Override Convex site URL")

	// Version command
	rootCmd.AddCommand(versionCmd)

	// Auth commands
	rootCmd.AddCommand(authCmd)

	// Root-level shorthand commands for auth (convenience aliases)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(whoamiCmd)
}

// Execute runs the root command
func Execute() error {
	return rootCmd.Execute()
}

// Helper to check if output is a terminal
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}
