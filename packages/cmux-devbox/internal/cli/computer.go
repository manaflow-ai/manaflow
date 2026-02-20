// internal/cli/computer.go
package cli

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/spf13/cobra"
)

var computerCmd = &cobra.Command{
	Use:   "computer",
	Short: "Browser automation commands",
	Long: `Control the browser in a VM via agent-browser.

These commands allow you to automate the Chrome browser running in the VNC desktop.

Examples:
  cmux computer snapshot cmux_abc123              # Get accessibility tree
  cmux computer open cmux_abc123 https://example.com  # Navigate to URL
  cmux computer click cmux_abc123 @e1             # Click element by ref
  cmux computer type cmux_abc123 "hello world"   # Type text
  cmux computer screenshot cmux_abc123           # Take screenshot`,
}

// getWorkerClient returns the worker URL and JWT for an instance
func getWorkerClient(ctx context.Context, instanceID string) (workerURL string, token string, err error) {
	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return "", "", fmt.Errorf("failed to get team: %w", err)
	}

	client, err := vm.NewClient()
	if err != nil {
		return "", "", fmt.Errorf("failed to create VM client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	// Get instance to get worker URL
	instance, err := client.GetInstance(ctx, instanceID)
	if err != nil {
		return "", "", fmt.Errorf("failed to get instance: %w", err)
	}

	if instance.WorkerURL == "" {
		return "", "", fmt.Errorf("instance has no worker URL")
	}

	// Get the Stack Auth JWT (same token used for Convex API)
	accessToken, err := auth.GetAccessToken()
	if err != nil {
		return "", "", fmt.Errorf("failed to get access token: %w", err)
	}

	return instance.WorkerURL, accessToken, nil
}

// callWorkerAPI makes an authenticated request to the worker daemon
func callWorkerAPI(ctx context.Context, workerURL, token, endpoint string, body map[string]interface{}) (map[string]interface{}, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	url := workerURL + endpoint
	req, err := http.NewRequestWithContext(ctx, "POST", url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	httpClient := &http.Client{Timeout: 60 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("unauthorized: invalid or missing token")
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Check for error in response
	if errMsg, ok := result["error"].(string); ok && errMsg != "" {
		return nil, fmt.Errorf("worker error: %s", errMsg)
	}

	return result, nil
}

// execAgentBrowser runs an agent-browser command via the worker daemon
func execAgentBrowser(ctx context.Context, instanceID string, endpoint string, body map[string]interface{}) (map[string]interface{}, error) {
	workerURL, token, err := getWorkerClient(ctx, instanceID)
	if err != nil {
		return nil, err
	}

	return callWorkerAPI(ctx, workerURL, token, endpoint, body)
}

// Snapshot command
var computerSnapshotCmd = &cobra.Command{
	Use:   "snapshot <id>",
	Short: "Get browser accessibility tree snapshot",
	Long: `Get a snapshot of the current browser state showing interactive elements.

Each element is assigned a ref (e.g., @e1, @e2) that can be used with click, type, etc.

Examples:
  cmux computer snapshot cmux_abc123           # Full accessibility tree
  cmux computer snapshot -i cmux_abc123        # Interactive elements only (preferred)
  cmux computer snapshot -i -c cmux_abc123     # Interactive + compact`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		body := map[string]interface{}{}
		if interactive, _ := cmd.Flags().GetBool("interactive"); interactive {
			body["interactive"] = true
		}
		if compact, _ := cmd.Flags().GetBool("compact"); compact {
			body["compact"] = true
		}

		var bodyArg map[string]interface{}
		if len(body) > 0 {
			bodyArg = body
		}

		result, err := execAgentBrowser(ctx, args[0], "/snapshot", bodyArg)
		if err != nil {
			return err
		}

		if flagJSON {
			output, _ := json.Marshal(result)
			fmt.Println(string(output))
		} else {
			// Parse and display in readable format
			if data, ok := result["data"].(map[string]interface{}); ok {
				if snapshot, ok := data["snapshot"].(string); ok {
					fmt.Println(snapshot)
					return nil
				}
			}
			output, _ := json.Marshal(result)
			fmt.Println(string(output))
		}
		return nil
	},
}

// Open command
var computerOpenCmd = &cobra.Command{
	Use:   "open <id> <url>",
	Short: "Navigate browser to URL",
	Long: `Navigate the browser to the specified URL.

Example:
  cmux computer open cmux_abc123 https://google.com`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/open", map[string]interface{}{
			"url": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Navigated to: %s\n", args[1])
		return nil
	},
}

// Click command
var computerClickCmd = &cobra.Command{
	Use:   "click <id> <selector>",
	Short: "Click an element",
	Long: `Click an element by selector (ref like @e1 or CSS selector).

Examples:
  cmux computer click cmux_abc123 @e1          # Click by ref
  cmux computer click cmux_abc123 "#submit"    # Click by CSS selector`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/click", map[string]interface{}{
			"selector": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Clicked: %s\n", args[1])
		return nil
	},
}

