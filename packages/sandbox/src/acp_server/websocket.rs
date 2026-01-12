//! WebSocket handler for ACP connections from iOS clients.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use super::agent::WrappedAgent;
use super::persistence::ConvexClient;
use super::spawner::{AcpProvider, IsolationMode};

/// JSON-RPC request structure.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

/// JSON-RPC notification (no id).
#[derive(Debug, Deserialize)]
struct JsonRpcNotification {
    #[allow(dead_code)]
    jsonrpc: String,
    method: String,
    params: Option<serde_json::Value>,
}

/// session/prompt params
#[derive(Debug, Deserialize)]
struct SessionPromptParams {
    #[serde(rename = "sessionId")]
    #[allow(dead_code)]
    session_id: String,
    prompt: Vec<AcpContentBlock>,
}

/// ACP ContentBlock (for parsing)
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum AcpContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        #[allow(dead_code)]
        data: Option<String>,
        #[serde(rename = "mimeType")]
        #[allow(dead_code)]
        mime_type: Option<String>,
    },
    #[serde(rename = "resource_link")]
    ResourceLink {
        #[allow(dead_code)]
        uri: String,
        #[allow(dead_code)]
        name: Option<String>,
        #[allow(dead_code)]
        description: Option<String>,
    },
    #[serde(other)]
    Other,
}

/// session/update params
#[derive(Debug, Deserialize)]
struct SessionUpdateParams {
    #[serde(rename = "sessionId")]
    #[allow(dead_code)]
    session_id: String,
    update: SessionUpdate,
}

/// Session update types
#[derive(Debug, Deserialize)]
#[serde(tag = "sessionUpdate")]
enum SessionUpdate {
    #[serde(rename = "agent_message_chunk")]
    AgentMessageChunk { content: AcpContentBlock },
    #[serde(other)]
    Other,
}

/// State for tracking current assistant message during streaming.
#[derive(Default)]
struct StreamingState {
    /// Current assistant message ID (if streaming)
    current_message_id: Option<String>,
    /// Accumulated text content
    accumulated_text: String,
}

use super::api_proxy::{ApiProxies, ConversationApiProxies};

/// Manager for per-conversation API proxies.
#[derive(Default)]
pub struct ConversationProxyManager {
    /// Map of conversation ID to proxies
    proxies: std::collections::HashMap<String, std::sync::Arc<ConversationApiProxies>>,
}

impl ConversationProxyManager {
    /// Create a new manager.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register proxies for a conversation.
    pub fn register(
        &mut self,
        conversation_id: String,
        proxies: std::sync::Arc<ConversationApiProxies>,
    ) {
        self.proxies.insert(conversation_id, proxies);
    }

    /// Get proxies for a conversation.
    pub fn get(&self, conversation_id: &str) -> Option<std::sync::Arc<ConversationApiProxies>> {
        self.proxies.get(conversation_id).cloned()
    }

    /// Remove proxies for a conversation.
    pub fn remove(&mut self, conversation_id: &str) {
        self.proxies.remove(conversation_id);
    }
}

/// Shared proxy manager state.
pub type SharedProxyManager = Arc<tokio::sync::RwLock<ConversationProxyManager>>;

/// State for the ACP server.
#[derive(Clone)]
pub struct AcpServerState {
    /// Convex URL for persistence
    pub convex_url: String,
    /// JWT secret for verification
    pub jwt_secret: String,
    /// Convex admin key for API authentication
    pub convex_admin_key: String,
    /// Default working directory
    pub default_cwd: std::path::PathBuf,
    /// API keys for coding CLIs (deprecated, use proxies instead)
    pub api_keys: ApiKeys,
    /// API proxies for coding CLIs (preferred over direct API keys)
    pub api_proxies: Option<Arc<ApiProxies>>,
    /// Outer proxy base URL (e.g., "https://cmux.sh/api")
    pub api_proxy_url: Option<String>,
    /// Shared proxy manager for per-conversation proxies
    pub proxy_manager: SharedProxyManager,
}

/// API keys for different coding CLI providers.
#[derive(Clone, Default)]
pub struct ApiKeys {
    /// Anthropic API key for Claude Code
    pub anthropic_api_key: Option<String>,
    /// OpenAI API key for Codex
    pub openai_api_key: Option<String>,
    /// Google API key for Gemini CLI
    pub google_api_key: Option<String>,
}

impl AcpServerState {
    /// Create new ACP server state.
    pub fn new(
        convex_url: String,
        jwt_secret: String,
        convex_admin_key: String,
        default_cwd: std::path::PathBuf,
    ) -> Self {
        Self {
            convex_url,
            jwt_secret,
            convex_admin_key,
            default_cwd,
            api_keys: ApiKeys::default(),
            api_proxies: None,
            api_proxy_url: None,
            proxy_manager: Arc::new(tokio::sync::RwLock::new(ConversationProxyManager::new())),
        }
    }

