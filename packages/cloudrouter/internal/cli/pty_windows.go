//go:build windows

package cli

import (
	"os"
)

// setupResizeHandler is a no-op on Windows (no SIGWINCH support)
func setupResizeHandler(_ chan os.Signal) {
	// Windows doesn't have SIGWINCH, so we don't set up any signal handler.
	// Terminal resize events would need to be handled differently on Windows.
}
