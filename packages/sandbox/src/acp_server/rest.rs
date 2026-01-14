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
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};
use utoipa::{OpenApi, ToSchema};

use super::api_proxy::ConversationApiProxies;
use super::callback::{CallbackClient, CallbackToolCall, CallbackToolCallStatus, StopReason};
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
    /// Uses RwLock to allow runtime configuration via /api/acp/configure endpoint
    callback_client: Arc<RwLock<Option<Arc<CallbackClient>>>>,
    /// Default working directory for CLIs
    default_cwd: PathBuf,
    /// Sandbox ID (Convex document ID) - set via configure endpoint
    sandbox_id: Arc<RwLock<Option<String>>>,
    /// Per-conversation API proxies (set via configure endpoint)
    /// Routes CLI API requests through outer proxy with JWT authentication
    api_proxies: Arc<RwLock<Option<Arc<ConversationApiProxies>>>>,
}

impl RestApiState {
    /// Create new REST API state for ACP endpoints.
    pub fn new() -> Self {
        Self {
            conversations: Arc::new(DashMap::new()),
            callback_client: Arc::new(RwLock::new(None)),
            default_cwd: PathBuf::from("/workspace"),
            sandbox_id: Arc::new(RwLock::new(None)),
            api_proxies: Arc::new(RwLock::new(None)),
        }
    }

    /// Set the callback client for Convex persistence (at startup).
    /// This is the ONLY way the sandbox can communicate back to Convex.
    pub fn with_callback_client(self, client: CallbackClient) -> Self {
        // Synchronously set (at startup)
        let client_lock = self.callback_client.clone();
        tokio::task::block_in_place(|| {
            let rt = tokio::runtime::Handle::current();
            rt.block_on(async {
                let mut guard = client_lock.write().await;
                *guard = Some(Arc::new(client));
            });
        });
        self
    }

    /// Set the default working directory.
    pub fn with_default_cwd(mut self, cwd: PathBuf) -> Self {
        self.default_cwd = cwd;
        self
    }

    /// Configure the server with callback settings at runtime.
    /// Called via /api/acp/configure endpoint after spawn.
    pub async fn configure(
        &self,
        callback_url: String,
        sandbox_jwt: String,
        sandbox_id: String,
        api_proxy_url: Option<String>,
    ) -> Result<(), String> {
        // Set callback client
        let client = CallbackClient::new(callback_url, sandbox_jwt.clone());
        {
            let mut guard = self.callback_client.write().await;
            *guard = Some(Arc::new(client));
        }
        // Set sandbox ID
        {
            let mut guard = self.sandbox_id.write().await;
            *guard = Some(sandbox_id);
        }
        // Start API proxies if proxy URL is provided
        if let Some(ref proxy_url) = api_proxy_url {
            info!(api_proxy_url = %proxy_url, "Starting per-conversation API proxies");
            let proxies = ConversationApiProxies::start(
                proxy_url,
                Some(sandbox_jwt),
                std::time::Duration::from_secs(30),
            )
            .await
            .map_err(|e| format!("Failed to start API proxies: {}", e))?;

            if let Some(proxy) = proxies.anthropic() {
                info!(base_url = %proxy.provider_url("anthropic"), "Anthropic proxy route configured");
            }
            if let Some(proxy) = proxies.openai() {
                info!(base_url = %proxy.provider_url("openai"), "OpenAI proxy route configured");

                // Update Codex config with the local proxy URL (without /openai path).
                // Codex ignores the path portion of base_url, so we provide just host:port.
                // The unified proxy will handle /v1/* as a fallback to OpenAI.
                let local_proxy_url = proxy.base_url();
                if let Err(e) = update_codex_config_base_url(&local_proxy_url).await {
                    warn!(error = %e, "Failed to update Codex config base_url (non-fatal)");
                }
            }

            let mut guard = self.api_proxies.write().await;
            *guard = Some(Arc::new(proxies));
        }
        Ok(())
    }