// Type command
var computerTypeCmd = &cobra.Command{
	Use:   "type <id> <text>",
	Short: "Type text into the focused element",
	Long: `Type text into the currently focused element.

Example:
  cmux computer type cmux_abc123 "hello world"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/type", map[string]interface{}{
			"text": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Println("Typed text")
		return nil
	},
}

// Fill command
var computerFillCmd = &cobra.Command{
	Use:   "fill <id> <selector> <value>",
	Short: "Clear and fill an input field",
	Long: `Clear an input field and fill it with the specified value.

Examples:
  cmux computer fill cmux_abc123 @e2 "user@example.com"
  cmux computer fill cmux_abc123 "#email" "user@example.com"`,
	Args: cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/fill", map[string]interface{}{
			"selector": args[1],
			"value":    args[2],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Filled %s\n", args[1])
		return nil
	},
}

// Press command
var computerPressCmd = &cobra.Command{
	Use:   "press <id> <key>",
	Short: "Press a key",
	Long: `Press a key on the keyboard.

Common keys: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight

Example:
  cmux computer press cmux_abc123 Enter
  cmux computer press cmux_abc123 Tab`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/press", map[string]interface{}{
			"key": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Pressed: %s\n", args[1])
		return nil
	},
}

// Scroll command
var computerScrollCmd = &cobra.Command{
	Use:   "scroll <id> <direction>",
	Short: "Scroll the page",
	Long: `Scroll the page in the specified direction.

Directions: up, down

Example:
  cmux computer scroll cmux_abc123 down
  cmux computer scroll cmux_abc123 up`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/scroll", map[string]interface{}{
			"direction": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Scrolled %s\n", args[1])
		return nil
	},
}

// Screenshot command
var computerScreenshotCmd = &cobra.Command{
	Use:   "screenshot <id> [output-file]",
	Short: "Take a screenshot",
	Long: `Take a screenshot of the current browser state.

If output file is not specified, outputs base64-encoded PNG to stdout.

Examples:
  cmux computer screenshot cmux_abc123
  cmux computer screenshot cmux_abc123 screenshot.png`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		result, err := execAgentBrowser(ctx, args[0], "/screenshot", nil)
		if err != nil {
			return err
		}

		// Get base64 data from response
		var b64Data string
		if data, ok := result["data"].(map[string]interface{}); ok {
			if b64, ok := data["base64"].(string); ok {
				b64Data = b64
			}
		}

		if b64Data == "" {
			return fmt.Errorf("screenshot failed: no base64 data in response")
		}

		if len(args) > 1 {
			// Decode and save to file
			data, err := base64.StdEncoding.DecodeString(b64Data)
			if err != nil {
				return fmt.Errorf("failed to decode screenshot: %w", err)
			}
			if err := os.WriteFile(args[1], data, 0644); err != nil {
				return fmt.Errorf("failed to write file: %w", err)
			}
			fmt.Printf("Screenshot saved to: %s\n", args[1])
		} else {
			// Output base64
			fmt.Println(b64Data)
		}
		return nil
	},
}

// Back command
var computerBackCmd = &cobra.Command{
	Use:   "back <id>",
	Short: "Navigate back in history",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/back", nil)
		if err != nil {
			return err
		}

		fmt.Println("Navigated back")
		return nil
	},
}

// Forward command
var computerForwardCmd = &cobra.Command{
	Use:   "forward <id>",
	Short: "Navigate forward in history",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/forward", nil)
		if err != nil {
			return err
		}

		fmt.Println("Navigated forward")
		return nil
	},
}

// Reload command
var computerReloadCmd = &cobra.Command{
	Use:   "reload <id>",
	Short: "Reload the current page",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/reload", nil)
		if err != nil {
			return err
		}

		fmt.Println("Page reloaded")
		return nil
	},
}

// URL command
var computerURLCmd = &cobra.Command{
	Use:   "url <id>",
	Short: "Get current page URL",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		result, err := execAgentBrowser(ctx, args[0], "/url", nil)
		if err != nil {
			return err
		}

		if data, ok := result["data"].(map[string]interface{}); ok {
			if url, ok := data["url"].(string); ok {
				fmt.Println(url)
				return nil
			}
		}
		if url, ok := result["url"].(string); ok {
			fmt.Println(url)
			return nil
		}
		output, _ := json.Marshal(result)
		fmt.Println(string(output))
		return nil
	},
}

// Title command
var computerTitleCmd = &cobra.Command{
	Use:   "title <id>",
	Short: "Get current page title",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		result, err := execAgentBrowser(ctx, args[0], "/title", nil)
		if err != nil {
			return err
		}

		if data, ok := result["data"].(map[string]interface{}); ok {
			if title, ok := data["title"].(string); ok {
				fmt.Println(title)
				return nil
			}
		}
		if title, ok := result["title"].(string); ok {
			fmt.Println(title)
			return nil
		}
		output, _ := json.Marshal(result)
		fmt.Println(string(output))
		return nil
	},
}

// Wait command
var computerWaitCmd = &cobra.Command{
	Use:   "wait <id> <selector>",
	Short: "Wait for an element",
	Long: `Wait for an element to be visible.

Example:
  cmux computer wait cmux_abc123 "#content"
  cmux computer wait cmux_abc123 "@e5"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		timeout, _ := cmd.Flags().GetInt("timeout")

		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout+10000)*time.Millisecond)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/wait", map[string]interface{}{
			"selector": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Element %s found\n", args[1])
		return nil
	},
}

