// cmd/devsh/main.go
package main

import (
	"fmt"
	"os"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/cli"
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

	// In dev mode, load .env file early so all packages (pvelxc, etc.)
	// can read env vars like PVE_API_URL, PVE_API_TOKEN from .env
	if Mode == "dev" {
		auth.LoadEnvFile()
	}

	// Set DEVSH_DEV for IsDev detection (check new and legacy env vars)
	if os.Getenv("DEVSH_DEV") == "" && os.Getenv("DEVSH_PROD") == "" &&
		os.Getenv("CMUX_DEVBOX_DEV") == "" && os.Getenv("CMUX_DEVBOX_PROD") == "" {
		if Mode == "dev" {
			os.Setenv("DEVSH_DEV", "1")
		}
	}

	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
