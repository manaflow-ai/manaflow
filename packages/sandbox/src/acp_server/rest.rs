//! REST API endpoints for ACP sandbox control.
//!
//! Provides HTTP endpoints for Convex to control the sandbox (init/prompt).
//! The sandbox can ONLY communicate back to Convex via callbacks using JWT.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};
use utoipa::{OpenApi, ToSchema};

use super::callback::{CallbackClient, StopReason};
use super::spawner::{AcpProvider, CliSpawner, IsolationMode as SpawnerIsolationMode};

/// State for a single conversation.
struct ConversationState {
    /// CLI stdin handle for sending prompts
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    /// ACP session ID (returned by new_session handshake)
    acp_session_id: Arc<Mutex<Option<String>>>,
    /// Current message ID being streamed (set when assistant starts responding)
    current_message_id: Arc<Mutex<Option<String>>>,
}

/// State for ACP REST API handlers (Convex → Sandbox communication).
///
/// SECURITY: This state only has callback access to Convex, not direct query/mutation access.
/// The sandbox can only communicate back via the callback client using the JWT provided by Convex.
#[derive(Clone)]
pub struct RestApiState {
    /// Active conversations: conversation_id -> ConversationState
    conversations: Arc<DashMap<String, Arc<ConversationState>>>,
    /// Callback client for sending updates to Convex (required for persistence)
    callback_client: Option<Arc<CallbackClient>>,
    /// Default working directory for CLIs
    default_cwd: PathBuf,
}

impl RestApiState {
    /// Create new REST API state for ACP endpoints.
    pub fn new() -> Self {
        Self {
            conversations: Arc::new(DashMap::new()),
            callback_client: None,
            default_cwd: PathBuf::from("/workspace"),
        }
    }

    /// Set the callback client for Convex persistence.
    /// This is the ONLY way the sandbox can communicate back to Convex.
    pub fn with_callback_client(mut self, client: CallbackClient) -> Self {
        self.callback_client = Some(Arc::new(client));
        self
    }

    /// Set the default working directory.
    pub fn with_default_cwd(mut self, cwd: PathBuf) -> Self {
        self.default_cwd = cwd;
        self
    }
}

impl Default for RestApiState {
    fn default() -> Self {
        Self::new()
    }
}

/// Error response body.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    /// Error message
    pub error: String,
    /// Error code (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl IntoResponse for ErrorResponse {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(self)).into_response()
    }
}

/// Content block in a message.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type")]
pub enum ContentBlock {
    /// Text content
    #[serde(rename = "text")]
    Text { text: String },
    /// Image content (base64)
    #[serde(rename = "image")]
    Image {
        data: Option<String>,
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
    },
    /// Resource link
    #[serde(rename = "resource_link")]
    ResourceLink {
        uri: String,
        name: Option<String>,
        description: Option<String>,
    },
}

