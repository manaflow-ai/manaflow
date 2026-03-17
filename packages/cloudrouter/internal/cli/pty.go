// internal/cli/pty.go
package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

var ptyCmd = &cobra.Command{
	Use:   "pty <id>",
	Short: "Open a terminal session in the sandbox",
	Long: `Open an interactive terminal session in a sandbox.

This provides a terminal experience via WebSocket.

Examples:
  cloudrouter pty cr_abc123`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]

		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		token, err := client.GetAuthToken(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		// Build WebSocket URL
		wsURL, err := buildPtyWebSocketURL(inst.WorkerURL, token)
		if err != nil {
			return fmt.Errorf("failed to build WebSocket URL: %w", err)
		}

		return runPtySession(wsURL)
	},
}

func buildPtyWebSocketURL(workerURL, token string) (string, error) {
	parsed, err := url.Parse(workerURL)
	if err != nil {
		return "", fmt.Errorf("invalid worker URL: %w", err)
	}

	// Change scheme to WebSocket
	if parsed.Scheme == "https" {
		parsed.Scheme = "wss"
	} else {
		parsed.Scheme = "ws"
	}

	// Build path
	parsed.Path = "/pty"

	// Add query parameters
	query := parsed.Query()
	query.Set("token", token)
	// Get terminal size
	width, height, _ := term.GetSize(int(os.Stdin.Fd()))
	if width > 0 {
		query.Set("cols", fmt.Sprintf("%d", width))
	}
	if height > 0 {
		query.Set("rows", fmt.Sprintf("%d", height))
	}
	parsed.RawQuery = query.Encode()

	return parsed.String(), nil
}

func runPtySession(wsURL string) error {
	// Connect to WebSocket
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, resp, err := dialer.Dial(wsURL, nil)
	if err != nil {
		if resp != nil {
			body, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to connect: %w (status: %d, body: %s)", err, resp.StatusCode, string(body))
		}
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Put terminal in raw mode
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return fmt.Errorf("failed to set raw mode: %w", err)
	}
	defer term.Restore(int(os.Stdin.Fd()), oldState)

	// Handle terminal resize (Unix only, no-op on Windows)
	sigCh := make(chan os.Signal, 1)
	setupResizeHandler(sigCh)
	go func() {
		for range sigCh {
			width, height, err := term.GetSize(int(os.Stdin.Fd()))
			if err == nil {
				msg, _ := json.Marshal(map[string]interface{}{
					"type": "resize",
					"cols": width,
					"rows": height,
				})
				conn.WriteMessage(websocket.TextMessage, msg)
			}
		}
	}()
	defer signal.Stop(sigCh)

	// Handle Ctrl+C gracefully
	interruptCh := make(chan os.Signal, 1)
	signal.Notify(interruptCh, os.Interrupt)
	go func() {
		<-interruptCh
		conn.Close()
	}()
	defer signal.Stop(interruptCh)

	// Read from WebSocket and write to stdout
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var msg struct {
				Type     string `json:"type"`
				Data     string `json:"data"`
				ExitCode int    `json:"exitCode"`
				Code     int    `json:"code"`
			}
			if err := json.Unmarshal(message, &msg); err != nil {
				// Not JSON, treat as raw output
				os.Stdout.Write(message)
				continue
			}

			switch msg.Type {
			case "data":
				os.Stdout.Write([]byte(msg.Data))
			case "output":
				os.Stdout.Write([]byte(msg.Data))
			case "session":
				// Session connected, ready to use
			case "exit":
				exitCode := msg.ExitCode
				if exitCode == 0 {
					exitCode = msg.Code
				}
				fmt.Printf("\r\nSession exited with code %d\r\n", exitCode)
				return
			case "pong":
				// Keepalive response
			}
		}
	}()

	// Read from stdin and write to WebSocket
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				return
			}
			msg, _ := json.Marshal(map[string]interface{}{
				"type": "data",
				"data": string(buf[:n]),
			})
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	<-done
	return nil
}

var ptyListCmd = &cobra.Command{
	Use:   "pty-list <id>",
	Short: "List PTY sessions in a sandbox",
	Long: `List all active PTY sessions in a sandbox.

Output can be piped to other tools like rg for filtering.

Examples:
  cloudrouter pty-list cr_abc123
  cloudrouter pty-list cr_abc123 | rg bash
  cloudrouter pty-list cr_abc123 --json`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		sandboxID := args[0]

		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		inst, err := client.GetInstance(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("sandbox not found: %w", err)
		}

		if inst.WorkerURL == "" {
			return fmt.Errorf("worker URL not available")
		}

		token, err := client.GetAuthToken(teamSlug, sandboxID)
		if err != nil {
			return fmt.Errorf("failed to get auth token: %w", err)
		}

		// Call the /pty-sessions endpoint
		sessionsURL := strings.TrimRight(inst.WorkerURL, "/") + "/pty-sessions"
		req, err := http.NewRequest("GET", sessionsURL, nil)
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+token)

		httpClient := &http.Client{Timeout: 30 * time.Second}
		resp, err := httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("failed to list sessions: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("failed to list sessions: %s", string(body))
		}

		var result struct {
			Success  bool `json:"success"`
			Sessions []struct {
				ID        string `json:"id"`
				CreatedAt int64  `json:"createdAt"`
				Shell     string `json:"shell"`
				Cwd       string `json:"cwd"`
				Connected bool   `json:"connected"`
			} `json:"sessions"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return fmt.Errorf("failed to decode response: %w", err)
		}

		if len(result.Sessions) == 0 {
			fmt.Println("No active PTY sessions")
			return nil
		}

		fmt.Printf("%-18s %-12s %-25s %-10s %s\n", "SESSION ID", "SHELL", "CWD", "CONNECTED", "CREATED")
		fmt.Println(strings.Repeat("-", 90))
		for _, s := range result.Sessions {
			created := time.UnixMilli(s.CreatedAt).Format(time.RFC3339)
			shell := s.Shell
			if len(shell) > 10 {
				shell = "..." + shell[len(shell)-7:]
			}
			cwd := s.Cwd
			if len(cwd) > 23 {
				cwd = "..." + cwd[len(cwd)-20:]
			}
			connStatus := "no"
			if s.Connected {
				connStatus = "yes"
			}
			fmt.Printf("%-18s %-12s %-25s %-10s %s\n", s.ID, shell, cwd, connStatus, created)
		}

		return nil
	},
}

func init() {
	// No flags needed for pty
}
