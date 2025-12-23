//! PTY types and models

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

/// Request to create a new PTY session
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreatePtyRequest {
    /// Shell to use (default: /bin/zsh)
    #[serde(default = "default_shell")]
    pub shell: String,
    /// Working directory (default: /workspace)
    #[serde(default = "default_cwd")]
    pub cwd: String,
    /// Terminal columns (default: 80)
    #[serde(default = "default_cols")]
    pub cols: u16,
    /// Terminal rows (default: 24)
    #[serde(default = "default_rows")]
    pub rows: u16,
    /// Additional environment variables
    pub env: Option<HashMap<String, String>>,
    /// Session name (auto-generated if not provided)
    pub name: Option<String>,
    /// Client ID for tracking who created the session
    pub client_id: Option<String>,
    /// Flexible metadata for client use
    pub metadata: Option<serde_json::Value>,
}

fn default_shell() -> String {
    "/bin/zsh".to_string()
}

fn default_cwd() -> String {
    "/workspace".to_string()
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

impl Default for CreatePtyRequest {
    fn default() -> Self {
        Self {
            shell: default_shell(),
            cwd: default_cwd(),
            cols: default_cols(),
            rows: default_rows(),
            env: None,
            name: None,
            client_id: None,
            metadata: None,
        }
    }
}

/// Request to update a PTY session
#[derive(Debug, Clone, Serialize, Deserialize, Default, ToSchema)]
pub struct UpdatePtyRequest {
    /// New session name
    pub name: Option<String>,
    /// New index (for reordering)
    pub index: Option<usize>,
    /// Metadata to merge with existing
    pub metadata: Option<serde_json::Value>,
}

/// PTY session information
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct PtyInfo {
    /// Unique session ID (UUID)
    pub id: String,
    /// Human-readable session name
    pub name: String,
    /// Display index (for ordering)
    pub index: usize,
    /// Shell command
    pub shell: String,
    /// Working directory
    pub cwd: String,
    /// Terminal columns
    pub cols: u16,
    /// Terminal rows
    pub rows: u16,
    /// Creation timestamp (Unix epoch seconds)
    pub created_at: f64,
    /// Whether the PTY process is still running
    pub alive: bool,
    /// Process ID
    pub pid: u32,
    /// Sandbox ID (if running inside a sandbox)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_id: Option<String>,
    /// Custom metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

/// Events broadcast by the PTY server
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PtyEvent {
    /// Full state sync (list of all sessions)
    #[serde(rename = "state_sync")]
    StateSync { terminals: Vec<PtyInfo> },

    /// A new PTY was created
    #[serde(rename = "pty_created")]
    PtyCreated {
        terminal: PtyInfo,
        creator_client_id: Option<String>,
    },

    /// A PTY was updated (name, index, metadata)
    #[serde(rename = "pty_updated")]
    PtyUpdated {
        terminal: PtyInfo,
        changes: HashMap<String, serde_json::Value>,
    },

    /// A PTY was deleted
    #[serde(rename = "pty_deleted")]
    PtyDeleted { pty_id: String },

    /// Terminal output data
    #[serde(rename = "output")]
    Output { data: String },

    /// PTY process exited
    #[serde(rename = "exit")]
    Exit { exit_code: Option<i32> },

    /// Error message
    #[serde(rename = "error")]
    Error { error: String },
}

/// Messages from WebSocket clients
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum PtyClientMessage {
    /// Request full state sync
    #[serde(rename = "get_state")]
    GetState,

    /// Create a new PTY
    #[serde(rename = "create_pty")]
    CreatePty {
        shell: Option<String>,
        cwd: Option<String>,
        cols: Option<u16>,
        rows: Option<u16>,
        name: Option<String>,
        client_id: Option<String>,
        metadata: Option<serde_json::Value>,
    },

    /// Rename a PTY
    #[serde(rename = "rename_pty")]
    RenamePty { pty_id: String, name: String },

    /// Reorder a PTY
    #[serde(rename = "reorder_pty")]
    ReorderPty { pty_id: String, index: usize },

    /// Delete a PTY
    #[serde(rename = "delete_pty")]
    DeletePty { pty_id: String },
}

/// Request to resize a PTY
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ResizePtyRequest {
    pub cols: u16,
    pub rows: u16,
}

/// Request to send input to a PTY
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct InputPtyRequest {
    pub data: String,
}

/// PTY capture response
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CapturePtyResponse {
    pub content: String,
}
