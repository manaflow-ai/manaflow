// cmd/cmux-devbox/main.go
package main

import (
	"fmt"
	"os"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/cli"
)

// These are set by the build process
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
	Mode      = "dev" // "dev" or "prod" - set to "prod" for release builds
)

func main() {
	// Set build mode in both cli and auth packages
	// This determines which default values are used (dev vs prod endpoints)
	cli.SetVersionInfo(Version, Commit, BuildTime)
	cli.SetBuildMode(Mode)
	auth.SetBuildMode(Mode)

	// Set CMUX_DEVBOX_DEV for backwards compatibility with IsDev field
	if os.Getenv("CMUX_DEVBOX_DEV") == "" && os.Getenv("CMUX_DEVBOX_PROD") == "" {
		if Mode == "dev" {
			os.Setenv("CMUX_DEVBOX_DEV", "1")
		}
	}

	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
