package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print version information",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("cloudrouter %s\n", versionStr)
		if flagVerbose {
			fmt.Printf("  Commit: %s\n", commitStr)
			fmt.Printf("  Built:  %s\n", buildTimeStr)
			fmt.Printf("  Mode:   %s\n", buildMode)
		}
	},
}
