// internal/cli/version.go
package cli

import (
	"fmt"
	"os"
	"runtime"

	"github.com/spf13/cobra"
)

var (
	version   = "dev"
	commit    = "unknown"
	buildTime = "unknown"
	buildMode = "dev" // "dev" or "prod"
)

func SetVersionInfo(v, c, bt string) {
	version = v
	commit = c
	buildTime = bt
}

// SetBuildMode sets the build mode (dev or prod)
func SetBuildMode(mode string) {
	buildMode = mode
}

// IsDev returns true if running in dev mode
// Checks: 1) CMUX_DEVBOX_DEV env var, 2) build mode
func IsDev() bool {
	if env := os.Getenv("CMUX_DEVBOX_DEV"); env == "1" || env == "true" {
		return true
	}
	if env := os.Getenv("CMUX_DEVBOX_PROD"); env == "1" || env == "true" {
		return false
	}
	return buildMode == "dev"
}

// GetVersion returns the current version
func GetVersion() string {
	return version
}

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("cmux devbox version %s\n", version)
		fmt.Printf("  commit:  %s\n", commit)
		fmt.Printf("  built:   %s\n", buildTime)
		fmt.Printf("  go:      %s\n", runtime.Version())
		fmt.Printf("  os/arch: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	},
}
