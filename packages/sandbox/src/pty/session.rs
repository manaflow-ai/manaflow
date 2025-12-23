//! PTY Session implementation
//!
//! Handles individual PTY sessions including:
//! - Process spawning (with nsenter for sandbox sessions)
//! - Input/output handling
//! - Scrollback buffer management

use super::types::PtyInfo;
use anyhow::{Context, Result};
use parking_lot::{Mutex, RwLock};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write as IoWrite};
use std::sync::mpsc::SyncSender;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::broadcast;
use tracing::{error, info, warn};

const MAX_SCROLLBACK: usize = 100_000;
const PTY_WRITE_CHUNK_SIZE: usize = 512;
pub const PTY_INPUT_CHANNEL_SIZE: usize = 1024;
pub const PTY_READ_BUFFER_SIZE: usize = 4096;

/// Inner PTY state that requires mutex protection
struct PtySessionInner {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

/// A PTY session with its associated process and I/O channels
pub struct PtySession {
    /// Unique session ID
    pub id: String,
    /// PTY master and child process
    inner: Mutex<PtySessionInner>,
    /// Shell command
    pub shell: String,
    /// Working directory
    pub cwd: String,
    /// Display name
    name: RwLock<String>,
    /// Display index
    index: RwLock<usize>,
    /// Creation timestamp
    pub created_at: f64,
    /// Terminal columns
    cols: RwLock<u16>,
    /// Terminal rows
    rows: RwLock<u16>,
    /// Scrollback buffer
    scrollback: RwLock<String>,
    /// Broadcast channel for output
    pub output_tx: broadcast::Sender<String>,
    /// Input channel (bounded for backpressure)
    input_tx: SyncSender<Vec<u8>>,
    /// Process ID
    pub pid: u32,
    /// Sandbox ID (if running inside a sandbox)
    pub sandbox_id: Option<String>,
    /// Custom metadata
    metadata: RwLock<Option<serde_json::Value>>,
}

impl PtySession {
    /// Create a new PTY session
    ///
    /// If `sandbox_pid` is provided, the shell will be spawned inside the sandbox
    /// using nsenter to enter its namespaces.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: String,
        name: String,
        index: usize,
        shell: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        env: Option<&std::collections::HashMap<String, String>>,
        sandbox_id: Option<String>,
        sandbox_pid: Option<u32>,
        metadata: Option<serde_json::Value>,
    ) -> Result<(Self, Box<dyn Read + Send>)> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY")?;

        // Build the command - use nsenter if we have a sandbox PID
        let mut cmd = if let Some(target_pid) = sandbox_pid {
            // Use nsenter to enter the sandbox's namespaces
            let mut cmd = CommandBuilder::new("nsenter");
            cmd.args([
                "--target",
                &target_pid.to_string(),
                "--mount",  // Enter mount namespace (filesystem isolation)
                "--net",    // Enter network namespace (unique IP)
                "--pid",    // Enter PID namespace
                "--cgroup", // Enter cgroup namespace
                "--",
                shell,
            ]);
            cmd
        } else {
            // Run directly in host namespace
            CommandBuilder::new(shell)
        };

        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("SHELL", shell);

        if let Some(env_vars) = env {
            for (key, value) in env_vars {
                cmd.env(key, value);
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command")?;
        let pid = child.process_id().unwrap_or(0);

        let reader = pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("Failed to take PTY writer")?;

        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        let (output_tx, _) = broadcast::channel(1024);
        let (input_tx, input_rx) = std::sync::mpsc::sync_channel(PTY_INPUT_CHANNEL_SIZE);

        // Spawn dedicated writer thread
        spawn_pty_writer_thread(id.clone(), writer, input_rx);

        let session = Self {
            id,
            inner: Mutex::new(PtySessionInner {
                master: pair.master,
                child,
            }),
            shell: shell.to_string(),
            cwd: cwd.to_string(),
            name: RwLock::new(name),
            index: RwLock::new(index),
            created_at,
            cols: RwLock::new(cols),
            rows: RwLock::new(rows),
            scrollback: RwLock::new(String::new()),
            output_tx,
            input_tx,
            pid,
            sandbox_id,
            metadata: RwLock::new(metadata),
        };

        Ok((session, reader))
    }

    /// Get session info for API responses
    pub fn to_info(&self) -> PtyInfo {
        let alive = {
            let mut inner = self.inner.lock();
            inner.child.try_wait().ok().flatten().is_none()
        };

        PtyInfo {
            id: self.id.clone(),
            name: self.name.read().clone(),
            index: *self.index.read(),
            shell: self.shell.clone(),
            cwd: self.cwd.clone(),
            cols: *self.cols.read(),
            rows: *self.rows.read(),
            created_at: self.created_at,
            alive,
            pid: self.pid,
            sandbox_id: self.sandbox_id.clone(),
            metadata: self.metadata.read().clone(),
        }
    }

    /// Check if the PTY process is still running
    pub fn is_alive(&self) -> bool {
        let mut inner = self.inner.lock();
        inner.child.try_wait().ok().flatten().is_none()
    }

    /// Send input to the PTY
    pub fn write_input(&self, data: &str) -> Result<()> {
        let len = data.len();
        if len > 100 {
            info!("[session:{}] Queueing large input: {} bytes", self.id, len);
        }
        self.input_tx.send(data.as_bytes().to_vec()).map_err(|e| {
            error!("[session:{}] Input channel send failed: {}", self.id, e);
            anyhow::anyhow!("PTY input channel closed")
        })?;
        Ok(())
    }

    /// Resize the PTY
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        *self.cols.write() = cols;
        *self.rows.write() = rows;
        let inner = self.inner.lock();
        inner
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to resize PTY")?;
        Ok(())
    }

