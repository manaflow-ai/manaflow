//go:build !windows

package cli

import (
	"os"
	"os/signal"
	"syscall"
)

// setupResizeHandler sets up terminal resize signal handling on Unix
func setupResizeHandler(sigCh chan os.Signal) {
	signal.Notify(sigCh, syscall.SIGWINCH)
}