/// Perform ACP handshake (initialize + new_session) with the CLI.
/// Returns the ACP session ID on success.
async fn perform_acp_handshake(
    stdin: &mut ChildStdin,
    stdout: &mut BufReader<ChildStdout>,
    cwd: &std::path::Path,
) -> Result<String, String> {
    // Generate unique request IDs
    let init_id = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();

    // Send initialize request
    let init_request = json!({
        "jsonrpc": "2.0",
        "id": init_id,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                },
                "terminal": false
            }
        }
    });

    let init_msg = format!(
        "{}\n",
        serde_json::to_string(&init_request).unwrap_or_default()
    );
    stdin
        .write_all(init_msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to send initialize: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush initialize: {}", e))?;

    debug!("Sent ACP initialize request");

    // Read initialize response
    let mut line = String::new();
    stdout
        .read_line(&mut line)
        .await
        .map_err(|e| format!("Failed to read initialize response: {}", e))?;

    debug!(response = %line.trim(), "Received initialize response");

    // Parse initialize response to check for errors
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
        if value.get("error").is_some() {
            return Err(format!("Initialize failed: {}", line.trim()));
        }
    }

    // Send session/new request
    let new_session_request = json!({
        "jsonrpc": "2.0",
        "id": session_id,
        "method": "session/new",
        "params": {
            "cwd": cwd.to_string_lossy(),
            "mcpServers": []
        }
    });

    let session_msg = format!(
        "{}\n",
        serde_json::to_string(&new_session_request).unwrap_or_default()
    );
    stdin
        .write_all(session_msg.as_bytes())
        .await
        .map_err(|e| format!("Failed to send new_session: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush new_session: {}", e))?;

    debug!("Sent ACP new_session request");

    // Read new_session response
    line.clear();
    stdout
        .read_line(&mut line)
        .await
        .map_err(|e| format!("Failed to read new_session response: {}", e))?;

    debug!(response = %line.trim(), "Received new_session response");

    // Parse new_session response to extract session ID
    let value: serde_json::Value = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse new_session response: {}", e))?;

    if let Some(error) = value.get("error") {
        return Err(format!("new_session failed: {}", error));
    }

    // Extract session ID from result.sessionId
    let acp_session_id = value
        .get("result")
        .and_then(|r| r.get("sessionId"))
        .and_then(|s| s.as_str())
        .ok_or_else(|| "No sessionId in new_session response".to_string())?
        .to_string();

    debug!(acp_session_id = %acp_session_id, "ACP handshake complete");

    Ok(acp_session_id)
}

// ============================================================================
// ACP Prompt/Init Endpoints (for Convex -> Sandbox communication)
// ============================================================================

/// Request to initialize a conversation on this sandbox.
/// Called by Convex when assigning a conversation to this sandbox.
#[derive(Debug, Deserialize, ToSchema)]
pub struct InitConversationRequest {
    /// Convex conversation ID
    #[serde(rename = "conversation_id")]
    pub conversation_id: String,
    /// Session ID for the conversation
    #[serde(rename = "session_id")]
    pub session_id: String,
    /// Provider to use (claude, codex, gemini, opencode)
    #[serde(rename = "provider_id")]
    pub provider_id: String,
    /// Working directory for the CLI
    pub cwd: String,
}

/// Response from init conversation.
#[derive(Debug, Serialize, ToSchema)]
pub struct InitConversationResponse {
    /// Whether initialization succeeded
    pub success: bool,
    /// Error message if failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Request to send a prompt to an active conversation.
/// Called by Convex when a user sends a message.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PromptRequest {
    /// Convex conversation ID
    #[serde(rename = "conversation_id")]
    pub conversation_id: String,
    /// Session ID for the conversation
    #[serde(rename = "session_id")]
    pub session_id: String,
    /// Content blocks for the prompt
    pub content: Vec<ContentBlock>,
}