    /// Set API keys (deprecated, use with_proxies instead).
    pub fn with_api_keys(mut self, api_keys: ApiKeys) -> Self {
        self.api_keys = api_keys;
        self
    }

    /// Set API proxies (preferred over direct API keys).
    pub fn with_proxies(mut self, proxies: Arc<ApiProxies>) -> Self {
        self.api_proxies = Some(proxies);
        self
    }

    /// Set outer proxy base URL for per-conversation proxies.
    pub fn with_api_proxy_url(mut self, api_proxy_url: String) -> Self {
        self.api_proxy_url = Some(api_proxy_url);
        self
    }
}

/// Conversation token payload.
#[derive(Debug, Clone)]
pub struct ConversationTokenPayload {
    pub conversation_id: String,
    pub team_id: String,
    #[allow(dead_code)]
    pub user_id: Option<String>,
}

/// JWT claims for conversation tokens.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationTokenClaims {
    conversation_id: String,
    team_id: String,
    user_id: Option<String>,
}

/// Verify a conversation JWT token with HMAC-SHA256 signature validation.
fn verify_conversation_token(
    token: &str,
    secret: &str,
) -> Result<ConversationTokenPayload, String> {
    use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};

    // Create decoding key from secret
    let key = DecodingKey::from_secret(secret.as_bytes());

    // Configure validation for HS256
    let mut validation = Validation::new(Algorithm::HS256);
    // Required claims are checked by serde deserialization
    validation.required_spec_claims.clear();
    validation.validate_exp = true;

    // Decode and verify the token
    let token_data = decode::<ConversationTokenClaims>(token, &key, &validation)
        .map_err(|e| format!("JWT verification failed: {}", e))?;

    Ok(ConversationTokenPayload {
        conversation_id: token_data.claims.conversation_id,
        team_id: token_data.claims.team_id,
        user_id: token_data.claims.user_id,
    })
}

/// Extract provider from query params or default.
fn extract_provider(query: &str) -> AcpProvider {
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "provider" {
                if let Some(provider) = AcpProvider::from_str(value) {
                    return provider;
                }
            }
        }
    }
    AcpProvider::Claude // Default
}

/// Extract isolation mode from query params.
fn extract_isolation(query: &str) -> IsolationMode {
    for pair in query.split('&') {
        let mut parts = pair.split('=');
        if let (Some(key), Some(value)) = (parts.next(), parts.next()) {
            if key == "isolation" {
                match value {
                    "none" => return IsolationMode::None,
                    "shared" => {
                        // Look for namespace_id
                        for pair2 in query.split('&') {
                            let mut parts2 = pair2.split('=');
                            if let (Some("namespace_id"), Some(ns_id)) =
                                (parts2.next(), parts2.next())
                            {
                                return IsolationMode::SharedNamespace {
                                    namespace_id: ns_id.to_string(),
                                };
                            }
                        }
                        return IsolationMode::DedicatedNamespace;
                    }
                    "dedicated" => return IsolationMode::DedicatedNamespace,
                    _ => {}
                }
            }
        }
    }
    IsolationMode::None // Default for ACP server (running in sandbox already)
}

/// Request to set JWT for a conversation proxy.
#[derive(Debug, serde::Deserialize)]
pub struct SetJwtRequest {
    /// JWT token to set
    pub jwt: String,
}

/// Response from setting JWT.
#[derive(Debug, serde::Serialize)]
pub struct SetJwtResponse {
    /// Whether the JWT was set successfully
    pub success: bool,
    /// Message (error or success)
    pub message: String,
}

/// Set JWT for a conversation's API proxy.
///
/// This endpoint allows setting the JWT for a conversation's per-conversation proxy.
/// The proxy will wait up to 5 seconds for the JWT to be set before rejecting requests.
pub async fn set_conversation_jwt(
    State(state): State<AcpServerState>,
    axum::extract::Path(conversation_id): axum::extract::Path<String>,
    axum::Json(request): axum::Json<SetJwtRequest>,
) -> impl IntoResponse {
    let manager = state.proxy_manager.read().await;

    if let Some(proxies) = manager.get(&conversation_id) {
        proxies.set_jwt(request.jwt).await;
        (
            axum::http::StatusCode::OK,
            axum::Json(SetJwtResponse {
                success: true,
                message: "JWT set successfully".to_string(),
            }),
        )
    } else {
        (
            axum::http::StatusCode::NOT_FOUND,
            axum::Json(SetJwtResponse {
                success: false,
                message: format!("No proxy found for conversation {}", conversation_id),
            }),
        )
    }
}

