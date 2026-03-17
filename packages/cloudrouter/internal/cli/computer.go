// internal/cli/browser.go
package cli

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var browserCmd = &cobra.Command{
	Use:   "browser",
	Short: "Browser automation commands (wraps agent-browser)",
	Long: `Control the browser in a sandbox via agent-browser CLI.

These commands allow you to automate the Chrome browser running in the VNC desktop.
Under the hood, each command runs "agent-browser <command>" inside the sandbox via SSH.

Examples:
  cloudrouter browser snapshot cr_abc123              # Get accessibility tree
  cloudrouter browser open cr_abc123 https://example.com  # Navigate to URL
  cloudrouter browser click cr_abc123 @e1             # Click element by ref
  cloudrouter browser type cr_abc123 @e1 "hello"     # Type text into element
  cloudrouter browser screenshot cr_abc123            # Take screenshot
  cloudrouter browser eval cr_abc123 "document.title" # Evaluate JavaScript`,
}

// shellQuote wraps a string in single quotes for safe shell execution.
// The command goes through one shell layer: su - user -c "..." invokes bash.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// runSSHCommand runs a command inside the sandbox via SSH over WebSocket tunnel.
// Uses cloudrouter's built-in __ssh-proxy as SSH ProxyCommand.
// Handles non-interactive password auth via sshpass or SSH_ASKPASS to avoid
// password prompts on Linux where SSH opens /dev/tty directly.
// Returns stdout, stderr, and exit code.
func runSSHCommand(workerURL, token, command string) (string, string, int, error) {
	wsURL := toWebSocketURL(workerURL, token)

	selfPath, err := getSelfPath()
	if err != nil {
		return "", "", -1, err
	}

	proxyCmd := fmt.Sprintf("%s __ssh-proxy '%s'", selfPath, wsURL)
	sshArgs := []string{
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "LogLevel=ERROR",
		"-o", "PubkeyAuthentication=no",
		"-o", fmt.Sprintf("ProxyCommand=%s", proxyCmd),
		fmt.Sprintf("%s@e2b-sandbox", token),
		command,
	}

	cmd, cleanup, buildErr := buildSSHCmd(sshArgs)
	if buildErr != nil {
		return "", "", -1, buildErr
	}
	if cleanup != nil {
		defer cleanup()
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	exitCode := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		} else {
			return "", "", -1, fmt.Errorf("ssh failed: %w", err)
		}
	}

	stderrStr := filterSSHWarnings(stderr.String())
	return stdout.String(), stderrStr, exitCode, nil
}

// buildSSHCmd wraps SSH args with non-interactive password authentication.
// Uses sshpass when available; otherwise sets up SSH_ASKPASS with a temp
// script so SSH doesn't open /dev/tty for password prompts on Linux.
// Returns the command, an optional cleanup function, and any error.
func buildSSHCmd(sshArgs []string) (*exec.Cmd, func(), error) {
	if _, lookErr := exec.LookPath("sshpass"); lookErr == nil {
		// Preferred: use sshpass for non-interactive empty-password auth
		cmd := exec.Command("sshpass", append([]string{"-p", "", "ssh"}, sshArgs...)...)
		return cmd, nil, nil
	}

	// Fallback: use SSH_ASKPASS to provide the empty password.
	// SSH opens /dev/tty directly for password prompts (bypassing stdin),
	// so we must force it to use SSH_ASKPASS instead.
	askpassFile, err := os.CreateTemp("", "cmux-askpass-*.sh")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create askpass script: %w", err)
	}
	if _, wErr := askpassFile.WriteString("#!/bin/sh\necho ''\n"); wErr != nil {
		askpassFile.Close()
		os.Remove(askpassFile.Name())
		return nil, nil, fmt.Errorf("failed to write askpass script: %w", wErr)
	}
	askpassFile.Close()
	os.Chmod(askpassFile.Name(), 0700)
	cleanup := func() { os.Remove(askpassFile.Name()) }

	cmd := exec.Command("ssh", sshArgs...)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("SSH_ASKPASS=%s", askpassFile.Name()),
		"SSH_ASKPASS_REQUIRE=force",
		"DISPLAY=dummy",
	)
	return cmd, cleanup, nil
}