    /// Get environment variables to set for spawned CLIs.
    /// Always includes HOME for config file discovery.
    /// Returns proxy URLs if proxies are configured.
    pub async fn get_cli_env_vars(&self) -> Vec<(String, String)> {
        // Always include HOME so CLIs can find their config files
        // (e.g., ~/.codex/config.toml)
        let mut env_vars = vec![("HOME".to_string(), "/root".to_string())];

        let guard = self.api_proxies.read().await;
        if let Some(ref proxies) = *guard {
            env_vars.extend(proxies.env_vars());
        }

        env_vars
    }

    /// Get the callback client (if configured).
    pub async fn get_callback_client(&self) -> Option<Arc<CallbackClient>> {
        self.callback_client.read().await.clone()
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

/// Request to configure the sandbox after spawn.
/// Called by Convex to inject callback settings into a running sandbox.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ConfigureRequest {
    /// Convex callback URL for posting state updates.
    #[serde(rename = "callback_url")]
    pub callback_url: String,
    /// JWT token for authenticating callbacks to Convex AND API proxy requests.
    #[serde(rename = "sandbox_jwt")]
    pub sandbox_jwt: String,
    /// Sandbox ID (Convex document ID) for this instance.
    #[serde(rename = "sandbox_id")]
    pub sandbox_id: String,
    /// API proxy base URL (e.g., "https://cmux.sh/api").
    /// If provided, spawned CLIs will route API requests through this proxy.
    #[serde(rename = "api_proxy_url")]
    pub api_proxy_url: Option<String>,
}

/// Response from configure endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct ConfigureResponse {
    /// Whether configuration succeeded
    pub success: bool,
}