    /// Kill the PTY process
    pub fn kill(&self) {
        let mut inner = self.inner.lock();
        if let Err(e) = inner.child.kill() {
            warn!("Failed to kill PTY process: {}", e);
        }
    }

    /// Append data to the scrollback buffer
    pub fn append_scrollback(&self, data: &str) {
        let mut scrollback = self.scrollback.write();
        scrollback.push_str(data);
        if scrollback.len() > MAX_SCROLLBACK {
            let mut start = scrollback.len() - MAX_SCROLLBACK;
            // Find valid UTF-8 boundary
            while start < scrollback.len() && !scrollback.is_char_boundary(start) {
                start += 1;
            }
            *scrollback = scrollback[start..].to_string();
        }
    }

    /// Get the scrollback buffer content
    pub fn get_scrollback(&self) -> String {
        self.scrollback.read().clone()
    }

    /// Set the session name
    pub fn set_name(&self, name: String) {
        *self.name.write() = name;
    }

    /// Get the session name
    pub fn get_name(&self) -> String {
        self.name.read().clone()
    }

    /// Set the display index
    pub fn set_index(&self, index: usize) {
        *self.index.write() = index;
    }

    /// Get the display index
    pub fn get_index(&self) -> usize {
        *self.index.read()
    }

    /// Set metadata
    pub fn set_metadata(&self, metadata: Option<serde_json::Value>) {
        *self.metadata.write() = metadata;
    }

    /// Get metadata
    pub fn get_metadata(&self) -> Option<serde_json::Value> {
        self.metadata.read().clone()
    }

    /// Merge metadata with existing
    pub fn merge_metadata(&self, new_metadata: serde_json::Value) {
        let mut metadata = self.metadata.write();
        match (&mut *metadata, new_metadata) {
            (Some(serde_json::Value::Object(existing)), serde_json::Value::Object(new)) => {
                for (key, value) in new {
                    if value.is_null() {
                        existing.remove(&key);
                    } else {
                        existing.insert(key, value);
                    }
                }
            }
            (_, new) => {
                *metadata = Some(new);
            }
        }
    }
}

/// Spawns a dedicated thread for PTY writes
fn spawn_pty_writer_thread(
    session_id: String,
    mut writer: Box<dyn IoWrite + Send>,
    input_rx: std::sync::mpsc::Receiver<Vec<u8>>,
) {
    std::thread::spawn(move || {
        info!("[writer:{}] Writer thread started", session_id);

        let mut total_bytes_written: usize = 0;
        let mut message_count: usize = 0;

        while let Ok(data) = input_rx.recv() {
            message_count += 1;
            let data_len = data.len();

            // Write in small chunks to prevent blocking
            for chunk in data.chunks(PTY_WRITE_CHUNK_SIZE) {
                if let Err(e) = writer.write_all(chunk) {
                    error!(
                        "[writer:{}] Write error: {} (errno: {:?})",
                        session_id,
                        e,
                        e.raw_os_error()
                    );
                    return;
                }
                if let Err(e) = writer.flush() {
                    error!(
                        "[writer:{}] Flush error: {} (errno: {:?})",
                        session_id,
                        e,
                        e.raw_os_error()
                    );
                    return;
                }
                std::thread::yield_now();
            }

            total_bytes_written += data_len;
            if data_len > 100 {
                info!(
                    "[writer:{}] Large input processed: {} bytes (total: {} bytes)",
                    session_id, data_len, total_bytes_written
                );
            }
        }

        info!(
            "[writer:{}] Writer thread finished. Total: {} messages, {} bytes",
            session_id, message_count, total_bytes_written
        );
    });
}

/// Find the last valid UTF-8 boundary in a byte slice
pub fn find_utf8_boundary(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }

    if std::str::from_utf8(bytes).is_ok() {
        return bytes.len();
    }

    // Look back up to 4 bytes to find a complete sequence
    for i in 1..=4.min(bytes.len()) {
        let check_pos = bytes.len() - i;
        if std::str::from_utf8(&bytes[..check_pos]).is_ok() {
            return check_pos;
        }
    }

    // Fallback: find last non-continuation byte
    for i in (0..bytes.len()).rev() {
        if bytes[i] & 0b1100_0000 != 0b1000_0000 && std::str::from_utf8(&bytes[..i]).is_ok() {
            return i;
        }
    }

    0
}
