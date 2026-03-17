package cli

import (
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
)

var sshProxyCmd = &cobra.Command{
	Use:    "__ssh-proxy",
	Short:  "Internal: WebSocket-to-stdio SSH proxy",
	Hidden: true,
	Args:   cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		wsURL := args[0]
		return runSSHProxy(wsURL)
	},
}

func init() {
	rootCmd.AddCommand(sshProxyCmd)
}

// runSSHProxy bridges stdin/stdout to a WebSocket connection.
// This is used as an SSH ProxyCommand to tunnel SSH over WebSocket
// without depending on external tools like curl.
func runSSHProxy(wsURL string) error {
	dialer := websocket.Dialer{
		HandshakeTimeout:  30 * time.Second,
		EnableCompression: false,
	}

	wsConn, _, err := dialer.Dial(wsURL, http.Header{})
	if err != nil {
		return fmt.Errorf("WebSocket connect failed: %w", err)
	}
	defer wsConn.Close()

	var wg sync.WaitGroup
	done := make(chan struct{})

	// stdin -> WebSocket
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := os.Stdin.Read(buf)
			if n > 0 {
				if writeErr := wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]); writeErr != nil {
					return
				}
			}
			if err != nil {
				wsConn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
		}
	}()

	// WebSocket -> stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(done)
		for {
			messageType, data, err := wsConn.ReadMessage()
			if err != nil {
				return
			}
			if messageType == websocket.BinaryMessage || messageType == websocket.TextMessage {
				if _, writeErr := os.Stdout.Write(data); writeErr != nil {
					return
				}
			}
		}
	}()

	// Wait for WebSocket read side to finish (connection closed)
	<-done
	// Also wait briefly for stdin side to clean up
	stdinDone := make(chan struct{})
	go func() {
		wg.Wait()
		close(stdinDone)
	}()
	select {
	case <-stdinDone:
	case <-time.After(2 * time.Second):
	}

	return nil
}

// getSelfPath returns the path to the currently running executable.
// Used to construct ProxyCommand for SSH tunneling via __ssh-proxy.
func getSelfPath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to determine executable path: %w", err)
	}
	return exe, nil
}
