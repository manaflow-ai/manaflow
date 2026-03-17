// internal/cli/pty.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
	"github.com/cmux-cli/cmux-devbox/internal/vm"
	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

var ptyCmd = &cobra.Command{
	Use:   "pty <id>",
	Short: "Open a terminal session in the VM",
	Long: `Open an interactive terminal session in a VM.

This provides a tmux-like terminal experience with persistent sessions.

Examples:
  cmux pty cmux_abc123              # Open new terminal session
  cmux pty cmux_abc123 --session=pty_xyz  # Attach to existing session`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		instanceID := args[0]
		sessionID, _ := cmd.Flags().GetString("session")

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

		// Generate auth token for WebSocket connection
		token, err := getAuthToken(ctx, client, instanceID)
		if err != nil {
			return fmt.Errorf("failed to generate auth token: %w", err)
		}

		// Build WebSocket URL
		wsURL, err := buildPtyWebSocketURL(instance.WorkerURL, sessionID, token)
		if err != nil {
			return fmt.Errorf("failed to build WebSocket URL: %w", err)
		}

		return runPtySession(wsURL)
	},
}

var ptyListCmd = &cobra.Command{
	Use:   "pty-list <id>",
	Short: "List PTY sessions in a VM",
	Long: `List all active PTY sessions in a VM.

Examples:
  cmux pty-list cmux_abc123`,
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

		sessions, err := client.ListPtySessions(ctx, instanceID)
		if err != nil {
			return fmt.Errorf("failed to list PTY sessions: %w", err)
		}

		if len(sessions) == 0 {
			fmt.Println("No active PTY sessions")
			return nil
		}

		fmt.Printf("%-20s %-10s %s\n", "SESSION ID", "CLIENTS", "CREATED")
		fmt.Println("-------------------- ---------- -------------------------")
		for _, s := range sessions {
			created := time.Unix(s.CreatedAt/1000, 0).Format(time.RFC3339)
			fmt.Printf("%-20s %-10d %s\n", s.ID, s.ClientCount, created)
		}

		return nil
	},
}

func buildPtyWebSocketURL(workerURL, sessionID, token string) (string, error) {
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
	if sessionID == "" {
		sessionID = "new"
	}
	parsed.Path = "/_cmux/pty/ws/" + sessionID

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
			}
			if err := json.Unmarshal(message, &msg); err != nil {
				// Not JSON, treat as raw output
				os.Stdout.Write(message)
				continue
			}

			switch msg.Type {
			case "output":
				os.Stdout.Write([]byte(msg.Data))
			case "connected":
				// Session connected, ready to use
			case "exit":
				fmt.Printf("\r\nSession exited with code %d\r\n", msg.ExitCode)
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
				"type": "input",
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

func init() {
	ptyCmd.Flags().String("session", "", "Attach to existing PTY session ID")
	rootCmd.AddCommand(ptyCmd)
	rootCmd.AddCommand(ptyListCmd)
}