// Hover command
var computerHoverCmd = &cobra.Command{
	Use:   "hover <id> <selector>",
	Short: "Hover over an element",
	Long: `Hover the mouse over an element.

Example:
  cmux computer hover cmux_abc123 @e5
  cmux computer hover cmux_abc123 ".dropdown"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/hover", map[string]interface{}{
			"selector": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Hovering over: %s\n", args[1])
		return nil
	},
}

// Double-click command
var computerDblclickCmd = &cobra.Command{
	Use:   "dblclick <id> <selector>",
	Short: "Double-click an element",
	Long: `Double-click an element by selector (ref like @e1 or CSS selector).

Examples:
  cmux computer dblclick cmux_abc123 @e1          # Double-click by ref
  cmux computer dblclick cmux_abc123 "#item"      # Double-click by CSS selector`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		_, err := execAgentBrowser(ctx, args[0], "/dblclick", map[string]interface{}{
			"selector": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Double-clicked: %s\n", args[1])
		return nil
	},
}

// Eval command
var computerEvalCmd = &cobra.Command{
	Use:   "eval <id> <script>",
	Short: "Evaluate JavaScript in the browser",
	Long: `Execute JavaScript in the browser and return the result.

Examples:
  cmux computer eval cmux_abc123 "document.title"
  cmux computer eval cmux_abc123 "document.querySelectorAll('a').length"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		result, err := execAgentBrowser(ctx, args[0], "/eval", map[string]interface{}{
			"script": args[1],
		})
		if err != nil {
			return err
		}

		if data, ok := result["data"].(map[string]interface{}); ok {
			if val, ok := data["result"]; ok {
				output, _ := json.Marshal(val)
				fmt.Println(string(output))
				return nil
			}
		}
		output, _ := json.Marshal(result)
		fmt.Println(string(output))
		return nil
	},
}

func init() {
	// Add flags
	computerSnapshotCmd.Flags().BoolP("interactive", "i", false, "Show only interactive elements")
	computerSnapshotCmd.Flags().BoolP("compact", "c", false, "Compact output")
	computerWaitCmd.Flags().Int("timeout", 30000, "Timeout in milliseconds")

	// Add subcommands
	computerCmd.AddCommand(computerSnapshotCmd)
	computerCmd.AddCommand(computerOpenCmd)
	computerCmd.AddCommand(computerClickCmd)
	computerCmd.AddCommand(computerDblclickCmd)
	computerCmd.AddCommand(computerTypeCmd)
	computerCmd.AddCommand(computerFillCmd)
	computerCmd.AddCommand(computerPressCmd)
	computerCmd.AddCommand(computerScrollCmd)
	computerCmd.AddCommand(computerScreenshotCmd)
	computerCmd.AddCommand(computerBackCmd)
	computerCmd.AddCommand(computerForwardCmd)
	computerCmd.AddCommand(computerReloadCmd)
	computerCmd.AddCommand(computerURLCmd)
	computerCmd.AddCommand(computerTitleCmd)
	computerCmd.AddCommand(computerWaitCmd)
	computerCmd.AddCommand(computerHoverCmd)
	computerCmd.AddCommand(computerEvalCmd)

	// Add to root
	rootCmd.AddCommand(computerCmd)
}