/// Configure the sandbox with Convex callback settings.
///
/// Called by Convex immediately after spawning the sandbox. This is necessary
/// because Morph uses memory snapshots - environment variables passed at spawn
/// time are not available to processes that were already running in the snapshot.
#[utoipa::path(
    post,
    path = "/api/acp/configure",
    request_body = ConfigureRequest,
    responses(
        (status = 200, description = "Configuration accepted", body = ConfigureResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "acp"
)]
pub async fn configure(
    State(state): State<RestApiState>,
    Json(request): Json<ConfigureRequest>,
) -> Result<Json<ConfigureResponse>, (StatusCode, Json<ErrorResponse>)> {
    info!(
        sandbox_id = %request.sandbox_id,
        callback_url = %request.callback_url,
        api_proxy_url = ?request.api_proxy_url,
        "Configuring sandbox"
    );

    if let Err(e) = state
        .configure(
            request.callback_url.clone(),
            request.sandbox_jwt.clone(),
            request.sandbox_id.clone(),
            request.api_proxy_url.clone(),
        )
        .await
    {
        error!(error = %e, "Failed to configure sandbox");
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e,
                code: Some("CONFIGURE_FAILED".to_string()),
            }),
        ));
    }

    info!(sandbox_id = %request.sandbox_id, "Sandbox configured");

    Ok(Json(ConfigureResponse { success: true }))
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
    let provider = match request.provider_id.parse::<AcpProvider>() {
        Ok(p) => p,
        Err(_) => {
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

    // Get env vars for CLI (proxy URLs if configured)
    let env_vars = state.get_cli_env_vars().await;
    info!(env_vars = ?env_vars, env_count = env_vars.len(), "CLI environment variables for API proxy");

    // Spawn CLI process with env vars
    let mut spawner = CliSpawner::new(provider, cwd.clone(), SpawnerIsolationMode::None);
    for (key, value) in env_vars {
        spawner = spawner.with_env(key, value);
    }
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
    let callback_client = state.get_callback_client().await;
    let conversation_id = request.conversation_id.clone();
    let current_message_id = conversation_state.current_message_id.clone();

    tokio::spawn(async move {
        let mut line = String::new();

        // Buffer for accumulating message and reasoning chunks
        // We only persist to Convex at message boundaries, not on every token
        let mut message_buffer = String::new();
        let mut reasoning_buffer = String::new();
        let mut pending_tool_calls: Vec<CallbackToolCall> = Vec::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - CLI process ended
                    debug!(conversation_id = %conversation_id, "CLI stdout EOF");
                    break;
                }
                Ok(_) => {
                    debug!(conversation_id = %conversation_id, line = %line.trim(), "CLI stdout output");

                    // Parse ACP event and handle appropriately
                    if let Some(event) = parse_acp_event(&line) {
                        match event {
                            AcpEvent::MessageChunk(text) => {
                                // Buffer text - only persist at message boundaries
                                debug!(conversation_id = %conversation_id, text_len = %text.len(), "Buffering message chunk");
                                message_buffer.push_str(&text);
                            }
                            AcpEvent::ReasoningChunk(text) => {
                                // Buffer reasoning - only persist at message boundaries
                                debug!(conversation_id = %conversation_id, text_len = %text.len(), "Buffering reasoning chunk");
                                reasoning_buffer.push_str(&text);
                            }
                            AcpEvent::ToolCall { id, name, arguments } => {
                                // Buffer tool calls - persist with message complete
                                debug!(
                                    conversation_id = %conversation_id,
                                    tool_id = %id,
                                    tool_name = %name,
                                    "Buffering tool call"
                                );
                                pending_tool_calls.push(CallbackToolCall {
                                    id,
                                    name,
                                    arguments,
                                    status: CallbackToolCallStatus::Pending,
                                    result: None,
                                });
                            }
                            AcpEvent::ToolCallUpdate { id, status, result } => {
                                // Update buffered tool call status
                                debug!(
                                    conversation_id = %conversation_id,
                                    tool_id = %id,
                                    status = %status,
                                    "Updating buffered tool call"
                                );
                                let tool_status = match status.as_str() {
                                    "running" => CallbackToolCallStatus::Running,
                                    "completed" => CallbackToolCallStatus::Completed,
                                    "failed" => CallbackToolCallStatus::Failed,
                                    _ => CallbackToolCallStatus::Pending,
                                };
                                if let Some(tc) = pending_tool_calls.iter_mut().find(|tc| tc.id == id) {
                                    tc.status = tool_status;
                                    if result.is_some() {
                                        tc.result = result;
                                    }
                                }
                            }
                            AcpEvent::MessageComplete(stop_reason) => {
                                // MESSAGE BOUNDARY: Persist all buffered content to Convex
                                info!(
                                    conversation_id = %conversation_id,
                                    stop_reason = %stop_reason,
                                    message_len = %message_buffer.len(),
                                    reasoning_len = %reasoning_buffer.len(),
                                    tool_calls = %pending_tool_calls.len(),
                                    "Message complete - persisting to Convex"
                                );

                                if let Some(ref client) = callback_client {
                                    let msg_id = current_message_id.lock().await;

                                    // Send buffered reasoning if any
                                    if !reasoning_buffer.is_empty() {
                                        client
                                            .send_reasoning_chunk(&conversation_id, msg_id.as_deref(), &reasoning_buffer)
                                            .await;
                                    }

                                    // Send buffered message text if any
                                    if !message_buffer.is_empty() {
                                        client
                                            .send_text_chunk(&conversation_id, msg_id.as_deref(), &message_buffer)
                                            .await;
                                    }

                                    // Send buffered tool calls
                                    for tool_call in &pending_tool_calls {
                                        if let Some(ref msg) = *msg_id {
                                            client.record_tool_call(&conversation_id, msg, tool_call.clone()).await;
                                        }
                                    }

                                    // Send completion
                                    let reason = match stop_reason.as_str() {
                                        "end_turn" => StopReason::EndTurn,
                                        "max_tokens" => StopReason::MaxTokens,
                                        "refusal" => StopReason::Refusal,
                                        "cancelled" => StopReason::Cancelled,
                                        _ => StopReason::EndTurn,
                                    };
                                    if let Some(ref id) = *msg_id {
                                        client.complete_message(&conversation_id, id, reason).await;
                                    }
                                }

                                // Clear buffers for next message turn
                                message_buffer.clear();
                                reasoning_buffer.clear();
                                pending_tool_calls.clear();
                            }
                        }
                    } else {
                        debug!(conversation_id = %conversation_id, "No ACP event parsed from line");
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

        // Send any remaining buffered content on EOF (process ended)
        if !message_buffer.is_empty() || !reasoning_buffer.is_empty() {
            info!(
                conversation_id = %conversation_id,
                message_len = %message_buffer.len(),
                reasoning_len = %reasoning_buffer.len(),
                "EOF - flushing remaining buffers"
            );
            if let Some(ref client) = callback_client {
                let msg_id = current_message_id.lock().await;
                if !reasoning_buffer.is_empty() {
                    client
                        .send_reasoning_chunk(&conversation_id, msg_id.as_deref(), &reasoning_buffer)
                        .await;
                }
                if !message_buffer.is_empty() {
                    client
                        .send_text_chunk(&conversation_id, msg_id.as_deref(), &message_buffer)
                        .await;
                }
                if let Some(ref id) = *msg_id {
                    client.complete_message(&conversation_id, id, StopReason::EndTurn).await;
                }
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

/// Parsed ACP event from CLI stdout.
#[derive(Debug)]
enum AcpEvent {
    /// Agent message text chunk
    MessageChunk(String),
    /// Agent reasoning/thought text chunk
    ReasoningChunk(String),
    /// Tool call event
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// Tool call status update
    ToolCallUpdate {
        id: String,
        status: String,
        result: Option<String>,
    },
    /// Message completion with stop reason
    MessageComplete(String), // stop_reason
}

/// Parse ACP events from a JSON-RPC line.
///
/// Handles multiple formats from both Claude Code and Codex:
/// - Session update notifications (agent_message_chunk, agent_thought_chunk, tool_call, etc.)
/// - Standard JSON-RPC responses with result.content
/// - Codex session event format
fn parse_acp_event(line: &str) -> Option<AcpEvent> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;

    // Check for JSON-RPC result with stopReason (message complete)
    if let Some(result) = value.get("result") {
        if let Some(stop_reason) = result.get("stopReason").and_then(|s| s.as_str()) {
            return Some(AcpEvent::MessageComplete(stop_reason.to_string()));
        }
        // Check for text in result.content (standard response)
        if let Some(text) = extract_text_from_result(result) {
            return Some(AcpEvent::MessageChunk(text));
        }
    }

    // Check for Codex event format (type: "event_msg")
    if value.get("type").and_then(|t| t.as_str()) == Some("event_msg") {
        if let Some(payload) = value.get("payload") {
            if payload.get("type").and_then(|t| t.as_str()) == Some("agent_message") {
                if let Some(message) = payload.get("message").and_then(|m| m.as_str()) {
                    return Some(AcpEvent::MessageChunk(message.to_string()));
                }
            }
        }
    }

    // Check for session/update notifications (params.update)
    if let Some(params) = value.get("params") {
        if let Some(update) = params.get("update") {
            let session_update = update.get("sessionUpdate").and_then(|s| s.as_str());

            match session_update {
                Some("agent_message_chunk") => {
                    if let Some(text) = extract_text_from_content(update.get("content")) {
                        return Some(AcpEvent::MessageChunk(text));
                    }
                }
                Some("agent_thought_chunk") => {
                    if let Some(text) = extract_text_from_content(update.get("content")) {
                        return Some(AcpEvent::ReasoningChunk(text));
                    }
                }
                Some("tool_call") => {
                    // Parse tool call from update
                    if let Some(id) = update.get("id").and_then(|v| v.as_str()) {
                        let name = update
                            .get("title")
                            .or_else(|| update.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let arguments = update
                            .get("input")
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "{}".to_string());
                        return Some(AcpEvent::ToolCall {
                            id: id.to_string(),
                            name,
                            arguments,
                        });
                    }
                }
                Some("tool_call_update") => {
                    if let Some(fields) = update.get("fields") {
                        if let Some(id) = update.get("id").and_then(|v| v.as_str()) {
                            let status = fields
                                .get("status")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let result = fields.get("result").and_then(|v| v.as_str()).map(|s| s.to_string());
                            return Some(AcpEvent::ToolCallUpdate {
                                id: id.to_string(),
                                status,
                                result,
                            });
                        }
                    }
                }
                _ => {}
            }
        }

        // Fallback: params.content[].text (direct content blocks)
        if let Some(text) = extract_text_from_content(params.get("content")) {
            return Some(AcpEvent::MessageChunk(text));
        }
        // params.text directly
        if let Some(text) = params.get("text").and_then(|t| t.as_str()) {
            return Some(AcpEvent::MessageChunk(text.to_string()));
        }
    }

    None
}

/// Extract text from a result object.
fn extract_text_from_result(result: &serde_json::Value) -> Option<String> {
    // Check result.content[].text
    if let Some(content) = result.get("content") {
        if let Some(text) = extract_text_from_content(Some(content)) {
            return Some(text);
        }
    }
    // Check result.text directly
    result.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
}

/// Extract text from a content value (can be object or array).
fn extract_text_from_content(content: Option<&serde_json::Value>) -> Option<String> {
    let content = content?;

    // If content is a direct object with type: "text"
    if content.is_object() {
        let content_type = content.get("type").and_then(|t| t.as_str());
        if matches!(content_type, Some("text") | Some("output_text")) {
            return content.get("text").and_then(|t| t.as_str()).map(|s| s.to_string());
        }
    }

    // If content is an array of blocks
    if let Some(arr) = content.as_array() {
        for block in arr {
            let block_type = block.get("type").and_then(|t| t.as_str());
            if matches!(block_type, Some("text") | Some("output_text")) {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    return Some(text.to_string());
                }
            }
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

/// Update Codex config.toml with the proxy base_url.
///
/// Codex custom providers require `base_url` in the config file - they don't
/// use the OPENAI_BASE_URL environment variable. Since the proxy port is
/// assigned dynamically, we need to patch the config after the proxy starts.
async fn update_codex_config_base_url(openai_base_url: &str) -> Result<(), String> {
    use tokio::fs;
    use tokio::io::AsyncReadExt;

    let config_path = std::path::Path::new("/root/.codex/config.toml");

    // Read existing config
    let mut config_content = String::new();
    if config_path.exists() {
        let mut file = fs::File::open(config_path)
            .await
            .map_err(|e| format!("Failed to open config: {}", e))?;
        file.read_to_string(&mut config_content)
            .await
            .map_err(|e| format!("Failed to read config: {}", e))?;
    } else {
        return Err("Codex config file not found".to_string());
    }

    // Check if base_url is already set
    if config_content.contains("base_url") {
        // Replace existing base_url
        let re = regex::Regex::new(r#"base_url\s*=\s*"[^"]*""#)
            .map_err(|e| format!("Regex error: {}", e))?;
        config_content = re
            .replace_all(&config_content, &format!(r#"base_url = "{}""#, openai_base_url))
            .to_string();
    } else {
        // Add base_url after [model_providers.cmux-proxy] section
        let insertion_point = "[model_providers.cmux-proxy]";
        if let Some(pos) = config_content.find(insertion_point) {
            let insert_pos = pos + insertion_point.len();
            let base_url_line = format!("\nbase_url = \"{}\"", openai_base_url);
            config_content.insert_str(insert_pos, &base_url_line);
        } else {
            warn!("Could not find [model_providers.cmux-proxy] section in Codex config");
            return Err("Config section not found".to_string());
        }
    }

    // Write updated config
    fs::write(config_path, &config_content)
        .await
        .map_err(|e| format!("Failed to write config: {}", e))?;

    info!(base_url = %openai_base_url, "Updated Codex config with proxy base_url");
    Ok(())
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
