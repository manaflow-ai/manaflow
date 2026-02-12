// internal/cli/computer.go
package cli

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var computerCmd = &cobra.Command{
	Use:   "computer",
	Short: "Browser automation commands",
	Long: `Control the browser in a sandbox via Chrome CDP.

These commands allow you to automate the Chrome browser running in the VNC desktop.

Examples:
  cloudrouter computer snapshot cr_abc123              # Get accessibility tree
  cloudrouter computer open cr_abc123 https://example.com  # Navigate to URL
  cloudrouter computer click cr_abc123 @e1             # Click element by ref
  cloudrouter computer type cr_abc123 "hello world"   # Type text
  cloudrouter computer screenshot cr_abc123           # Take screenshot`,
}

// execComputerCommand makes a request to the worker daemon's computer endpoint
func execComputerCommand(sandboxID, endpoint string, body map[string]interface{}) (map[string]interface{}, error) {
	teamSlug, err := getTeamSlug()
	if err != nil {
		return nil, fmt.Errorf("failed to get team: %w", err)
	}

	client := api.NewClient()
	inst, err := client.GetInstance(teamSlug, sandboxID)
	if err != nil {
		return nil, fmt.Errorf("sandbox not found: %w", err)
	}

	if inst.WorkerURL == "" {
		return nil, fmt.Errorf("worker URL not available")
	}

	token, err := client.GetAuthToken(teamSlug, sandboxID)
	if err != nil {
		return nil, fmt.Errorf("failed to get auth token: %w", err)
	}

	var bodyBytes []byte
	if body != nil {
		bodyBytes, _ = json.Marshal(body)
	}

	resp, err := api.DoWorkerRequest(inst.WorkerURL, endpoint, token, bodyBytes)
	if err != nil {
		return nil, err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Check for error in response
	if errMsg, ok := result["error"].(string); ok && errMsg != "" {
		return nil, fmt.Errorf("worker error: %s", errMsg)
	}

	return result, nil
}

// Snapshot command
var computerSnapshotCmd = &cobra.Command{
	Use:   "snapshot <id>",
	Short: "Get browser accessibility tree snapshot",
	Long: `Get a snapshot of the current browser state showing interactive elements.

Each element is assigned a ref (e.g., @e1, @e2) that can be used with click, type, etc.

Example:
  cloudrouter computer snapshot cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		result, err := execComputerCommand(args[0], "/snapshot", nil)
		if err != nil {
			return err
		}

		// Parse and display in readable format
		if data, ok := result["data"].(map[string]interface{}); ok {
			if snapshot, ok := data["snapshot"].(string); ok {
				fmt.Println(snapshot)
				return nil
			}
		}
		output, _ := json.Marshal(result)
		fmt.Println(string(output))
		return nil
	},
}

// Open command
var computerOpenCmd = &cobra.Command{
	Use:   "open <id> <url>",
	Short: "Navigate browser to URL",
	Long: `Navigate the browser to the specified URL.

Example:
  cloudrouter computer open cr_abc123 https://google.com`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/open", map[string]interface{}{
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
  cloudrouter computer click cr_abc123 @e1          # Click by ref
  cloudrouter computer click cr_abc123 "#submit"    # Click by CSS selector`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/click", map[string]interface{}{
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
  cloudrouter computer type cr_abc123 "hello world"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/type", map[string]interface{}{
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
  cloudrouter computer fill cr_abc123 @e2 "user@example.com"
  cloudrouter computer fill cr_abc123 "#email" "user@example.com"`,
	Args: cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/fill", map[string]interface{}{
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
  cloudrouter computer press cr_abc123 Enter
  cloudrouter computer press cr_abc123 Tab`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/press", map[string]interface{}{
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
  cloudrouter computer scroll cr_abc123 down
  cloudrouter computer scroll cr_abc123 up`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/scroll", map[string]interface{}{
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
  cloudrouter computer screenshot cr_abc123
  cloudrouter computer screenshot cr_abc123 screenshot.png`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		result, err := execComputerCommand(args[0], "/screenshot", nil)
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
			if b64, ok := result["base64"].(string); ok {
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
		_, err := execComputerCommand(args[0], "/back", nil)
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
		_, err := execComputerCommand(args[0], "/forward", nil)
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
		_, err := execComputerCommand(args[0], "/reload", nil)
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
		result, err := execComputerCommand(args[0], "/url", nil)
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
		result, err := execComputerCommand(args[0], "/title", nil)
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
  cloudrouter computer wait cr_abc123 "#content"
  cloudrouter computer wait cr_abc123 "@e5"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/wait", map[string]interface{}{
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
  cloudrouter computer hover cr_abc123 @e5
  cloudrouter computer hover cr_abc123 ".dropdown"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execComputerCommand(args[0], "/hover", map[string]interface{}{
			"selector": args[1],
		})
		if err != nil {
			return err
		}

		fmt.Printf("Hovering over: %s\n", args[1])
		return nil
	},
}

func init() {
	// Add flags
	computerWaitCmd.Flags().Int("timeout", 30000, "Timeout in milliseconds")

	// Add subcommands
	computerCmd.AddCommand(computerSnapshotCmd)
	computerCmd.AddCommand(computerOpenCmd)
	computerCmd.AddCommand(computerClickCmd)
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
}
