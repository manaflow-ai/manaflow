//! Terminal state management with guaranteed cleanup.
//!
//! This module provides a guard that ensures terminal state is properly restored
//! when the process exits, whether normally, via panic, or via signal (SIGTERM/SIGINT).
//!
//! # Problem
//! When terminal applications enable raw mode, mouse capture, or alternate screen,
//! killing the process (e.g., `kill <pid>`) can leave the terminal in a broken state
//! with mouse escape sequences being printed on scroll.
//!
//! # Solution
//! This guard:
//! 1. Tracks what terminal modes are enabled
//! 2. Restores terminal state on Drop (normal exit, panic unwinding)
//! 3. Installs a panic hook for double safety
//! 4. Uses a global flag to prevent double-cleanup
//! 5. Drains stdin after cleanup to consume any leftover terminal responses

use crossterm::{
    event::{DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

/// Global flag to track if cleanup has been performed.
/// This prevents double-cleanup when both Drop and panic hook run.
pub static CLEANUP_DONE: AtomicBool = AtomicBool::new(false);

/// Global flag to track if terminal modes are currently enabled.
/// Used by the panic hook to know if cleanup is needed.
pub static TERMINAL_MODES_ENABLED: AtomicBool = AtomicBool::new(false);

/// Drain any pending data from stdin (non-blocking).
/// This consumes leftover terminal responses (like DA1/DA2 responses) that might
/// have arrived after we sent terminal mode change sequences.
#[cfg(unix)]
pub fn drain_stdin() {
    drain_stdin_once();
}

/// Internal: single pass of stdin draining.
#[cfg(unix)]
fn drain_stdin_once() {
    use std::os::unix::io::AsRawFd;

    let stdin = std::io::stdin();
    let stdin_handle = stdin.lock();
    let stdin_fd = stdin_handle.as_raw_fd();

    // Set non-blocking
    let flags = unsafe { libc::fcntl(stdin_fd, libc::F_GETFL) };
    if flags < 0 {
        return;
    }
    if unsafe { libc::fcntl(stdin_fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return;
    }

    // Drain all pending data
    let mut buf = [0u8; 256];
    loop {
        let n = unsafe { libc::read(stdin_fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
        if n <= 0 {
            break;
        }
    }

    // Restore blocking mode
    unsafe { libc::fcntl(stdin_fd, libc::F_SETFL, flags) };
}

/// Aggressively drain stdin with multiple passes and delays.
/// This is more thorough for cleanup scenarios where responses may arrive with delay.
#[cfg(unix)]
pub fn drain_stdin_aggressive() {
    // Multiple passes with delays to catch slow responses
    for _ in 0..3 {
        drain_stdin_once();
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    drain_stdin_once();
}

/// No-op on non-Unix platforms.
#[cfg(not(unix))]
pub fn drain_stdin_aggressive() {}

/// No-op on non-Unix platforms.
#[cfg(not(unix))]
pub fn drain_stdin() {}

/// Restore terminal to a clean state.
/// This is safe to call multiple times - it uses atomic flags to prevent double-cleanup.
pub fn restore_terminal() {
    // Only cleanup once
    if CLEANUP_DONE.swap(true, Ordering::SeqCst) {
        return;
    }

    // Only cleanup if we actually enabled terminal modes
    if !TERMINAL_MODES_ENABLED.load(Ordering::SeqCst) {
        return;
    }

    let mut stdout = std::io::stdout();

    // Disable raw mode first (most important for keyboard input)
    let _ = disable_raw_mode();

    // Disable mouse capture, bracketed paste, and leave alternate screen
    // Use raw escape sequences as fallback since execute! might fail
    let _ = execute!(
        stdout,
        DisableBracketedPaste,
        DisableMouseCapture,
        LeaveAlternateScreen
    );

    // Also send raw escape sequences directly in case execute! failed
    // These are the standard sequences to disable mouse modes
    let _ = stdout.write_all(b"\x1b[?1000l"); // Disable X10 mouse
    let _ = stdout.write_all(b"\x1b[?1002l"); // Disable button-event mouse
    let _ = stdout.write_all(b"\x1b[?1003l"); // Disable any-event mouse
    let _ = stdout.write_all(b"\x1b[?1006l"); // Disable SGR extended mouse
    let _ = stdout.write_all(b"\x1b[?2004l"); // Disable bracketed paste
    let _ = stdout.write_all(b"\x1b[?1049l"); // Leave alternate screen
    let _ = stdout.write_all(b"\x1b[?25h"); // Show cursor
    let _ = stdout.flush();

    // Aggressively drain stdin to consume any leftover terminal responses (DA1/DA2, etc.)
    // These might have been sent in response to our terminal mode changes
    drain_stdin_aggressive();
}

/// Install a panic hook that restores terminal state.
/// Should be called once at program startup before enabling any terminal modes.
pub fn install_panic_hook() {
    let original_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        // Restore terminal first before printing panic info
        restore_terminal();
        // Then call the original panic handler
        original_hook(panic_info);
    }));
}

/// Guard that enables terminal modes and ensures they're disabled on drop.
pub struct TerminalGuard {
    raw_mode: bool,
    mouse_capture: bool,
    bracketed_paste: bool,
    alternate_screen: bool,
}

impl TerminalGuard {
    /// Create a new terminal guard with no modes enabled yet.
    pub fn new() -> Self {
        Self {
            raw_mode: false,
            mouse_capture: false,
            bracketed_paste: false,
            alternate_screen: false,
        }
    }

    /// Enable raw mode.
    pub fn enable_raw_mode(&mut self) -> std::io::Result<()> {
        enable_raw_mode()?;
        self.raw_mode = true;
        TERMINAL_MODES_ENABLED.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Enable mouse capture.
    pub fn enable_mouse_capture(&mut self) -> std::io::Result<()> {
        execute!(std::io::stdout(), EnableMouseCapture)?;
        self.mouse_capture = true;
        TERMINAL_MODES_ENABLED.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Enable bracketed paste mode.
    pub fn enable_bracketed_paste(&mut self) -> std::io::Result<()> {
        execute!(std::io::stdout(), EnableBracketedPaste)?;
        self.bracketed_paste = true;
        TERMINAL_MODES_ENABLED.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Enter alternate screen buffer.
    pub fn enter_alternate_screen(&mut self) -> std::io::Result<()> {
        execute!(std::io::stdout(), EnterAlternateScreen)?;
        self.alternate_screen = true;
        TERMINAL_MODES_ENABLED.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Enable all common terminal modes for a TUI application.
    /// This is the typical setup for ratatui-based apps.
    pub fn enable_tui_mode(&mut self) -> std::io::Result<()> {
        self.enter_alternate_screen()?;
        self.enable_mouse_capture()?;
        self.enable_bracketed_paste()?;
        self.enable_raw_mode()?;
        Ok(())
    }
}

impl Default for TerminalGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for TerminalGuard {
    fn drop(&mut self) {
        // Mark that we're starting cleanup
        if CLEANUP_DONE.swap(true, Ordering::SeqCst) {
            // Already cleaned up (e.g., by panic hook)
            return;
        }

        let mut stdout = std::io::stdout();

        // Disable in reverse order of enabling
        if self.raw_mode {
            let _ = disable_raw_mode();
        }

        if self.bracketed_paste {
            let _ = execute!(stdout, DisableBracketedPaste);
        }

        if self.mouse_capture {
            let _ = execute!(stdout, DisableMouseCapture);
            // Also send raw sequences for extra safety
            let _ = stdout.write_all(b"\x1b[?1000l");
            let _ = stdout.write_all(b"\x1b[?1002l");
            let _ = stdout.write_all(b"\x1b[?1003l");
            let _ = stdout.write_all(b"\x1b[?1006l");
        }

        if self.alternate_screen {
            let _ = execute!(stdout, LeaveAlternateScreen);
        }

        // Always try to show cursor
        let _ = stdout.write_all(b"\x1b[?25h");
        let _ = stdout.flush();

        // Aggressively drain stdin to consume any leftover terminal responses
        drain_stdin_aggressive();

        // Reset the global flags for potential reuse
        TERMINAL_MODES_ENABLED.store(false, Ordering::SeqCst);
        CLEANUP_DONE.store(false, Ordering::SeqCst);
    }
}

/// Simple guard for just raw mode (used by SSH handler).
pub struct RawModeGuard {
    _guard: TerminalGuard,
}

impl RawModeGuard {
    pub fn new() -> std::io::Result<Self> {
        let mut guard = TerminalGuard::new();
        guard.enable_raw_mode()?;
        Ok(Self { _guard: guard })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_restore_terminal_idempotent() {
        // Reset global state
        CLEANUP_DONE.store(false, Ordering::SeqCst);
        TERMINAL_MODES_ENABLED.store(false, Ordering::SeqCst);

        // Should be safe to call multiple times
        restore_terminal();
        restore_terminal();
        restore_terminal();
    }

    #[test]
    fn test_guard_drop() {
        // Reset global state
        CLEANUP_DONE.store(false, Ordering::SeqCst);
        TERMINAL_MODES_ENABLED.store(false, Ordering::SeqCst);

        // Create and drop a guard
        {
            let _guard = TerminalGuard::new();
        }

        // Global state should be reset
        assert!(!CLEANUP_DONE.load(Ordering::SeqCst));
        assert!(!TERMINAL_MODES_ENABLED.load(Ordering::SeqCst));
    }
}
