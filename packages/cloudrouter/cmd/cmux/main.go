package main

import (
	"fmt"
	"os"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/auth"
	"github.com/manaflow-ai/cloudrouter/internal/cli"
	"github.com/manaflow-ai/cloudrouter/internal/telemetry"
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
	telemetry.SetContext(Version, Mode)

	if os.Getenv("CMUX_E2B_DEV") == "" && os.Getenv("CMUX_E2B_PROD") == "" {
		if Mode == "dev" {
			os.Setenv("CMUX_E2B_DEV", "1")
		}
	}

	err := cli.Execute()
	telemetry.Drain(1200 * time.Millisecond)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
