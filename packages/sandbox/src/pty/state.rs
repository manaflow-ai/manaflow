//! PTY State Management
//!
//! Manages the collection of PTY sessions and handles session lifecycle.

use super::session::{find_utf8_boundary, PtySession, PTY_READ_BUFFER_SIZE};
use super::types::{CreatePtyRequest, PtyEvent, PtyInfo};
use anyhow::Result;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{error, info};
use uuid::Uuid;

/// Shared PTY state
pub struct PtyState {
    /// All sessions indexed by ID
    sessions: RwLock<HashMap<String, Arc<PtySession>>>,
    /// Counter for generating terminal names
    terminal_counter: RwLock<u32>,
    /// Broadcast channel for PTY events
    event_tx: broadcast::Sender<PtyEvent>,
}

impl PtyState {
    /// Create a new PTY state
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1024);
        Self {
            sessions: RwLock::new(HashMap::new()),
            terminal_counter: RwLock::new(0),
            event_tx,
        }
    }

    /// Subscribe to PTY events
    pub fn subscribe(&self) -> broadcast::Receiver<PtyEvent> {
        self.event_tx.subscribe()
    }

    /// Generate a unique terminal name
    fn get_next_terminal_name(&self, shell: &str) -> String {
        let mut counter = self.terminal_counter.write();
        *counter += 1;
        let shell_name = std::path::Path::new(shell)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("shell");
        format!("{} {}", shell_name, *counter)
    }

    /// Get all sessions ordered by index
    pub fn get_ordered_sessions(&self, sandbox_id: Option<&str>) -> Vec<PtyInfo> {
        let sessions = self.sessions.read();
        let mut infos: Vec<_> = sessions
            .values()
            .filter(|s| {
                s.is_alive()
                    && match sandbox_id {
                        Some(id) => s.sandbox_id.as_deref() == Some(id),
                        None => true,
                    }
            })
            .map(|s| s.to_info())
            .collect();
        infos.sort_by_key(|s| s.index);
        infos
    }

    /// Get a session by ID
    pub fn get_session(&self, session_id: &str) -> Option<Arc<PtySession>> {
        self.sessions.read().get(session_id).cloned()
    }

    /// Get a session by ID, optionally validating sandbox ownership
    pub fn get_session_for_sandbox(
        &self,
        session_id: &str,
        sandbox_id: Option<&str>,
    ) -> Option<Arc<PtySession>> {
        let session = self.sessions.read().get(session_id).cloned()?;

        // If a sandbox_id filter is provided, verify the session belongs to it
        if let Some(id) = sandbox_id {
            if session.sandbox_id.as_deref() != Some(id) {
                return None;
            }
        }

        Some(session)
    }

    /// Create a new PTY session
    ///
    /// If `sandbox_pid` is provided, the PTY will be spawned inside the sandbox.
    pub fn create_session(
        self: &Arc<Self>,
        request: &CreatePtyRequest,
        sandbox_id: Option<String>,
        sandbox_pid: Option<u32>,
    ) -> Result<PtyInfo> {
        let session_id = Uuid::new_v4().to_string();
        let name = request
            .name
            .clone()
            .unwrap_or_else(|| self.get_next_terminal_name(&request.shell));

        let index = self.sessions.read().len();

        let (session, reader) = PtySession::new(
            session_id.clone(),
            name,
            index,
            &request.shell,
            &request.cwd,
            request.cols,
            request.rows,
            request.env.as_ref(),
            sandbox_id,
            sandbox_pid,
            request.metadata.clone(),
        )?;

        let info = session.to_info();
        let session = Arc::new(session);

        // Insert session
        {
            let mut sessions = self.sessions.write();
            sessions.insert(session_id.clone(), session.clone());
        }

        info!(
            "[pty] Session created: {} (pid: {}, sandbox: {:?})",
            session_id, info.pid, info.sandbox_id
        );

        // Spawn reader task
        let state = Arc::clone(self);
        tokio::spawn(spawn_pty_reader(session, reader, state));

        // Broadcast event
        self.broadcast_event(PtyEvent::PtyCreated {
            terminal: info.clone(),
            creator_client_id: request.client_id.clone(),
        });

        Ok(info)
    }

    /// Delete a PTY session
    pub fn delete_session(&self, session_id: &str) -> Option<PtyInfo> {
        let session = {
            let mut sessions = self.sessions.write();
            sessions.remove(session_id)
        }?;

        session.kill();
        let info = session.to_info();

        // Reindex remaining sessions
        self.reindex_sessions();

        // Broadcast event
        self.broadcast_event(PtyEvent::PtyDeleted {
            pty_id: session_id.to_string(),
        });

        info!("[pty] Session deleted: {}", session_id);
        Some(info)
    }

    /// Reindex sessions to ensure contiguous indices
    fn reindex_sessions(&self) {
        let sessions = self.sessions.read();
        let mut infos: Vec<_> = sessions
            .values()
            .filter(|s| s.is_alive())
            .map(|s| (s.id.clone(), s.get_index()))
            .collect();
        infos.sort_by_key(|(_, idx)| *idx);

        for (i, (id, _)) in infos.iter().enumerate() {
            if let Some(session) = sessions.get(id) {
                session.set_index(i);
            }
        }
    }

    /// Broadcast an event to all subscribers
    pub fn broadcast_event(&self, event: PtyEvent) {
        let _ = self.event_tx.send(event);
    }

    /// Get full state sync event
    pub fn get_full_state(&self, sandbox_id: Option<&str>) -> PtyEvent {
        PtyEvent::StateSync {
            terminals: self.get_ordered_sessions(sandbox_id),
        }
    }

    /// Broadcast state sync to all subscribers
    pub fn broadcast_state_sync(&self) {
        self.broadcast_event(self.get_full_state(None));
    }

    /// Count sessions
    pub fn session_count(&self) -> usize {
        self.sessions.read().len()
    }

    /// Count sessions for a specific sandbox
    pub fn sandbox_session_count(&self, sandbox_id: &str) -> usize {
        self.sessions
            .read()
            .values()
            .filter(|s| s.sandbox_id.as_deref() == Some(sandbox_id) && s.is_alive())
            .count()
    }
}