/// Response from receiving a prompt.
#[derive(Debug, Serialize, ToSchema)]
pub struct PromptResponse {
    /// Whether the prompt was accepted
    pub accepted: bool,
    /// Error message if not accepted
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Initialize a conversation on this sandbox.
///
/// Called by Convex to assign a new conversation to this sandbox.
/// The sandbox will spawn the appropriate CLI and prepare for prompts.
#[utoipa::path(
    post,
    path = "/api/acp/init",
    request_body = InitConversationRequest,
    responses(
        (status = 200, description = "Conversation initialized", body = InitConversationResponse),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "acp"
)]
pub async fn init_conversation(
    State(state): State<RestApiState>,
    Json(request): Json<InitConversationRequest>,
) -> Result<Json<InitConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!(
        conversation_id = %request.conversation_id,
        session_id = %request.session_id,
        provider_id = %request.provider_id,
        cwd = %request.cwd,
        "Initializing conversation on sandbox"
    );

    // Parse provider ID
    let provider = match AcpProvider::from_str(&request.provider_id) {
        Some(p) => p,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("Unknown provider: {}", request.provider_id),
                    code: Some("UNKNOWN_PROVIDER".to_string()),
                }),
            ));
        }
    };

    // Determine working directory
    let cwd = if request.cwd.is_empty() {
        state.default_cwd.clone()
    } else {
        PathBuf::from(&request.cwd)
    };

    // Spawn CLI process
    let spawner = CliSpawner::new(provider, cwd.clone(), SpawnerIsolationMode::None);
    let mut cli = match spawner.spawn().await {
        Ok(cli) => cli,
        Err(e) => {
            error!(error = %e, "Failed to spawn CLI");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to spawn CLI: {}", e),
                    code: Some("SPAWN_FAILED".to_string()),
                }),
            ));
        }
    };

    let mut stdin = cli.stdin.take().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "CLI stdin not available".to_string(),
                code: Some("STDIN_UNAVAILABLE".to_string()),
            }),
        )
    })?;

    let stdout = cli.stdout.take().ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "CLI stdout not available".to_string(),
                code: Some("STDOUT_UNAVAILABLE".to_string()),
            }),
        )
    })?;

    // Wrap stdout in BufReader for handshake
    let mut reader = BufReader::new(stdout);

    // Perform ACP handshake (initialize + new_session)
    let acp_session_id = match perform_acp_handshake(&mut stdin, &mut reader, &cwd).await {
        Ok(id) => id,
        Err(e) => {
            error!(error = %e, "ACP handshake failed");
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("ACP handshake failed: {}", e),
                    code: Some("HANDSHAKE_FAILED".to_string()),
                }),
            ));
        }
    };

    info!(
        conversation_id = %request.conversation_id,
        acp_session_id = %acp_session_id,
        "ACP handshake completed"
    );

    // Create conversation state with ACP session ID
    let conversation_state = Arc::new(ConversationState {
        stdin: Arc::new(Mutex::new(Some(stdin))),
        acp_session_id: Arc::new(Mutex::new(Some(acp_session_id))),
        current_message_id: Arc::new(Mutex::new(None)),
    });

    // Store conversation state
    state
        .conversations
        .insert(request.conversation_id.clone(), conversation_state.clone());

    // Always spawn stdout reader task to consume CLI output (prevents EPIPE)
    // In callback mode, send updates to Convex; otherwise just log
    let callback_client = state.callback_client.clone();
    let conversation_id = request.conversation_id.clone();
    let current_message_id = conversation_state.current_message_id.clone();

    tokio::spawn(async move {
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - CLI process ended
                    debug!(conversation_id = %conversation_id, "CLI stdout EOF");
                    break;
                }
                Ok(_) => {
                    debug!(conversation_id = %conversation_id, line = %line.trim(), "CLI output");

                    // Parse JSON-RPC response and extract text
                    if let Some(text) = extract_text_from_jsonrpc(&line) {
                        if let Some(ref client) = callback_client {
                            let msg_id = current_message_id.lock().await;
                            client
                                .send_text_chunk(&conversation_id, msg_id.as_deref(), &text)
                                .await;
                        }
                    }
                }
                Err(e) => {
                    warn!(
                        conversation_id = %conversation_id,
                        error = %e,
                        "Error reading CLI stdout"
                    );
                    break;
                }
            }
        }

        // Send completion callback if in callback mode
        if let Some(ref client) = callback_client {
            let msg_id = current_message_id.lock().await;
            if let Some(ref id) = *msg_id {
                client
                    .complete_message(&conversation_id, id, StopReason::EndTurn)
                    .await;
            }
        }
    });

    info!(
        conversation_id = %request.conversation_id,
        provider = %provider.display_name(),
        "Conversation initialized successfully"
    );

    Ok(Json(InitConversationResponse {
        success: true,
        error: None,
    }))
}

/// Extract text content from a JSON-RPC response line.
fn extract_text_from_jsonrpc(line: &str) -> Option<String> {
    // Try to parse as JSON-RPC response
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;

    // Look for text content in various places
    // ACP responses typically have result.content[].text
    if let Some(result) = value.get("result") {
        if let Some(content) = result.get("content") {
            if let Some(arr) = content.as_array() {
                for block in arr {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            return Some(text.to_string());
                        }
                    }
                }
            }
        }
        // Also check for direct text field
        if let Some(text) = result.get("text").and_then(|t| t.as_str()) {
            return Some(text.to_string());
        }
    }

    None
}