/// WebSocket handler for ACP connections.
pub async fn acp_websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<AcpServerState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Extract JWT from Authorization header
    let jwt = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    // Extract query params from custom header
    let query = headers
        .get("x-acp-params")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Extract cwd override from header (for local development without admin key)
    let cwd_override = headers
        .get("x-acp-cwd")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let provider = extract_provider(&query);
    let isolation = extract_isolation(&query);

    ws.on_upgrade(move |socket| {
        handle_acp_connection(socket, state, jwt, provider, isolation, cwd_override)
    })
}

/// Handle an ACP WebSocket connection.
async fn handle_acp_connection(
    socket: WebSocket,
    state: AcpServerState,
    jwt: Option<String>,
    provider: AcpProvider,
    isolation: IsolationMode,
    cwd_override: Option<String>,
) {
    // Verify JWT
    let token_payload = match jwt {
        Some(ref token) => match verify_conversation_token(token, &state.jwt_secret) {
            Ok(payload) => payload,
            Err(e) => {
                error!(error = %e, "JWT verification failed");
                return;
            }
        },
        None => {
            error!("No JWT provided");
            return;
        }
    };

    info!(
        conversation_id = %token_payload.conversation_id,
        team_id = %token_payload.team_id,
        provider = %provider.display_name(),
        "ACP connection established"
    );

    // Create Convex client for persistence
    let convex_client = ConvexClient::new(&state.convex_url, &state.convex_admin_key);

    // Fetch conversation to get its cwd, or use override/default
    let cwd = if let Some(override_cwd) = cwd_override {
        debug!(
            conversation_id = %token_payload.conversation_id,
            cwd = %override_cwd,
            "Using cwd from header override"
        );
        std::path::PathBuf::from(override_cwd)
    } else {
        match convex_client
            .get_conversation(&token_payload.conversation_id)
            .await
        {
            Ok(conv) => {
                let path = if conv.cwd.is_empty() {
                    state.default_cwd.clone()
                } else {
                    std::path::PathBuf::from(&conv.cwd)
                };
                debug!(
                    conversation_id = %token_payload.conversation_id,
                    cwd = %path.display(),
                    "Using conversation cwd from Convex"
                );
                path
            }
            Err(e) => {
                warn!(
                    error = %e,
                    conversation_id = %token_payload.conversation_id,
                    "Failed to fetch conversation, using default cwd"
                );
                state.default_cwd.clone()
            }
        }
    };

    // Build environment variables for the CLI
    // Priority: 1. Per-conversation proxies (outer proxy mode)
    //           2. Shared API proxies (direct mode with local keys)
    //           3. Direct API keys (deprecated)
    let (env_vars, conversation_proxies) = if let Some(ref api_proxy_url) = state.api_proxy_url {
        // Outer proxy mode: create per-conversation proxies that forward to Vercel
        // JWT is passed from the WebSocket connection
        let jwt_timeout = std::time::Duration::from_secs(5);

        match ConversationApiProxies::start(api_proxy_url, jwt.clone(), jwt_timeout).await {
            Ok(proxies) => {
                let proxies = std::sync::Arc::new(proxies);
                let vars = proxies.env_vars();
                debug!(
                    proxy_vars = ?vars,
                    conversation_id = %token_payload.conversation_id,
                    "Using per-conversation outer proxy for CLI"
                );

                // Register proxies in manager
                {
                    let mut manager = state.proxy_manager.write().await;
                    manager.register(token_payload.conversation_id.clone(), proxies.clone());
                }

                (vars, Some(proxies))
            }
            Err(e) => {
                error!(
                    error = %e,
                    conversation_id = %token_payload.conversation_id,
                    "Failed to start per-conversation proxies"
                );
                return;
            }
        }
    } else if let Some(ref proxies) = state.api_proxies {
        // Direct mode: use shared proxy base URLs (API keys held by proxy)
        let vars = proxies.env_vars();
        debug!(
            proxy_vars = ?vars,
            "Using shared API proxies for CLI"
        );
        (vars, None)
    } else {
        // Deprecated: fall back to direct API keys
        let mut vars = Vec::new();
        match provider {
            AcpProvider::Claude => {
                if let Some(ref key) = state.api_keys.anthropic_api_key {
                    vars.push(("ANTHROPIC_API_KEY".to_string(), key.clone()));
                }
            }
            AcpProvider::Codex => {
                if let Some(ref key) = state.api_keys.openai_api_key {
                    vars.push(("OPENAI_API_KEY".to_string(), key.clone()));
                }
            }
            AcpProvider::Gemini => {
                if let Some(ref key) = state.api_keys.google_api_key {
                    vars.push(("GOOGLE_API_KEY".to_string(), key.clone()));
                }
            }
            AcpProvider::Opencode => {
                // Opencode may use multiple providers, pass all available keys
                if let Some(ref key) = state.api_keys.anthropic_api_key {
                    vars.push(("ANTHROPIC_API_KEY".to_string(), key.clone()));
                }
                if let Some(ref key) = state.api_keys.openai_api_key {
                    vars.push(("OPENAI_API_KEY".to_string(), key.clone()));
                }
            }
        }
        (vars, None)
    };

    // Track conversation proxies for cleanup
    let _conversation_proxies = conversation_proxies;

    // Create wrapped agent
    let agent = Arc::new(WrappedAgent::new(
        convex_client,
        token_payload.conversation_id.clone(),
        provider,
        isolation,
        cwd,
        env_vars,
    ));

    // Connect to CLI
    if let Err(e) = agent.connect().await {
        error!(
            error = %e,
            conversation_id = %token_payload.conversation_id,
            "Failed to connect to CLI"
        );
        return;
    }

    // Get CLI stdin/stdout handles for forwarding
    let (mut cli_stdin, cli_stdout) = match agent.take_cli_io().await {
        Some(io) => io,
        None => {
            error!(
                conversation_id = %token_payload.conversation_id,
                "Failed to get CLI I/O handles"
            );
            return;
        }
    };

    // Split WebSocket
    let (mut ws_write, mut ws_read) = socket.split();

    // Create channel for WebSocket write queue
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Spawn task to write messages to WebSocket
    let ws_write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = ws_write.send(msg).await {
                error!(error = %e, "Failed to send WebSocket message");
                break;
            }
        }
    });

    // Spawn task to read from CLI stdout, persist messages, and forward to WebSocket
    let tx_clone = tx.clone();
    let conversation_id_clone = token_payload.conversation_id.clone();
    let agent_clone = Arc::clone(&agent);
    let streaming_state = Arc::new(Mutex::new(StreamingState::default()));
    let streaming_state_clone = Arc::clone(&streaming_state);
    let cli_read_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let mut reader = BufReader::new(cli_stdout);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    // EOF - CLI closed stdout
                    info!(
                        conversation_id = %conversation_id_clone,
                        "CLI stdout closed"
                    );
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        debug!(
                            conversation_id = %conversation_id_clone,
                            message = %trimmed,
                            "Forwarding CLI response to WebSocket"
                        );

                        // Try to parse as JSON-RPC and persist assistant messages
                        if let Ok(notification) =
                            serde_json::from_str::<JsonRpcNotification>(trimmed)
                        {
                            if notification.method == "session/update" {
                                if let Some(params) = notification.params {
                                    if let Ok(update_params) =
                                        serde_json::from_value::<SessionUpdateParams>(params)
                                    {
                                        if let SessionUpdate::AgentMessageChunk { content } =
                                            update_params.update
                                        {
                                            // Persist streaming content
                                            let mut state = streaming_state_clone.lock().await;

                                            // Start new message if needed
                                            if state.current_message_id.is_none() {
                                                match agent_clone.start_assistant_message().await {
                                                    Ok(id) => {
                                                        state.current_message_id = Some(id);
                                                        state.accumulated_text.clear();
                                                    }
                                                    Err(e) => {
                                                        warn!(
                                                            error = %e,
                                                            "Failed to start assistant message"
                                                        );
                                                    }
                                                }
                                            }

                                            // Accumulate and append text
                                            if let AcpContentBlock::Text { text } = content {
                                                if !text.is_empty() {
                                                    state.accumulated_text.push_str(&text);
                                                    // Persist periodically (every 100 chars or so)
                                                    if state.accumulated_text.len() >= 100 {
                                                        if let Err(e) = agent_clone
                                                            .append_assistant_text(
                                                                &state.accumulated_text,
                                                            )
                                                            .await
                                                        {
                                                            warn!(
                                                                error = %e,
                                                                "Failed to append assistant text"
                                                            );
                                                        }
                                                        state.accumulated_text.clear();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Check for end of turn (final response with id)
                        if let Ok(response) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if response.get("id").is_some()
                                && response.get("result").is_some()
                                && response["result"].get("stopReason").is_some()
                            {
                                // Final response - flush remaining text
                                let mut state = streaming_state_clone.lock().await;
                                if !state.accumulated_text.is_empty() {
                                    if let Err(e) = agent_clone
                                        .append_assistant_text(&state.accumulated_text)
                                        .await
                                    {
                                        warn!(error = %e, "Failed to append final assistant text");
                                    }
                                    state.accumulated_text.clear();
                                }
                                // Reset for next message
                                state.current_message_id = None;

                                // Update conversation status
                                let stop_reason = response["result"]["stopReason"]
                                    .as_str()
                                    .unwrap_or("end_turn");
                                if let Err(e) = agent_clone
                                    .update_status("completed", Some(stop_reason))
                                    .await
                                {
                                    warn!(error = %e, "Failed to update conversation status");
                                }
                            }
                        }

                        // Forward as text message (JSON-RPC is text-based)
                        if let Err(e) = tx_clone.send(Message::Text(trimmed.to_string().into())) {
                            error!(error = %e, "Failed to queue CLI response");
                            break;
                        }
                    }
                }
                Err(e) => {
                    error!(
                        error = %e,
                        conversation_id = %conversation_id_clone,
                        "Error reading from CLI stdout"
                    );
                    break;
                }
            }
        }
    });

    // Main loop: read from WebSocket and forward to CLI stdin
    use tokio::io::AsyncWriteExt;

    while let Some(result) = ws_read.next().await {
        match result {
            Ok(Message::Binary(data)) => {
                let msg = String::from_utf8_lossy(&data);
                debug!(
                    conversation_id = %token_payload.conversation_id,
                    message = %msg,
                    "Forwarding binary message to CLI"
                );

                // Forward to CLI stdin with newline
                if let Err(e) = cli_stdin.write_all(&data).await {
                    error!(error = %e, "Failed to write to CLI stdin");
                    break;
                }
                if let Err(e) = cli_stdin.write_all(b"\n").await {
                    error!(error = %e, "Failed to write newline to CLI stdin");
                    break;
                }
                if let Err(e) = cli_stdin.flush().await {
                    error!(error = %e, "Failed to flush CLI stdin");
                    break;
                }
            }
            Ok(Message::Text(text)) => {
                debug!(
                    conversation_id = %token_payload.conversation_id,
                    message = %text,
                    "Forwarding text message to CLI"
                );

                // Try to parse as JSON-RPC request and persist user prompts
                if let Ok(request) = serde_json::from_str::<JsonRpcRequest>(&text) {
                    if request.method == "session/prompt" {
                        if let Some(params) = request.params {
                            if let Ok(prompt_params) =
                                serde_json::from_value::<SessionPromptParams>(params)
                            {
                                // Extract text content from prompt
                                let text_content: String = prompt_params
                                    .prompt
                                    .iter()
                                    .filter_map(|block| match block {
                                        AcpContentBlock::Text { text } => Some(text.clone()),
                                        _ => None,
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n");

                                if !text_content.is_empty() {
                                    // Persist user message
                                    if let Err(e) = agent.persist_user_text(&text_content).await {
                                        warn!(error = %e, "Failed to persist user message");
                                    } else {
                                        debug!(
                                            conversation_id = %token_payload.conversation_id,
                                            "Persisted user prompt"
                                        );
                                    }
                                }
                            }
                        }
                    }
                }

                // Forward to CLI stdin with newline
                if let Err(e) = cli_stdin.write_all(text.as_bytes()).await {
                    error!(error = %e, "Failed to write to CLI stdin");
                    break;
                }
                if let Err(e) = cli_stdin.write_all(b"\n").await {
                    error!(error = %e, "Failed to write newline to CLI stdin");
                    break;
                }
                if let Err(e) = cli_stdin.flush().await {
                    error!(error = %e, "Failed to flush CLI stdin");
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                info!(
                    conversation_id = %token_payload.conversation_id,
                    "WebSocket closed by client"
                );
                break;
            }
            Ok(Message::Ping(data)) => {
                if let Err(e) = tx.send(Message::Pong(data)) {
                    error!(error = %e, "Failed to send pong");
                    break;
                }
            }
            Ok(Message::Pong(_)) => {
                // Ignore pongs
            }
            Err(e) => {
                error!(error = %e, "WebSocket error");
                break;
            }
        }
    }

    // Clean up: close CLI stdin and wait for tasks
    drop(cli_stdin);
    drop(tx);

    // Wait for tasks to complete with timeout
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let _ = cli_read_task.await;
        let _ = ws_write_task.await;
    })
    .await;

    // Clean up per-conversation proxies from manager
    {
        let mut manager = state.proxy_manager.write().await;
        manager.remove(&token_payload.conversation_id);
    }

    info!(
        conversation_id = %token_payload.conversation_id,
        "ACP connection closed"
    );
}
