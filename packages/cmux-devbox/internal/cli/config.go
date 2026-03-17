// internal/cli/config.go
package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/spf13/cobra"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Show current configuration",
	Long: `Show current configuration values and their sources.

Configuration priority (highest to lowest):
  1. CLI flags (--api-url, --convex-url)
  2. Environment variables (CMUX_API_URL, CONVEX_SITE_URL, etc.)
  3. Build-time values (compiled into binary)
  4. Hardcoded defaults

Environment variables:
  STACK_PROJECT_ID              Stack Auth project ID
  STACK_PUBLISHABLE_CLIENT_KEY  Stack Auth publishable client key
  CMUX_API_URL                  cmux web app URL
  CONVEX_SITE_URL               Convex HTTP site URL
  AUTH_API_URL                  Stack Auth API URL`,
	RunE: runConfig,
}

func init() {
	rootCmd.AddCommand(configCmd)
}

type configOutput struct {
	ProjectID      string `json:"project_id"`
	CmuxURL        string `json:"cmux_url"`
	ConvexSiteURL  string `json:"convex_site_url"`
	StackAuthURL   string `json:"stack_auth_url"`
	IsDev          bool   `json:"is_dev"`
	BuildMode      string `json:"build_mode"`
}

func runConfig(cmd *cobra.Command, args []string) error {
	cfg := auth.GetConfig()

	if flagJSON {
		output := configOutput{
			ProjectID:     cfg.ProjectID,
			CmuxURL:       cfg.CmuxURL,
			ConvexSiteURL: cfg.ConvexSiteURL,
			StackAuthURL:  cfg.StackAuthURL,
			IsDev:         cfg.IsDev,
			BuildMode:     buildMode,
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(output)
	}

	fmt.Println("Current configuration:")
	fmt.Println()
	fmt.Printf("  Build mode:      %s\n", buildMode)
	fmt.Printf("  Is dev:          %v\n", cfg.IsDev)
	fmt.Println()
	fmt.Printf("  Project ID:      %s\n", maskMiddle(cfg.ProjectID))
	fmt.Printf("  cmux URL:        %s\n", cfg.CmuxURL)
	fmt.Printf("  Convex site URL: %s\n", cfg.ConvexSiteURL)
	fmt.Printf("  Stack Auth URL:  %s\n", cfg.StackAuthURL)
	fmt.Println()
	fmt.Println("To override, use CLI flags or environment variables:")
	fmt.Println("  --api-url=URL     or  CMUX_API_URL=URL")
	fmt.Println("  --convex-url=URL  or  CONVEX_SITE_URL=URL")

	return nil
}

// maskMiddle masks the middle of a string for privacy
func maskMiddle(s string) string {
	if len(s) <= 8 {
		return s
	}
	return s[:4] + "..." + s[len(s)-4:]
}