/// Receive a prompt for a conversation.
///
/// Called by Convex when a user sends a message. The sandbox will:
/// 1. Forward the prompt to the CLI process
/// 2. Return immediately (async processing)
/// 3. Send responses back to Convex via callback URL
#[utoipa::path(
    post,
    path = "/api/acp/prompt",
    request_body = PromptRequest,
    responses(
        (status = 200, description = "Prompt accepted", body = PromptResponse),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "acp"
)]
pub async fn receive_prompt(
    State(state): State<RestApiState>,
    Json(request): Json<PromptRequest>,
) -> Result<Json<PromptResponse>, (StatusCode, Json<ErrorResponse>)> {
    debug!(
        conversation_id = %request.conversation_id,
        session_id = %request.session_id,
        content_blocks = %request.content.len(),
        "Received prompt for conversation"
    );

    // Look up conversation state
    let conversation = match state.conversations.get(&request.conversation_id) {
        Some(conv) => conv.clone(),
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: format!("Conversation not found: {}", request.conversation_id),
                    code: Some("NOT_FOUND".to_string()),
                }),
            ));
        }
    };

    // Get the ACP session ID from conversation state
    let acp_session_id = {
        let session_id_guard = conversation.acp_session_id.lock().await;
        session_id_guard.clone().ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "ACP session not initialized".to_string(),
                    code: Some("SESSION_NOT_INITIALIZED".to_string()),
                }),
            )
        })?
    };

    // Format content as JSON-RPC message for ACP
    let content: Vec<serde_json::Value> = request
        .content
        .iter()
        .map(|block| match block {
            ContentBlock::Text { text } => {
                json!({ "type": "text", "text": text })
            }
            ContentBlock::Image { data, mime_type } => {
                json!({
                    "type": "image",
                    "data": data,
                    "mimeType": mime_type
                })
            }
            ContentBlock::ResourceLink {
                uri,
                name,
                description,
            } => {
                json!({
                    "type": "resource_link",
                    "uri": uri,
                    "name": name,
                    "description": description
                })
            }
        })
        .collect();

    // Create JSON-RPC request using ACP session/prompt method
    // Use the ACP session ID from the handshake, not the Convex session ID
    let jsonrpc_request = json!({
        "jsonrpc": "2.0",
        "id": request.session_id,
        "method": "session/prompt",
        "params": {
            "sessionId": acp_session_id,
            "prompt": content
        }
    });

    // Send to CLI stdin
    let mut stdin = conversation.stdin.lock().await;
    if let Some(ref mut stdin_handle) = *stdin {
        let message = format!(
            "{}\n",
            serde_json::to_string(&jsonrpc_request).unwrap_or_default()
        );
        if let Err(e) = stdin_handle.write_all(message.as_bytes()).await {
            error!(
                conversation_id = %request.conversation_id,
                error = %e,
                "Failed to write to CLI stdin"
            );
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to send prompt to CLI: {}", e),
                    code: Some("STDIN_ERROR".to_string()),
                }),
            ));
        }
        if let Err(e) = stdin_handle.flush().await {
            warn!(
                conversation_id = %request.conversation_id,
                error = %e,
                "Failed to flush CLI stdin"
            );
        }
    } else {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "CLI stdin not available".to_string(),
                code: Some("STDIN_UNAVAILABLE".to_string()),
            }),
        ));
    }

    debug!(
        conversation_id = %request.conversation_id,
        "Prompt forwarded to CLI"
    );

    Ok(Json(PromptResponse {
        accepted: true,
        error: None,
    }))
}

/// OpenAPI documentation for REST API endpoints.
#[derive(OpenApi)]
#[openapi(
    paths(
        init_conversation,
        receive_prompt,
    ),
    components(schemas(
        ContentBlock,
        ErrorResponse,
        InitConversationRequest,
        InitConversationResponse,
        PromptRequest,
        PromptResponse,
    )),
    tags(
        (name = "acp", description = "ACP sandbox control endpoints")
    )
)]
pub struct RestApiDoc;
