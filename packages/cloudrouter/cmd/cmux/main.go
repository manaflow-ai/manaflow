package main

import (
	"fmt"
	"os"

	"github.com/manaflow-ai/cloudrouter/internal/auth"
	"github.com/manaflow-ai/cloudrouter/internal/cli"
	"github.com/manaflow-ai/cloudrouter/internal/version"
)

// Build-time variables set via ldflags
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
	Mode      = "dev" // "dev" or "prod"
)

func main() {
	cli.SetVersionInfo(Version, Commit, BuildTime)
	cli.SetBuildMode(Mode)
	auth.SetBuildMode(Mode)
	version.SetCurrentVersion(Version)

	if os.Getenv("CMUX_E2B_DEV") == "" && os.Getenv("CMUX_E2B_PROD") == "" {
		if Mode == "dev" {
			os.Setenv("CMUX_E2B_DEV", "1")
		}
	}

	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
