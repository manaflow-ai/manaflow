// internal/cli/open.go
package cli

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/spf13/cobra"
)

func buildAuthURL(workerURL, targetPath, token string) (string, error) {
	parsed, err := url.Parse(workerURL)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	parsed.Path = "/_cmux/auth"
	query := parsed.Query()
	query.Set("token", token)
	query.Set("return", targetPath)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

// getAuthToken calls the worker to generate a one-time auth token
func getAuthToken(ctx context.Context, client *vm.Client, instanceID string) (string, error) {
	token, err := client.GenerateAuthToken(ctx, instanceID)
	if err != nil {
		return "", fmt.Errorf("failed to generate auth token: %w", err)
	}
	return token, nil
}

var codeCmd = &cobra.Command{
	Use:   "code <id>",
	Short: "Open VS Code in browser",
	Long: `Open VS Code for a VM in your browser.

Examples:
  cmux code cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		instance, err := client.GetInstance(ctx, instanceID)
		if err != nil {
			return fmt.Errorf("failed to get instance: %w", err)
		}

		if instance.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		// Generate one-time auth token
		token, err := getAuthToken(ctx, client, instanceID)
		if err != nil {
			return err
		}

		// Build auth URL that sets session cookie and redirects to VS Code
		authURL, err := buildAuthURL(instance.WorkerURL, "/code/?folder=/home/cmux/workspace", token)
		if err != nil {
			return err
		}

		fmt.Printf("Opening VS Code...\n")
		return openBrowser(authURL)
	},
}

var vncCmd = &cobra.Command{
	Use:   "vnc <id>",
	Short: "Open VNC desktop in browser",
	Long: `Open VNC desktop for a VM in your browser.

Examples:
  cmux vnc cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		instance, err := client.GetInstance(ctx, instanceID)
		if err != nil {
			return fmt.Errorf("failed to get instance: %w", err)
		}

		if instance.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		// Generate one-time auth token
		token, err := getAuthToken(ctx, client, instanceID)
		if err != nil {
			return err
		}

		// Build auth URL that sets session cookie and redirects to VNC
		authURL, err := buildAuthURL(instance.WorkerURL, "/vnc/vnc.html?path=vnc/websockify&resize=scale&quality=9&compression=0", token)
		if err != nil {
			return err
		}

		fmt.Printf("Opening VNC...\n")
		return openBrowser(authURL)
	},
}

var sshCmd = &cobra.Command{
	Use:   "ssh <id>",
	Short: "SSH into a VM",
	Long: `SSH into a VM.

Examples:
  cmux ssh cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		sshCommand, err := client.GetSSHCredentials(ctx, instanceID)
		if err != nil {
			return fmt.Errorf("failed to get SSH credentials: %w", err)
		}

		fmt.Printf("Connecting: %s\n", sshCommand)

		// Parse SSH command: "ssh token@ssh.cloud.morph.so"
		parts := strings.Fields(sshCommand)
		if len(parts) < 2 {
			return fmt.Errorf("invalid SSH command format")
		}

		sshExec := exec.Command("ssh",
			"-o", "StrictHostKeyChecking=no",
			"-o", "UserKnownHostsFile=/dev/null",
			parts[1],
		)
		sshExec.Stdin = os.Stdin
		sshExec.Stdout = os.Stdout
		sshExec.Stderr = os.Stderr

		return sshExec.Run()
	},
}

var statusCmd = &cobra.Command{
	Use:   "status <id>",
	Short: "Show VM status",
	Long: `Show the status of a VM.

Examples:
  cmux status cmux_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]

		teamSlug, err := auth.GetTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client, err := vm.NewClient()
		if err != nil {
			return fmt.Errorf("failed to create client: %w", err)
		}
		client.SetTeamSlug(teamSlug)

		instance, err := client.GetInstance(ctx, instanceID)
		if err != nil {
			return fmt.Errorf("failed to get instance: %w", err)
		}

		fmt.Printf("ID:       %s\n", instance.ID)
		fmt.Printf("Status:   %s\n", instance.Status)

		// Generate authenticated URLs if the instance is running
		if instance.WorkerURL != "" && instance.Status == "running" {
			token, err := getAuthToken(ctx, client, instanceID)
			if err != nil {
				// Fall back to raw URLs
				if instance.VSCodeURL != "" {
					fmt.Printf("VS Code:  %s\n", instance.VSCodeURL)
				}
				if instance.VNCURL != "" {
					fmt.Printf("VNC:      %s\n", instance.VNCURL)
				}
			} else {
				codeAuthURL, _ := buildAuthURL(instance.WorkerURL, "/code/?folder=/home/cmux/workspace", token)
				vncAuthURL, _ := buildAuthURL(instance.WorkerURL, "/vnc/vnc.html?path=vnc/websockify&resize=scale&quality=9&compression=0", token)
				fmt.Printf("VS Code:  %s\n", codeAuthURL)
				fmt.Printf("VNC:      %s\n", vncAuthURL)
			}
		} else {
			if instance.VSCodeURL != "" {
				fmt.Printf("VS Code:  %s\n", instance.VSCodeURL)
			}
			if instance.VNCURL != "" {
				fmt.Printf("VNC:      %s\n", instance.VNCURL)
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

func init() {
	rootCmd.AddCommand(codeCmd)
	rootCmd.AddCommand(vncCmd)
	rootCmd.AddCommand(sshCmd)
	rootCmd.AddCommand(statusCmd)
}