// filterSSHWarnings removes common SSH warning lines from stderr.
func filterSSHWarnings(stderr string) string {
	var lines []string
	for _, line := range strings.Split(stderr, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.Contains(trimmed, "Warning: Permanently added") {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

// execAgentBrowser runs "agent-browser --cdp 9222 <args...>" inside the sandbox via SSH.
func execAgentBrowser(sandboxID string, args ...string) (string, error) {
	teamSlug, err := getTeamSlug()
	if err != nil {
		return "", fmt.Errorf("failed to get team: %w", err)
	}

	client := api.NewClient()
	inst, err := client.GetInstance(teamSlug, sandboxID)
	if err != nil {
		return "", fmt.Errorf("sandbox not found: %w", err)
	}

	if inst.WorkerURL == "" {
		return "", fmt.Errorf("worker URL not available")
	}

	token, err := client.GetAuthToken(teamSlug, sandboxID)
	if err != nil {
		return "", fmt.Errorf("failed to get auth token: %w", err)
	}

	// Build shell command: agent-browser --cdp 9222 arg1 arg2 ...
	parts := make([]string, 0, len(args)+3)
	parts = append(parts, "agent-browser", "--cdp", "9222")
	for _, arg := range args {
		parts = append(parts, shellQuote(arg))
	}
	cmdStr := strings.Join(parts, " ")

	if flagVerbose {
		fmt.Fprintf(os.Stderr, "[debug] SSH command: %s\n", cmdStr)
	}

	stdout, stderr, exitCode, err := runSSHCommand(inst.WorkerURL, token, cmdStr)
	if err != nil {
		return "", err
	}

	if exitCode != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		if msg == "" {
			msg = fmt.Sprintf("exit code %d", exitCode)
		}
		return "", fmt.Errorf("agent-browser error: %s", msg)
	}

	return strings.TrimSpace(stdout), nil
}

// execScreenshotCommand takes a screenshot via SSH and returns base64-encoded PNG.
func execScreenshotCommand(sandboxID string) (string, error) {
	teamSlug, err := getTeamSlug()
	if err != nil {
		return "", fmt.Errorf("failed to get team: %w", err)
	}

	client := api.NewClient()
	inst, err := client.GetInstance(teamSlug, sandboxID)
	if err != nil {
		return "", fmt.Errorf("sandbox not found: %w", err)
	}

	if inst.WorkerURL == "" {
		return "", fmt.Errorf("worker URL not available")
	}

	token, err := client.GetAuthToken(teamSlug, sandboxID)
	if err != nil {
		return "", fmt.Errorf("failed to get auth token: %w", err)
	}

	// Take screenshot and base64 encode it in one SSH command
	cmdStr := "agent-browser --cdp 9222 screenshot /tmp/screenshot.png && base64 /tmp/screenshot.png"

	stdout, stderr, exitCode, err := runSSHCommand(inst.WorkerURL, token, cmdStr)
	if err != nil {
		return "", err
	}

	if exitCode != 0 {
		msg := strings.TrimSpace(stderr)
		if msg == "" {
			msg = strings.TrimSpace(stdout)
		}
		return "", fmt.Errorf("screenshot failed: %s", msg)
	}

	// The output contains agent-browser status line(s) followed by base64 data from the base64 command.
	// Find where the base64 data starts (it begins with the PNG base64 prefix "iVBOR").
	b64 := strings.TrimSpace(stdout)
	if idx := strings.Index(b64, "iVBOR"); idx > 0 {
		b64 = b64[idx:]
	}
	// Remove any embedded newlines from the base64 command output
	b64 = strings.ReplaceAll(b64, "\n", "")
	b64 = strings.ReplaceAll(b64, "\r", "")

	return b64, nil
}

// =============================================================================
// Navigation Commands
// =============================================================================

var browserSnapshotCmd = &cobra.Command{
	Use:   "snapshot <id>",
	Short: "Get browser accessibility tree snapshot",
	Long: `Get a snapshot of the current browser state showing interactive elements.
Each element is assigned a ref (e.g., @e1, @e2) that can be used with click, type, etc.

Examples:
  cloudrouter browser snapshot cr_abc123
  cloudrouter browser snapshot -i cr_abc123        # Interactive elements only`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"snapshot"}
		if interactive, _ := cmd.Flags().GetBool("interactive"); interactive {
			abArgs = append(abArgs, "-i")
		}
		if compact, _ := cmd.Flags().GetBool("compact"); compact {
			abArgs = append(abArgs, "-C")
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserOpenCmd = &cobra.Command{
	Use:   "open <id> <url>",
	Short: "Navigate browser to URL",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "open", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Navigated to: %s\n", args[1])
		return nil
	},
}

var browserBackCmd = &cobra.Command{
	Use:   "back <id>",
	Short: "Navigate back in history",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "back")
		if err != nil {
			return err
		}
		fmt.Println("Navigated back")
		return nil
	},
}

