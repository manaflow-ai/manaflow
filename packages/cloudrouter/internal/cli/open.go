package cli

import (
	"fmt"
	"net/url"
	"os/exec"
	"runtime"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

// buildAuthURL builds a URL with token authentication
// E2B gives each port its own subdomain, so we use query params for auth
// Both VSCode and VNC use the same ?tkn= pattern for consistent auth
func buildAuthURL(baseURL, token string, isVNC bool) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	query := parsed.Query()
	// Both VSCode and VNC use 'tkn' param for token-based auth
	query.Set("tkn", token)
	if isVNC {
		// noVNC params for best experience
		// See: https://github.com/novnc/noVNC/blob/master/docs/EMBEDDING.md
		query.Set("autoconnect", "true")      // Auto-connect to VNC
		query.Set("resize", "scale")          // Local scaling mode
		query.Set("quality", "9")             // Highest JPEG quality (0-9)
		query.Set("compression", "0")         // No compression (0-9, 0=best quality)
		query.Set("show_dot", "true")         // Show local cursor
		query.Set("reconnect", "true")        // Auto-reconnect on disconnect
		query.Set("reconnect_delay", "1000")  // 1 second reconnect delay
	} else {
		// Set default folder for VSCode
		query.Set("folder", "/home/user/workspace")
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

var codeCmd = &cobra.Command{
	Use:   "code <id>",
	Short: "Open VS Code in browser",
	Long: `Open VS Code for a sandbox in your browser.

Examples:
  cloudrouter code cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, args[0])
		if err != nil {
			return err
		}

		if inst.VSCodeURL == "" {
			return fmt.Errorf("VSCode URL not available")
		}

		// Fetch auth token from the sandbox
		token, err := client.GetAuthToken(teamSlug, args[0])
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		authURL, err := buildAuthURL(inst.VSCodeURL, token, false)
		if err != nil {
			return err
		}

		fmt.Println("Opening VS Code...")
		return openBrowser(authURL)
	},
}

var vncCmd = &cobra.Command{
	Use:   "vnc <id>",
	Short: "Open VNC desktop in browser",
	Long: `Open VNC desktop for a sandbox in your browser.

Examples:
  cloudrouter vnc cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, args[0])
		if err != nil {
			return err
		}

		if inst.VNCURL == "" {
			return fmt.Errorf("VNC URL not available")
		}

		// Fetch auth token from the sandbox
		token, err := client.GetAuthToken(teamSlug, args[0])
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		authURL, err := buildAuthURL(inst.VNCURL, token, true)
		if err != nil {
			return err
		}

		fmt.Println("Opening VNC...")
		return openBrowser(authURL)
	},
}

var jupyterCmd = &cobra.Command{
	Use:   "jupyter <id>",
	Short: "Open Jupyter Lab in browser",
	Long: `Open Jupyter Lab for a sandbox in your browser (Modal sandboxes only).

Examples:
  cloudrouter jupyter cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, args[0])
		if err != nil {
			return err
		}

		if inst.JupyterURL == "" {
			return fmt.Errorf("Jupyter URL not available (only available on Modal sandboxes)")
		}

		// Fetch auth token from the sandbox
		token, err := client.GetAuthToken(teamSlug, args[0])
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		// Jupyter uses ?token= for auth
		parsed, err := url.Parse(inst.JupyterURL)
		if err != nil {
			return fmt.Errorf("invalid Jupyter URL: %w", err)
		}
		query := parsed.Query()
		query.Set("token", token)
		parsed.RawQuery = query.Encode()

		fmt.Println("Opening Jupyter Lab...")
		return openBrowser(parsed.String())
	},
}

var statusCmd = &cobra.Command{
	Use:   "status <id>",
	Short: "Show sandbox status",
	Long: `Show the status of a sandbox.

Examples:
  cloudrouter status cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, args[0])
		if err != nil {
			return err
		}

		fmt.Printf("ID:       %s\n", inst.ID)
		fmt.Printf("Status:   %s\n", inst.Status)
		if inst.Name != "" {
			fmt.Printf("Name:     %s\n", inst.Name)
		}

		// Try to get authenticated URLs
		if inst.Status == "running" {
			token, err := client.GetAuthToken(teamSlug, args[0])
			if err == nil && token != "" {
				if inst.VSCodeURL != "" {
					codeURL, _ := buildAuthURL(inst.VSCodeURL, token, false)
					fmt.Printf("VS Code:  %s\n", codeURL)
				}
				if inst.VNCURL != "" {
					vncURL, _ := buildAuthURL(inst.VNCURL, token, true)
					fmt.Printf("VNC:      %s\n", vncURL)
				}
				if inst.JupyterURL != "" {
					parsed, _ := url.Parse(inst.JupyterURL)
					if parsed != nil {
						q := parsed.Query()
						q.Set("token", token)
						parsed.RawQuery = q.Encode()
						fmt.Printf("Jupyter:  %s\n", parsed.String())
					}
				}
			} else {
				if inst.VSCodeURL != "" {
					fmt.Printf("VS Code:  %s\n", inst.VSCodeURL)
				}
				if inst.VNCURL != "" {
					fmt.Printf("VNC:      %s\n", inst.VNCURL)
				}
				if inst.JupyterURL != "" {
					fmt.Printf("Jupyter:  %s\n", inst.JupyterURL)
				}
			}
		}

		return nil
	},
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		return fmt.Errorf("unsupported platform")
	}
	return cmd.Start()
}

// Keep openURL as alias for backward compatibility
func openURL(url string) error {
	return openBrowser(url)
}