impl Default for PtyState {
    fn default() -> Self {
        Self::new()
    }
}

/// Spawn a task to read PTY output
async fn spawn_pty_reader(
    session: Arc<PtySession>,
    mut reader: Box<dyn Read + Send>,
    state: Arc<PtyState>,
) {
    let session_id = session.id.clone();
    let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
    let mut utf8_buffer: Vec<u8> = Vec::new();

    info!("[reader:{}] Reader task started", session_id);

    let mut total_bytes_read: usize = 0;

    loop {
        let read_result = tokio::task::spawn_blocking({
            move || {
                let result = reader.read(&mut buf);
                (reader, buf, result)
            }
        })
        .await;

        let (returned_reader, returned_buf, result) = match read_result {
            Ok(r) => r,
            Err(e) => {
                error!("[reader:{}] spawn_blocking panicked: {}", session_id, e);
                break;
            }
        };

        reader = returned_reader;
        buf = returned_buf;

        match result {
            Ok(0) => {
                // EOF - flush remaining buffer
                if !utf8_buffer.is_empty() {
                    let data = String::from_utf8_lossy(&utf8_buffer).to_string();
                    session.append_scrollback(&data);
                    let _ = session.output_tx.send(data);
                }
                info!(
                    "[reader:{}] EOF received. Total: {} bytes",
                    session_id, total_bytes_read
                );
                break;
            }
            Ok(n) => {
                total_bytes_read += n;
                utf8_buffer.extend_from_slice(&buf[..n]);

                let valid_up_to = find_utf8_boundary(&utf8_buffer);
                if valid_up_to > 0 {
                    let data = String::from_utf8_lossy(&utf8_buffer[..valid_up_to]).to_string();
                    session.append_scrollback(&data);
                    let _ = session.output_tx.send(data);

                    // Keep incomplete bytes for next read
                    utf8_buffer = utf8_buffer[valid_up_to..].to_vec();
                }
            }
            Err(e) => {
                error!("[reader:{}] Read error: {}", session_id, e);
                break;
            }
        }
    }

    // Clean up dead session
    {
        let mut sessions = state.sessions.write();
        if let Some(s) = sessions.get(&session_id) {
            if !s.is_alive() {
                sessions.remove(&session_id);
                info!("[reader:{}] Session removed (dead)", session_id);
            }
        }
    }

    state.reindex_sessions();
    state.broadcast_state_sync();
}