var browserForwardCmd = &cobra.Command{
	Use:   "forward <id>",
	Short: "Navigate forward in history",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "forward")
		if err != nil {
			return err
		}
		fmt.Println("Navigated forward")
		return nil
	},
}

var browserReloadCmd = &cobra.Command{
	Use:   "reload <id>",
	Short: "Reload the current page",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "reload")
		if err != nil {
			return err
		}
		fmt.Println("Page reloaded")
		return nil
	},
}

var browserCloseCmd = &cobra.Command{
	Use:   "close <id>",
	Short: "Close the current tab",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "close")
		if err != nil {
			return err
		}
		fmt.Println("Tab closed")
		return nil
	},
}

// =============================================================================
// Interaction Commands
// =============================================================================

var browserClickCmd = &cobra.Command{
	Use:   "click <id> <selector>",
	Short: "Click an element",
	Long: `Click an element by ref (@e1) or CSS selector.

Examples:
  cloudrouter browser click cr_abc123 @e1
  cloudrouter browser click cr_abc123 "#submit"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "click", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Clicked: %s\n", args[1])
		return nil
	},
}

var browserDblclickCmd = &cobra.Command{
	Use:   "dblclick <id> <selector>",
	Short: "Double-click an element",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "dblclick", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Double-clicked: %s\n", args[1])
		return nil
	},
}

var browserTypeCmd = &cobra.Command{
	Use:   "type <id> <selector> <text>",
	Short: "Type text into an element",
	Long: `Type text into an element identified by ref or CSS selector.

Examples:
  cloudrouter browser type cr_abc123 @e2 "hello world"
  cloudrouter browser type cr_abc123 "#search" "query"`,
	Args: cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "type", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Println("Typed text")
		return nil
	},
}

var browserFillCmd = &cobra.Command{
	Use:   "fill <id> <selector> <value>",
	Short: "Clear and fill an input field",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "fill", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Filled %s\n", args[1])
		return nil
	},
}

var browserPressCmd = &cobra.Command{
	Use:   "press <id> <key>",
	Short: "Press a key",
	Long: `Press a key. Common keys: Enter, Tab, Escape, Backspace, Space, ArrowUp, ArrowDown, etc.

Examples:
  cloudrouter browser press cr_abc123 Enter
  cloudrouter browser press cr_abc123 Tab`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "press", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Pressed: %s\n", args[1])
		return nil
	},
}

var browserKeydownCmd = &cobra.Command{
	Use:   "keydown <id> <key>",
	Short: "Hold a key down",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "keydown", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Key down: %s\n", args[1])
		return nil
	},
}

var browserKeyupCmd = &cobra.Command{
	Use:   "keyup <id> <key>",
	Short: "Release a key",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "keyup", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Key up: %s\n", args[1])
		return nil
	},
}

var browserHoverCmd = &cobra.Command{
	Use:   "hover <id> <selector>",
	Short: "Hover over an element",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "hover", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Hovering: %s\n", args[1])
		return nil
	},
}

var browserFocusCmd = &cobra.Command{
	Use:   "focus <id> <selector>",
	Short: "Focus an element",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "focus", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Focused: %s\n", args[1])
		return nil
	},
}

var browserSelectCmd = &cobra.Command{
	Use:   "select <id> <selector> <value>",
	Short: "Select a dropdown option",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "select", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Selected: %s\n", args[2])
		return nil
	},
}

var browserCheckCmd = &cobra.Command{
	Use:   "check <id> <selector>",
	Short: "Check a checkbox",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "check", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Checked: %s\n", args[1])
		return nil
	},
}

var browserUncheckCmd = &cobra.Command{
	Use:   "uncheck <id> <selector>",
	Short: "Uncheck a checkbox",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "uncheck", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Unchecked: %s\n", args[1])
		return nil
	},
}

var browserScrollCmd = &cobra.Command{
	Use:   "scroll <id> <direction> [pixels]",
	Short: "Scroll the page",
	Long:  `Scroll the page. Directions: up, down, left, right.`,
	Args:  cobra.RangeArgs(2, 3),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"scroll", args[1]}
		if len(args) > 2 {
			abArgs = append(abArgs, args[2])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Printf("Scrolled %s\n", args[1])
		return nil
	},
}

var browserScrollintoviewCmd = &cobra.Command{
	Use:   "scrollintoview <id> <selector>",
	Short: "Scroll an element into view",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "scrollintoview", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Scrolled into view: %s\n", args[1])
		return nil
	},
}

var browserDragCmd = &cobra.Command{
	Use:   "drag <id> <source> <target>",
	Short: "Drag from one element to another",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "drag", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Dragged %s to %s\n", args[1], args[2])
		return nil
	},
}

var browserUploadCmd = &cobra.Command{
	Use:   "upload <id> <selector> <files>",
	Short: "Upload files to a file input",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "upload", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Uploaded to %s\n", args[1])
		return nil
	},
}

// =============================================================================
// Information Retrieval Commands
// =============================================================================

var browserURLCmd = &cobra.Command{
	Use:   "url <id>",
	Short: "Get current page URL",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "url")
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserTitleCmd = &cobra.Command{
	Use:   "title <id>",
	Short: "Get current page title",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "title")
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetTextCmd = &cobra.Command{
	Use:   "get-text <id> <selector>",
	Short: "Get element text content",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "text", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetHTMLCmd = &cobra.Command{
	Use:   "get-html <id> <selector>",
	Short: "Get element innerHTML",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "html", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetValueCmd = &cobra.Command{
	Use:   "get-value <id> <selector>",
	Short: "Get input value",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "value", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetAttrCmd = &cobra.Command{
	Use:   "get-attr <id> <selector> <attribute>",
	Short: "Get element attribute",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "attr", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetCountCmd = &cobra.Command{
	Use:   "get-count <id> <selector>",
	Short: "Count matching elements",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "count", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserGetBoxCmd = &cobra.Command{
	Use:   "get-box <id> <selector>",
	Short: "Get element bounding box",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "get", "box", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

// =============================================================================
// State Verification Commands
// =============================================================================

var browserIsVisibleCmd = &cobra.Command{
	Use:   "is-visible <id> <selector>",
	Short: "Check if element is visible",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "is", "visible", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserIsEnabledCmd = &cobra.Command{
	Use:   "is-enabled <id> <selector>",
	Short: "Check if element is enabled",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "is", "enabled", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserIsCheckedCmd = &cobra.Command{
	Use:   "is-checked <id> <selector>",
	Short: "Check if element is checked",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "is", "checked", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

// =============================================================================
// Screenshot & Visual Commands
// =============================================================================

var browserScreenshotCmd = &cobra.Command{
	Use:   "screenshot <id> [output-file]",
	Short: "Take a screenshot",
	Long: `Take a screenshot of the current browser state.
If output file is not specified, outputs base64-encoded PNG to stdout.`,
	Args: cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		b64Data, err := execScreenshotCommand(args[0])
		if err != nil {
			return err
		}

		if len(args) > 1 {
			data, err := base64.StdEncoding.DecodeString(b64Data)
			if err != nil {
				return fmt.Errorf("failed to decode screenshot: %w", err)
			}
			if err := os.WriteFile(args[1], data, 0644); err != nil {
				return fmt.Errorf("failed to write file: %w", err)
			}
			fmt.Printf("Screenshot saved to: %s\n", args[1])
		} else {
			fmt.Println(b64Data)
		}
		return nil
	},
}

var browserPDFCmd = &cobra.Command{
	Use:   "pdf <id> [output-file]",
	Short: "Save page as PDF",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		// Generate PDF on remote
		remotePath := "/tmp/page.pdf"
		_, err := execAgentBrowser(args[0], "pdf", remotePath)
		if err != nil {
			return err
		}
		fmt.Printf("PDF saved on remote: %s\n", remotePath)
		return nil
	},
}

var browserHighlightCmd = &cobra.Command{
	Use:   "highlight <id> <selector>",
	Short: "Highlight an element visually",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "highlight", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Highlighted: %s\n", args[1])
		return nil
	},
}

// =============================================================================
// Wait Command
// =============================================================================

var browserWaitCmd = &cobra.Command{
	Use:   "wait <id> <selector-or-ms>",
	Short: "Wait for an element or time",
	Long: `Wait for an element to be visible, or wait a number of milliseconds.

Examples:
  cloudrouter browser wait cr_abc123 @e5
  cloudrouter browser wait cr_abc123 "#content"
  cloudrouter browser wait cr_abc123 2000`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "wait", args[1])
		if err != nil {
			return err
		}
		if out != "" {
			fmt.Println(out)
		} else {
			fmt.Printf("Wait complete: %s\n", args[1])
		}
		return nil
	},
}

// =============================================================================
// JavaScript Evaluation
// =============================================================================

var browserEvalCmd = &cobra.Command{
	Use:   "eval <id> <script>",
	Short: "Evaluate JavaScript in the browser",
	Long: `Execute JavaScript in the browser and return the result.

Examples:
  cloudrouter browser eval cr_abc123 "document.title"
  cloudrouter browser eval cr_abc123 "document.querySelectorAll('a').length"`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "eval", args[1])
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

// =============================================================================
// Mouse Control Commands
// =============================================================================

var browserMouseMoveCmd = &cobra.Command{
	Use:   "mouse-move <id> <x> <y>",
	Short: "Move mouse to coordinates",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "mouse", "move", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Mouse moved to %s, %s\n", args[1], args[2])
		return nil
	},
}

var browserMouseDownCmd = &cobra.Command{
	Use:   "mouse-down <id> [button]",
	Short: "Press mouse button down",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"mouse", "down"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Mouse down")
		return nil
	},
}

var browserMouseUpCmd = &cobra.Command{
	Use:   "mouse-up <id> [button]",
	Short: "Release mouse button",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"mouse", "up"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Mouse up")
		return nil
	},
}

var browserMouseWheelCmd = &cobra.Command{
	Use:   "mouse-wheel <id> <deltaY> [deltaX]",
	Short: "Scroll with mouse wheel",
	Args:  cobra.RangeArgs(2, 3),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"mouse", "wheel", args[1]}
		if len(args) > 2 {
			abArgs = append(abArgs, args[2])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Mouse wheel scrolled")
		return nil
	},
}

// =============================================================================
// Dialog Handling
// =============================================================================

var browserDialogAcceptCmd = &cobra.Command{
	Use:   "dialog-accept <id> [text]",
	Short: "Accept a dialog (alert/confirm/prompt)",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"dialog", "accept"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Dialog accepted")
		return nil
	},
}

var browserDialogDismissCmd = &cobra.Command{
	Use:   "dialog-dismiss <id>",
	Short: "Dismiss a dialog",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "dialog", "dismiss")
		if err != nil {
			return err
		}
		fmt.Println("Dialog dismissed")
		return nil
	},
}

// =============================================================================
// Browser Configuration
// =============================================================================

var browserSetViewportCmd = &cobra.Command{
	Use:   "set-viewport <id> <width> <height>",
	Short: "Set browser viewport size",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "viewport", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Viewport set to %sx%s\n", args[1], args[2])
		return nil
	},
}

var browserSetDeviceCmd = &cobra.Command{
	Use:   "set-device <id> <device-name>",
	Short: "Emulate a device",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "device", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Emulating device: %s\n", args[1])
		return nil
	},
}

var browserSetMediaCmd = &cobra.Command{
	Use:   "set-media <id> <dark|light>",
	Short: "Set color scheme preference",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "media", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Media set to: %s\n", args[1])
		return nil
	},
}

var browserSetGeoCmd = &cobra.Command{
	Use:   "set-geo <id> <latitude> <longitude>",
	Short: "Set geolocation",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "geo", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Geolocation set to %s, %s\n", args[1], args[2])
		return nil
	},
}

var browserSetOfflineCmd = &cobra.Command{
	Use:   "set-offline <id> [on|off]",
	Short: "Toggle offline mode",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"set", "offline"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Offline mode toggled")
		return nil
	},
}

var browserSetHeadersCmd = &cobra.Command{
	Use:   "set-headers <id> <json>",
	Short: "Set custom HTTP headers",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "headers", args[1])
		if err != nil {
			return err
		}
		fmt.Println("Headers set")
		return nil
	},
}

var browserSetCredentialsCmd = &cobra.Command{
	Use:   "set-credentials <id> <username> <password>",
	Short: "Set HTTP authentication credentials",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "set", "credentials", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Println("Credentials set")
		return nil
	},
}

// =============================================================================
// Tab Management
// =============================================================================

var browserTabListCmd = &cobra.Command{
	Use:   "tab-list <id>",
	Short: "List open tabs",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "tab")
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserTabNewCmd = &cobra.Command{
	Use:   "tab-new <id> [url]",
	Short: "Open a new tab",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"tab", "new"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		if out != "" {
			fmt.Println(out)
		} else {
			fmt.Println("New tab opened")
		}
		return nil
	},
}

var browserTabSwitchCmd = &cobra.Command{
	Use:   "tab-switch <id> <index>",
	Short: "Switch to a tab by index",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "tab", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("Switched to tab %s\n", args[1])
		return nil
	},
}

var browserTabCloseCmd = &cobra.Command{
	Use:   "tab-close <id> [index]",
	Short: "Close a tab",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"tab", "close"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Tab closed")
		return nil
	},
}

// =============================================================================
// Frame Management
// =============================================================================

var browserFrameCmd = &cobra.Command{
	Use:   "frame <id> [selector]",
	Short: "Switch to a frame (omit selector to switch to main frame)",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"frame"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		} else {
			abArgs = append(abArgs, "main")
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		if len(args) > 1 {
			fmt.Printf("Switched to frame: %s\n", args[1])
		} else {
			fmt.Println("Switched to main frame")
		}
		return nil
	},
}

// =============================================================================
// Cookies & Storage
// =============================================================================

var browserCookiesCmd = &cobra.Command{
	Use:   "cookies <id>",
	Short: "List cookies",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		out, err := execAgentBrowser(args[0], "cookies")
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserCookiesSetCmd = &cobra.Command{
	Use:   "cookies-set <id> <name> <value>",
	Short: "Set a cookie",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "cookies", "set", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("Cookie set: %s\n", args[1])
		return nil
	},
}

var browserCookiesClearCmd = &cobra.Command{
	Use:   "cookies-clear <id>",
	Short: "Clear all cookies",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "cookies", "clear")
		if err != nil {
			return err
		}
		fmt.Println("Cookies cleared")
		return nil
	},
}

var browserStorageLocalCmd = &cobra.Command{
	Use:   "storage-local <id> [key]",
	Short: "Get localStorage (all or by key)",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"storage", "local"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserStorageLocalSetCmd = &cobra.Command{
	Use:   "storage-local-set <id> <key> <value>",
	Short: "Set localStorage value",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "storage", "local", "set", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("localStorage set: %s\n", args[1])
		return nil
	},
}

var browserStorageLocalClearCmd = &cobra.Command{
	Use:   "storage-local-clear <id>",
	Short: "Clear localStorage",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "storage", "local", "clear")
		if err != nil {
			return err
		}
		fmt.Println("localStorage cleared")
		return nil
	},
}

var browserStorageSessionCmd = &cobra.Command{
	Use:   "storage-session <id> [key]",
	Short: "Get sessionStorage (all or by key)",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"storage", "session"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserStorageSessionSetCmd = &cobra.Command{
	Use:   "storage-session-set <id> <key> <value>",
	Short: "Set sessionStorage value",
	Args:  cobra.ExactArgs(3),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "storage", "session", "set", args[1], args[2])
		if err != nil {
			return err
		}
		fmt.Printf("sessionStorage set: %s\n", args[1])
		return nil
	},
}

var browserStorageSessionClearCmd = &cobra.Command{
	Use:   "storage-session-clear <id>",
	Short: "Clear sessionStorage",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "storage", "session", "clear")
		if err != nil {
			return err
		}
		fmt.Println("sessionStorage cleared")
		return nil
	},
}

// =============================================================================
// Network Control
// =============================================================================

var browserNetworkRequestsCmd = &cobra.Command{
	Use:   "network-requests <id> [--filter pattern]",
	Short: "List network requests",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"network", "requests"}
		if filter, _ := cmd.Flags().GetString("filter"); filter != "" {
			abArgs = append(abArgs, "--filter", filter)
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserNetworkRouteCmd = &cobra.Command{
	Use:   "network-route <id> <url-pattern>",
	Short: "Intercept network requests matching a URL pattern",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"network", "route", args[1]}
		if abort, _ := cmd.Flags().GetBool("abort"); abort {
			abArgs = append(abArgs, "--abort")
		}
		if body, _ := cmd.Flags().GetString("body"); body != "" {
			abArgs = append(abArgs, "--body", body)
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Printf("Route set for: %s\n", args[1])
		return nil
	},
}

var browserNetworkUnrouteCmd = &cobra.Command{
	Use:   "network-unroute <id> [url-pattern]",
	Short: "Remove network route",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"network", "unroute"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Route removed")
		return nil
	},
}

// =============================================================================
// Debugging
// =============================================================================

var browserConsoleCmd = &cobra.Command{
	Use:   "console <id>",
	Short: "Get console log output",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"console"}
		if clear, _ := cmd.Flags().GetBool("clear"); clear {
			abArgs = append(abArgs, "--clear")
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserErrorsCmd = &cobra.Command{
	Use:   "errors <id>",
	Short: "Get JavaScript errors",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"errors"}
		if clear, _ := cmd.Flags().GetBool("clear"); clear {
			abArgs = append(abArgs, "--clear")
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println(out)
		return nil
	},
}

var browserTraceStartCmd = &cobra.Command{
	Use:   "trace-start <id> [path]",
	Short: "Start tracing",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"trace", "start"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		_, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		fmt.Println("Trace started")
		return nil
	},
}

var browserTraceStopCmd = &cobra.Command{
	Use:   "trace-stop <id> [path]",
	Short: "Stop tracing",
	Args:  cobra.RangeArgs(1, 2),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"trace", "stop"}
		if len(args) > 1 {
			abArgs = append(abArgs, args[1])
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		if out != "" {
			fmt.Println(out)
		} else {
			fmt.Println("Trace stopped")
		}
		return nil
	},
}

// =============================================================================
// State Management
// =============================================================================

var browserStateSaveCmd = &cobra.Command{
	Use:   "state-save <id> <path>",
	Short: "Save browser state (cookies, localStorage, etc.)",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "state", "save", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("State saved to: %s\n", args[1])
		return nil
	},
}

var browserStateLoadCmd = &cobra.Command{
	Use:   "state-load <id> <path>",
	Short: "Load browser state",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		_, err := execAgentBrowser(args[0], "state", "load", args[1])
		if err != nil {
			return err
		}
		fmt.Printf("State loaded from: %s\n", args[1])
		return nil
	},
}

// =============================================================================
// Semantic Locators (find)
// =============================================================================

var browserFindCmd = &cobra.Command{
	Use:   "find <id> <locator-type> <locator-value> <action> [action-value]",
	Short: "Find element by semantic locator and perform action",
	Long: `Find an element using semantic locators (role, text, label, placeholder, alt, title, testid)
and perform an action on it.

Examples:
  cloudrouter browser find cr_abc123 role button click
  cloudrouter browser find cr_abc123 text "Submit" click
  cloudrouter browser find cr_abc123 label "Email" fill "user@example.com"
  cloudrouter browser find cr_abc123 placeholder "Search..." type "query"`,
	Args: cobra.RangeArgs(4, 5),
	RunE: func(cmd *cobra.Command, args []string) error {
		abArgs := []string{"find", args[1], args[2], args[3]}
		if len(args) > 4 {
			abArgs = append(abArgs, args[4])
		}
		out, err := execAgentBrowser(args[0], abArgs...)
		if err != nil {
			return err
		}
		if out != "" {
			fmt.Println(out)
		}
		return nil
	},
}

// =============================================================================
// Register all subcommands
// =============================================================================

func init() {
	// Flags
	browserSnapshotCmd.Flags().BoolP("interactive", "i", false, "Show only interactive elements")
	browserSnapshotCmd.Flags().BoolP("compact", "c", false, "Compact output")
	browserScreenshotCmd.Flags().Bool("full", false, "Full page screenshot")
	browserNetworkRequestsCmd.Flags().String("filter", "", "Filter pattern")
	browserNetworkRouteCmd.Flags().Bool("abort", false, "Abort matching requests")
	browserNetworkRouteCmd.Flags().String("body", "", "Response body for mocked requests")
	browserConsoleCmd.Flags().Bool("clear", false, "Clear console after reading")
	browserErrorsCmd.Flags().Bool("clear", false, "Clear errors after reading")

	// Allow negative numbers as positional args (e.g., longitude -122.4194)
	browserSetGeoCmd.Flags().SetInterspersed(false)

	// Navigation
	browserCmd.AddCommand(browserSnapshotCmd)
	browserCmd.AddCommand(browserOpenCmd)
	browserCmd.AddCommand(browserBackCmd)
	browserCmd.AddCommand(browserForwardCmd)
	browserCmd.AddCommand(browserReloadCmd)
	browserCmd.AddCommand(browserCloseCmd)

	// Interaction
	browserCmd.AddCommand(browserClickCmd)
	browserCmd.AddCommand(browserDblclickCmd)
	browserCmd.AddCommand(browserTypeCmd)
	browserCmd.AddCommand(browserFillCmd)
	browserCmd.AddCommand(browserPressCmd)
	browserCmd.AddCommand(browserKeydownCmd)
	browserCmd.AddCommand(browserKeyupCmd)
	browserCmd.AddCommand(browserHoverCmd)
	browserCmd.AddCommand(browserFocusCmd)
	browserCmd.AddCommand(browserSelectCmd)
	browserCmd.AddCommand(browserCheckCmd)
	browserCmd.AddCommand(browserUncheckCmd)
	browserCmd.AddCommand(browserScrollCmd)
	browserCmd.AddCommand(browserScrollintoviewCmd)
	browserCmd.AddCommand(browserDragCmd)
	browserCmd.AddCommand(browserUploadCmd)

	// Information retrieval
	browserCmd.AddCommand(browserURLCmd)
	browserCmd.AddCommand(browserTitleCmd)
	browserCmd.AddCommand(browserGetTextCmd)
	browserCmd.AddCommand(browserGetHTMLCmd)
	browserCmd.AddCommand(browserGetValueCmd)
	browserCmd.AddCommand(browserGetAttrCmd)
	browserCmd.AddCommand(browserGetCountCmd)
	browserCmd.AddCommand(browserGetBoxCmd)

	// State verification
	browserCmd.AddCommand(browserIsVisibleCmd)
	browserCmd.AddCommand(browserIsEnabledCmd)
	browserCmd.AddCommand(browserIsCheckedCmd)

	// Screenshot & visual
	browserCmd.AddCommand(browserScreenshotCmd)
	browserCmd.AddCommand(browserPDFCmd)
	browserCmd.AddCommand(browserHighlightCmd)

	// Wait
	browserCmd.AddCommand(browserWaitCmd)

	// JavaScript
	browserCmd.AddCommand(browserEvalCmd)

	// Mouse control
	browserCmd.AddCommand(browserMouseMoveCmd)
	browserCmd.AddCommand(browserMouseDownCmd)
	browserCmd.AddCommand(browserMouseUpCmd)
	browserCmd.AddCommand(browserMouseWheelCmd)

	// Dialog handling
	browserCmd.AddCommand(browserDialogAcceptCmd)
	browserCmd.AddCommand(browserDialogDismissCmd)

	// Browser configuration
	browserCmd.AddCommand(browserSetViewportCmd)
	browserCmd.AddCommand(browserSetDeviceCmd)
	browserCmd.AddCommand(browserSetMediaCmd)
	browserCmd.AddCommand(browserSetGeoCmd)
	browserCmd.AddCommand(browserSetOfflineCmd)
	browserCmd.AddCommand(browserSetHeadersCmd)
	browserCmd.AddCommand(browserSetCredentialsCmd)

	// Tab management
	browserCmd.AddCommand(browserTabListCmd)
	browserCmd.AddCommand(browserTabNewCmd)
	browserCmd.AddCommand(browserTabSwitchCmd)
	browserCmd.AddCommand(browserTabCloseCmd)

	// Frame management
	browserCmd.AddCommand(browserFrameCmd)

	// Cookies & storage
	browserCmd.AddCommand(browserCookiesCmd)
	browserCmd.AddCommand(browserCookiesSetCmd)
	browserCmd.AddCommand(browserCookiesClearCmd)
	browserCmd.AddCommand(browserStorageLocalCmd)
	browserCmd.AddCommand(browserStorageLocalSetCmd)
	browserCmd.AddCommand(browserStorageLocalClearCmd)
	browserCmd.AddCommand(browserStorageSessionCmd)
	browserCmd.AddCommand(browserStorageSessionSetCmd)
	browserCmd.AddCommand(browserStorageSessionClearCmd)

	// Network control
	browserCmd.AddCommand(browserNetworkRequestsCmd)
	browserCmd.AddCommand(browserNetworkRouteCmd)
	browserCmd.AddCommand(browserNetworkUnrouteCmd)

	// Debugging
	browserCmd.AddCommand(browserConsoleCmd)
	browserCmd.AddCommand(browserErrorsCmd)
	browserCmd.AddCommand(browserTraceStartCmd)
	browserCmd.AddCommand(browserTraceStopCmd)

	// State management
	browserCmd.AddCommand(browserStateSaveCmd)
	browserCmd.AddCommand(browserStateLoadCmd)

	// Semantic locators
	browserCmd.AddCommand(browserFindCmd)
}
