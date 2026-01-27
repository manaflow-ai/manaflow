//! REST API endpoints for ACP sandbox control.
//!
//! Provides HTTP endpoints for Convex to control the sandbox (init/prompt).
//! The sandbox can ONLY communicate back to Convex via callbacks using JWT.

use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use dashmap::DashMap;
use futures::stream::unfold;
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, error, info, warn};
use utoipa::{OpenApi, ToSchema};

use super::api_proxy::ConversationApiProxies;
use super::callback::{
    CallbackClient, CallbackRawEvent, CallbackToolCall, CallbackToolCallStatus, StopReason,
};
use super::spawner::{AcpProvider, CliSpawner, IsolationMode as SpawnerIsolationMode};
use super::stream::{StreamEvent, StreamOffset, StreamStore};

const STREAM_NEXT_OFFSET_HEADER: &str = "Acp-Next-Offset";
const STREAM_UP_TO_DATE_HEADER: &str = "Acp-Up-To-Date";
const STREAM_LONG_POLL_TIMEOUT: Duration = Duration::from_secs(25);
const STREAM_SECRET_TTL: Duration = Duration::from_secs(60 * 60);
const STREAM_SECRET_MAX: usize = 4;

#[derive(Clone)]
struct StreamSecretEntry {
    secret: String,
    set_at: Instant,
}

/// OTel (OpenTelemetry) configuration for Claude Code telemetry export.
/// The endpoint points to the Convex OTel proxy which validates sandbox JWT
/// and forwards traces to the backend (Axiom).
#[derive(Clone)]
pub(crate) struct OtelConfig {
    /// OTLP endpoint URL (Convex proxy, e.g., "https://cmux.convex.site/api/otel/v1/traces")
    pub(crate) endpoint: String,
}

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
    /// Stream store for ACP events (sandbox -> browser streaming)
    stream_store: Arc<StreamStore>,
    /// Shared secrets for validating browser stream tokens
    stream_secrets: Arc<RwLock<Vec<StreamSecretEntry>>>,
    /// OTel configuration for Claude Code telemetry export
    otel_config: Arc<RwLock<Option<OtelConfig>>>,
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
            stream_store: Arc::new(StreamStore::new(20_000)),
            stream_secrets: Arc::new(RwLock::new(Vec::new())),
            otel_config: Arc::new(RwLock::new(None)),
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
        stream_secret: Option<String>,
        otel_endpoint: Option<String>,
    ) -> Result<(), String> {
        // Set callback client
        let client = CallbackClient::new(callback_url.clone(), sandbox_jwt.clone());
        {
            let mut guard = self.callback_client.write().await;
            *guard = Some(Arc::new(client));
        }
        // Set sandbox ID
        {
            let mut guard = self.sandbox_id.write().await;
            *guard = Some(sandbox_id.clone());
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

            // Set error callback configuration so the proxy can report persistent errors
            proxies.set_error_callback(callback_url, sandbox_id).await;
            info!("API proxy error callback configured");

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
        if let Some(secret) = stream_secret {
            let mut guard = self.stream_secrets.write().await;
            let now = Instant::now();
            if let Some(entry) = guard.iter_mut().find(|entry| entry.secret == secret) {
                entry.set_at = now;
            } else {
                guard.push(StreamSecretEntry {
                    secret,
                    set_at: now,
                });
            }
            guard.retain(|entry| now.duration_since(entry.set_at) < STREAM_SECRET_TTL);
            guard.sort_by(|a, b| b.set_at.cmp(&a.set_at));
            guard.truncate(STREAM_SECRET_MAX);
        }
        // Store OTel config if endpoint is provided
        // The sandbox JWT will be used for authentication to the Convex OTel proxy
        if let Some(endpoint) = otel_endpoint {
            info!(otel_endpoint = %endpoint, "OTel configuration set");
            let mut guard = self.otel_config.write().await;
            *guard = Some(OtelConfig { endpoint });
        }
        Ok(())
    }

    /// Get environment variables to set for spawned CLIs.
    /// Always includes HOME for config file discovery.
    /// Returns proxy URLs if proxies are configured.
    /// If OTel config is set and conversation_id is provided, includes OTel env vars.
    /// If trace_context is provided, includes TRACEPARENT for trace linking.
    pub async fn get_cli_env_vars(
        &self,
        conversation_id: Option<&str>,
        trace_context: Option<&TraceContext>,
    ) -> Vec<(String, String)> {
        // Always include HOME so CLIs can find their config files
        // (e.g., ~/.codex/config.toml)
        // Include IS_SANDBOX=1 to signal to CLIs that they're running in a sandbox
        // IMPORTANT: Use the process HOME so non-root sandboxes (e.g., E2B) can
        // write config/lock files without permission errors.
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        let mut env_vars = vec![
            ("HOME".to_string(), home_dir),
            ("IS_SANDBOX".to_string(), "1".to_string()),
        ];

        // Add trace parent for linking Convex traces to Claude Code traces
        // Format: 00-{trace_id}-{span_id}-{flags}
        if let Some(ctx) = trace_context {
            env_vars.push(("TRACEPARENT".to_string(), ctx.to_traceparent()));
        }

        // Add OTel config for Claude Code telemetry
        // Uses sandbox JWT for authentication to the Convex OTel proxy
        let otel_guard = self.otel_config.read().await;
        let callback_guard = self.callback_client.read().await;
        if let (Some(ref config), Some(ref callback_client)) = (&*otel_guard, &*callback_guard) {
            env_vars.extend([
                ("CLAUDE_CODE_ENABLE_TELEMETRY".to_string(), "1".to_string()),
                // Enable enhanced telemetry beta feature flag for trace export
                (
                    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA".to_string(),
                    "true".to_string(),
                ),
                // Enable OTLP export for traces, metrics, and logs
                ("OTEL_TRACES_EXPORTER".to_string(), "otlp".to_string()),
                ("OTEL_METRICS_EXPORTER".to_string(), "otlp".to_string()),
                ("OTEL_LOGS_EXPORTER".to_string(), "otlp".to_string()),
                // Use JSON protocol so Convex proxy can parse and rewrite trace_id
                (
                    "OTEL_EXPORTER_OTLP_PROTOCOL".to_string(),
                    "http/json".to_string(),
                ),
                (
                    "OTEL_EXPORTER_OTLP_ENDPOINT".to_string(),
                    config.endpoint.clone(),
                ),
            ]);

            // Set OTLP headers with sandbox JWT for auth to Convex proxy
            let headers = format!("Authorization=Bearer {}", callback_client.jwt());
            env_vars.push(("OTEL_EXPORTER_OTLP_HEADERS".to_string(), headers));

            // Build resource attributes with sandbox.id, conversation.id, and trace context
            // Since Claude Code exports logs/events (not traces), we add trace context as
            // resource attributes so logs can be correlated with Convex traces by trace_id
            let sandbox_id = self.sandbox_id.read().await.clone().unwrap_or_default();
            let mut attrs = format!("sandbox.id={}", sandbox_id);
            if let Some(conv_id) = conversation_id {
                attrs.push_str(&format!(",conversation.id={}", conv_id));
            }
            // Add trace context as resource attributes for correlation with Convex traces
            // Use underscores (not dots) so Axiom indexes these as flat searchable fields
            if let Some(ctx) = trace_context {
                attrs.push_str(&format!(",parent_trace_id={}", ctx.trace_id));
                attrs.push_str(&format!(",parent_span_id={}", ctx.span_id));
            }
            env_vars.push(("OTEL_RESOURCE_ATTRIBUTES".to_string(), attrs));
        }
        drop(otel_guard);
        drop(callback_guard);

        let guard = self.api_proxies.read().await;
        if let Some(ref proxies) = *guard {
            env_vars.extend(proxies.env_vars());
        }

        if !env_vars.iter().any(|(key, _)| key == "ANTHROPIC_API_KEY")
            && std::env::var("ANTHROPIC_API_KEY").is_err()
        {
            env_vars.push((
                "ANTHROPIC_API_KEY".to_string(),
                "sk-ant-proxy-placeholder".to_string(),
            ));
        }

        env_vars
    }

    /// Get the callback client (if configured).
    pub async fn get_callback_client(&self) -> Option<Arc<CallbackClient>> {
        self.callback_client.read().await.clone()
    }

    pub async fn get_sandbox_id(&self) -> Option<String> {
        self.sandbox_id.read().await.clone()
    }

    pub fn stream_store(&self) -> Arc<StreamStore> {
        self.stream_store.clone()
    }

    pub async fn get_stream_secrets(&self) -> Vec<String> {
        let mut guard = self.stream_secrets.write().await;
        let now = Instant::now();
        guard.retain(|entry| now.duration_since(entry.set_at) < STREAM_SECRET_TTL);
        guard.sort_by(|a, b| b.set_at.cmp(&a.set_at));
        guard.iter().map(|entry| entry.secret.clone()).collect()
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
                    "readTextFile": false,
                    "writeTextFile": false
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

/// Trace context for linking Convex traces to Claude Code traces.
/// W3C Trace Context format: https://www.w3.org/TR/trace-context/
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct TraceContext {
    /// 32 hex character trace ID
    #[serde(rename = "traceId")]
    pub trace_id: String,
    /// 16 hex character span ID
    #[serde(rename = "spanId")]
    pub span_id: String,
    /// Trace flags (usually 01 for sampled)
    #[serde(rename = "traceFlags", default)]
    pub trace_flags: Option<u8>,
}

impl TraceContext {
    /// Format as W3C traceparent header: 00-{trace_id}-{span_id}-{flags}
    pub fn to_traceparent(&self) -> String {
        let flags = self.trace_flags.unwrap_or(1);
        format!("00-{}-{}-{:02x}", self.trace_id, self.span_id, flags)
    }
}

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
    /// Permission mode for the session (optional).
    /// If set to "bypassPermissions" or "auto_allow_always", will configure the CLI
    /// to auto-approve all tool uses without prompting.
    #[serde(rename = "permission_mode", default)]
    pub permission_mode: Option<String>,
    /// Trace context from Convex for linking traces.
    /// When provided, will be passed to Claude Code as TRACEPARENT env var.
    #[serde(rename = "trace_context", default)]
    pub trace_context: Option<TraceContext>,
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
    /// Trace context from Convex for linking traces.
    /// When provided, will be passed to Claude Code as TRACEPARENT env var.
    #[serde(rename = "trace_context", default)]
    pub trace_context: Option<TraceContext>,
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

/// Request to send a raw JSON-RPC payload to an active conversation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RpcRequest {
    /// Convex conversation ID
    #[serde(rename = "conversation_id")]
    pub conversation_id: String,
    /// Raw JSON-RPC payload to forward to the CLI
    pub payload: serde_json::Value,
}

/// Response from receiving a JSON-RPC payload.
#[derive(Debug, Serialize, ToSchema)]
pub struct RpcResponse {
    /// Whether the payload was accepted
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
    /// Shared secret for sandbox streaming auth (optional).
    #[serde(rename = "stream_secret")]
    pub stream_secret: Option<String>,
    /// OTLP endpoint URL for telemetry export (Convex OTel proxy).
    /// The sandbox JWT will be used for authentication.
    #[serde(rename = "otel_endpoint")]
    pub otel_endpoint: Option<String>,
}

/// Query parameters for ACP stream endpoint.
#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    pub offset: Option<String>,
    pub live: Option<String>,
}

/// Claims for sandbox stream token verification.
#[derive(Debug, Deserialize)]
struct StreamTokenClaims {
    #[serde(rename = "conversationId")]
    conversation_id: String,
    #[serde(rename = "sandboxId")]
    sandbox_id: String,
    #[allow(dead_code)]
    #[serde(rename = "teamId")]
    team_id: String,
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
        otel_endpoint = ?request.otel_endpoint,
        "Configuring sandbox"
    );

    if let Err(e) = state
        .configure(
            request.callback_url.clone(),
            request.sandbox_jwt.clone(),
            request.sandbox_id.clone(),
            request.api_proxy_url.clone(),
            request.stream_secret.clone(),
            request.otel_endpoint.clone(),
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

// ============================================================================
// ACP Stream Endpoints (sandbox -> browser streaming)
// ============================================================================

fn parse_stream_offset(raw: Option<String>) -> Result<StreamOffset, String> {
    match raw.as_deref() {
        None => Ok(StreamOffset::Start),
        Some("now") => Ok(StreamOffset::Now),
        Some("-1") => Ok(StreamOffset::Start),
        Some(value) => value
            .parse::<u64>()
            .map(StreamOffset::Value)
            .map_err(|_| "Invalid offset value".to_string()),
    }
}

async fn verify_stream_auth(
    state: &RestApiState,
    headers: &HeaderMap,
    conversation_id: &str,
) -> Result<(), StreamError> {
    let auth_header = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    if !auth_header.starts_with("Bearer ") {
        return Err(StreamError::new(
            StatusCode::UNAUTHORIZED,
            "Missing or invalid Authorization header",
            Some("UNAUTHORIZED"),
        ));
    }

    let token = auth_header.trim_start_matches("Bearer ").trim();
    let secrets = state.get_stream_secrets().await;
    if secrets.is_empty() {
        return Err(StreamError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Stream secret not configured",
            Some("STREAM_SECRET_MISSING"),
        ));
    }

    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    let mut decoded: Option<jsonwebtoken::TokenData<StreamTokenClaims>> = None;
    let mut last_error: Option<jsonwebtoken::errors::Error> = None;
    for secret in secrets {
        match decode::<StreamTokenClaims>(
            token,
            &DecodingKey::from_secret(secret.as_bytes()),
            &validation,
        ) {
            Ok(data) => {
                decoded = Some(data);
                break;
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    let decoded = decoded.ok_or_else(|| {
        if let Some(error) = last_error {
            error!(error = %error, "Stream token verification failed");
        } else {
            warn!("Stream token verification failed without error details");
        }
        StreamError::new(
            StatusCode::UNAUTHORIZED,
            "Invalid stream token",
            Some("INVALID_TOKEN"),
        )
    })?;

    if decoded.claims.conversation_id != conversation_id {
        return Err(StreamError::new(
            StatusCode::UNAUTHORIZED,
            "Conversation mismatch",
            Some("CONVERSATION_MISMATCH"),
        ));
    }

    if let Some(sandbox_id) = state.get_sandbox_id().await {
        if decoded.claims.sandbox_id != sandbox_id {
            return Err(StreamError::new(
                StatusCode::UNAUTHORIZED,
                "Sandbox mismatch",
                Some("SANDBOX_MISMATCH"),
            ));
        }
    }

    Ok(())
}

fn build_stream_control_payload(next_offset: u64, up_to_date: bool, truncated: bool) -> String {
    json!({
        "nextOffset": next_offset,
        "upToDate": up_to_date,
        "truncated": truncated,
    })
    .to_string()
}

fn apply_stream_cors(headers: &mut HeaderMap) {
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("authorization, content-type"),
    );
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, OPTIONS"),
    );
}

#[derive(Debug)]
pub struct StreamError {
    status: StatusCode,
    body: ErrorResponse,
}

impl StreamError {
    fn new(status: StatusCode, error: impl Into<String>, code: Option<&str>) -> Self {
        Self {
            status,
            body: ErrorResponse {
                error: error.into(),
                code: code.map(str::to_string),
            },
        }
    }
}

impl IntoResponse for StreamError {
    fn into_response(self) -> Response {
        let mut response = (self.status, Json(self.body)).into_response();
        apply_stream_cors(response.headers_mut());
        response
    }
}

#[utoipa::path(
    options,
    path = "/api/acp/stream/{conversation_id}",
    params(("conversation_id" = String, Path, description = "Convex conversation ID")),
    responses((status = 204, description = "CORS preflight ok")),
    tag = "acp"
)]
pub async fn stream_preflight(Path(_conversation_id): Path<String>) -> Response {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()));
    apply_stream_cors(response.headers_mut());
    response
}

#[utoipa::path(
    get,
    path = "/api/acp/stream/{conversation_id}",
    params(
        ("conversation_id" = String, Path, description = "Convex conversation ID"),
        ("offset" = Option<String>, Query, description = "Last seen seq (-1, now, or number)"),
        ("live" = Option<String>, Query, description = "Live mode: sse or long-poll")
    ),
    responses(
        (status = 200, description = "Stream events or SSE connection"),
        (status = 204, description = "Long-poll timeout"),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 410, description = "Stream truncated", body = ErrorResponse)
    ),
    tag = "acp"
)]
pub async fn stream_acp_events(
    State(state): State<RestApiState>,
    Path(conversation_id): Path<String>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Result<Response, StreamError> {
    verify_stream_auth(&state, &headers, &conversation_id).await?;

    let offset = parse_stream_offset(query.offset.clone()).map_err(|error| {
        StreamError::new(StatusCode::BAD_REQUEST, error, Some("INVALID_OFFSET"))
    })?;

    let live = query.live.as_deref();
    if (live == Some("sse") || live == Some("long-poll")) && query.offset.is_none() {
        return Err(StreamError::new(
            StatusCode::BAD_REQUEST,
            "Live streaming requires an offset",
            Some("OFFSET_REQUIRED"),
        ));
    }

    let store = state.stream_store();

    if live == Some("sse") {
        let initial_read = store
            .read(&conversation_id, StreamOffset::Now)
            .await
            .ok_or_else(|| {
                StreamError::new(
                    StatusCode::NOT_FOUND,
                    "Conversation not found",
                    Some("NOT_FOUND"),
                )
            })?;
        let current_offset = match offset {
            StreamOffset::Start => 0,
            StreamOffset::Now => initial_read.next_offset,
            StreamOffset::Value(value) => value,
        };

        let stream = unfold(
            StreamSseState {
                conversation_id: conversation_id.clone(),
                store,
                current_offset,
                pending: VecDeque::new(),
                done: false,
            },
            |mut state| async move {
                if state.done && state.pending.is_empty() {
                    return None;
                }

                if let Some(event) = state.pending.pop_front() {
                    return Some((Ok::<Event, Infallible>(event), state));
                }

                let read = state
                    .store
                    .read(
                        &state.conversation_id,
                        StreamOffset::Value(state.current_offset),
                    )
                    .await?;

                if read.truncated {
                    let control =
                        build_stream_control_payload(read.next_offset, read.up_to_date, true);
                    state
                        .pending
                        .push_back(Event::default().event("control").data(control));
                    state.current_offset = read.next_offset;
                    state.done = true;
                    let next = state
                        .pending
                        .pop_front()
                        .map(|event| (Ok::<Event, Infallible>(event), state));
                    return next;
                }

                let mut next_read = read.clone();
                if read.events.is_empty() && read.up_to_date {
                    if let Some(waited) = state
                        .store
                        .wait_for_events(
                            &state.conversation_id,
                            state.current_offset,
                            STREAM_LONG_POLL_TIMEOUT,
                        )
                        .await
                    {
                        next_read = waited;
                    }
                }

                for event in &next_read.events {
                    let payload = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());
                    state
                        .pending
                        .push_back(Event::default().event("data").data(payload));
                }

                let control_payload = build_stream_control_payload(
                    next_read.next_offset,
                    next_read.up_to_date,
                    false,
                );
                state
                    .pending
                    .push_back(Event::default().event("control").data(control_payload));

                state.current_offset = next_read.next_offset;

                state
                    .pending
                    .pop_front()
                    .map(|event| (Ok::<Event, Infallible>(event), state))
            },
        );

        let sse = Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default());
        let mut response = sse.into_response();
        if let Ok(value) = HeaderValue::from_str(&initial_read.next_offset.to_string()) {
            response
                .headers_mut()
                .insert(STREAM_NEXT_OFFSET_HEADER, value);
        }
        response
            .headers_mut()
            .insert("cache-control", HeaderValue::from_static("no-cache"));
        apply_stream_cors(response.headers_mut());
        return Ok(response);
    }

    let initial = store.read(&conversation_id, offset).await.ok_or_else(|| {
        StreamError::new(
            StatusCode::NOT_FOUND,
            "Conversation not found",
            Some("NOT_FOUND"),
        )
    })?;

    if initial.truncated {
        return Err(StreamError::new(
            StatusCode::GONE,
            "Stream history truncated",
            Some("STREAM_TRUNCATED"),
        ));
    }

    let read = if live == Some("long-poll") {
        if !initial.events.is_empty() || !initial.up_to_date {
            initial
        } else {
            let waited = store
                .wait_for_events(
                    &conversation_id,
                    initial.next_offset,
                    STREAM_LONG_POLL_TIMEOUT,
                )
                .await
                .unwrap_or(initial);
            if waited.truncated {
                return Err(StreamError::new(
                    StatusCode::GONE,
                    "Stream history truncated",
                    Some("STREAM_TRUNCATED"),
                ));
            }
            waited
        }
    } else {
        initial
    };

    if live == Some("long-poll") && read.events.is_empty() {
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(STREAM_NEXT_OFFSET_HEADER, read.next_offset.to_string())
            .header(STREAM_UP_TO_DATE_HEADER, read.up_to_date.to_string())
            .body(axum::body::Body::empty())
            .map_err(|error| {
                error!(error = %error, "Failed to build long-poll response");
                StreamError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to build response",
                    Some("RESPONSE_ERROR"),
                )
            })?;
        response
            .headers_mut()
            .insert("cache-control", HeaderValue::from_static("no-store"));
        apply_stream_cors(response.headers_mut());
        return Ok(response);
    }

    let payload = serde_json::to_string(&read.events).map_err(|error| {
        error!(error = %error, "Failed to encode stream events");
        StreamError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to encode events",
            Some("ENCODE_ERROR"),
        )
    })?;

    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .header(STREAM_NEXT_OFFSET_HEADER, read.next_offset.to_string())
        .header(STREAM_UP_TO_DATE_HEADER, read.up_to_date.to_string())
        .body(axum::body::Body::from(payload))
        .map_err(|error| {
            error!(error = %error, "Failed to build stream response");
            StreamError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build response",
                Some("RESPONSE_ERROR"),
            )
        })?;

    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    apply_stream_cors(response.headers_mut());
    Ok(response)
}

struct StreamSseState {
    conversation_id: String,
    store: Arc<StreamStore>,
    current_offset: u64,
    pending: VecDeque<Event>,
    done: bool,
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

    // Get env vars for CLI (proxy URLs if configured, OTel config if set, trace context for linking)
    let mut env_vars = state
        .get_cli_env_vars(
            Some(&request.conversation_id),
            request.trace_context.as_ref(),
        )
        .await;
    if provider == AcpProvider::Codex {
        let home_value = "/root".to_string();
        if let Some(existing) = env_vars.iter_mut().find(|(key, _)| key == "HOME") {
            existing.1 = home_value;
        } else {
            env_vars.push(("HOME".to_string(), home_value));
        }
    }
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

    // Set permission mode if specified (auto_allow_always -> bypassPermissions)
    // This must happen before we move stdin into the conversation state
    if let Some(ref mode) = request.permission_mode {
        let acp_mode = match mode.as_str() {
            "auto_allow_always" | "bypassPermissions" => Some("bypassPermissions"),
            "acceptEdits" => Some("acceptEdits"),
            "plan" => Some("plan"),
            "dontAsk" => Some("dontAsk"),
            "default" => Some("default"),
            _ => {
                warn!(
                    conversation_id = %request.conversation_id,
                    mode = %mode,
                    "Unknown permission mode, ignoring"
                );
                None
            }
        };

        if let Some(acp_mode) = acp_mode {
            let set_mode_request = serde_json::json!({
                "jsonrpc": "2.0",
                "id": format!("set_mode_{}", request.conversation_id),
                "method": "session/set_mode",
                "params": {
                    "sessionId": acp_session_id,
                    "modeId": acp_mode
                }
            });

            let message = format!("{}\n", set_mode_request);
            if let Err(e) = stdin.write_all(message.as_bytes()).await {
                error!(
                    conversation_id = %request.conversation_id,
                    error = %e,
                    "Failed to send session/set_mode"
                );
            } else if let Err(e) = stdin.flush().await {
                error!(
                    conversation_id = %request.conversation_id,
                    error = %e,
                    "Failed to flush session/set_mode"
                );
            } else {
                info!(
                    conversation_id = %request.conversation_id,
                    mode = %acp_mode,
                    "Set permission mode"
                );
                // Read the response (we don't need to process it, just consume it)
                let mut response_line = String::new();
                if let Err(e) = reader.read_line(&mut response_line).await {
                    warn!(
                        conversation_id = %request.conversation_id,
                        error = %e,
                        "Failed to read session/set_mode response"
                    );
                } else {
                    debug!(
                        conversation_id = %request.conversation_id,
                        response = %response_line.trim(),
                        "session/set_mode response"
                    );
                }
            }
        }
    }

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
    state
        .stream_store()
        .ensure_conversation(&request.conversation_id);

    // Always spawn stdout reader task to consume CLI output (prevents EPIPE)
    // In callback mode, send updates to Convex; otherwise just log
    let callback_client = state.get_callback_client().await;
    let stream_store = state.stream_store();
    let conversation_id = request.conversation_id.clone();
    let current_message_id = conversation_state.current_message_id.clone();
    let stdin_for_responses = conversation_state.stdin.clone();

    tokio::spawn(async move {
        let mut line = String::new();

        // Buffer for accumulating message and reasoning chunks
        // We only persist to Convex at message boundaries, not on every token
        let mut message_buffer = String::new();
        let mut reasoning_buffer = String::new();
        let mut pending_tool_calls: Vec<(u64, CallbackToolCall)> = Vec::new();
        let mut recorded_tool_calls: HashMap<String, String> = HashMap::new();
        let mut last_message_event_at: Option<u64> = None;
        let mut last_message_event_seq: Option<u64> = None;

        // Raw ACP event buffering for full replay/debugging
        let mut raw_events: Vec<CallbackRawEvent> = Vec::new();
        let mut raw_seq: u64 = 0;
        let mut last_raw_flush = Instant::now();
        let raw_flush_interval = Duration::from_millis(250);
        const RAW_EVENT_BATCH_SIZE: usize = 50;

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

                    // Persist raw ACP event line (best-effort, buffered)
                    raw_seq += 1;
                    let created_at = match SystemTime::now().duration_since(UNIX_EPOCH) {
                        Ok(duration) => duration.as_millis() as u64,
                        Err(error) => {
                            warn!(error = %error, "System time before UNIX_EPOCH");
                            0
                        }
                    };
                    let line_created_at = created_at;
                    let trimmed_line = line.trim_end().to_string();
                    raw_events.push(CallbackRawEvent {
                        seq: raw_seq,
                        raw: trimmed_line.clone(),
                        created_at,
                    });
                    let parsed_event = parse_acp_event(&trimmed_line);
                    let event_type = parsed_event
                        .as_ref()
                        .map(|event| event.event_type().to_string());
                    stream_store
                        .append(
                            &conversation_id,
                            StreamEvent {
                                seq: raw_seq,
                                raw: trimmed_line,
                                created_at: line_created_at,
                                event_type,
                            },
                        )
                        .await;
                    if raw_events.len() >= RAW_EVENT_BATCH_SIZE
                        || last_raw_flush.elapsed() >= raw_flush_interval
                    {
                        flush_raw_events(&callback_client, &conversation_id, &mut raw_events).await;
                        last_raw_flush = Instant::now();
                    }

                    // Handle JSON-RPC requests that need responses (e.g., permission requests)
                    // Check for permission request pattern first (before full parse for logging)
                    if line.contains("session/request_permission") {
                        info!(
                            conversation_id = %conversation_id,
                            line = %line.trim(),
                            "Detected permission request in line"
                        );
                    }

                    if let Some((_request_id, response)) = handle_permission_request(&line) {
                        let option_id = response
                            .get("result")
                            .and_then(|r| r.get("outcome"))
                            .and_then(|o| o.get("optionId"))
                            .and_then(|id| id.as_str())
                            .unwrap_or("unknown");

                        info!(
                            conversation_id = %conversation_id,
                            option_id = %option_id,
                            response = %response,
                            "Auto-approving permission request"
                        );

                        // Send response back to CLI stdin
                        let mut stdin_guard = stdin_for_responses.lock().await;
                        if let Some(ref mut stdin) = *stdin_guard {
                            let response_str = format!("{}\n", response);
                            info!(
                                conversation_id = %conversation_id,
                                response_len = response_str.len(),
                                "Writing permission response to stdin"
                            );
                            if let Err(e) = stdin.write_all(response_str.as_bytes()).await {
                                error!(
                                    conversation_id = %conversation_id,
                                    error = %e,
                                    "Failed to send permission response"
                                );
                            } else {
                                info!(
                                    conversation_id = %conversation_id,
                                    "Permission response written successfully"
                                );
                            }
                            if let Err(e) = stdin.flush().await {
                                error!(
                                    conversation_id = %conversation_id,
                                    error = %e,
                                    "Failed to flush permission response"
                                );
                            } else {
                                info!(
                                    conversation_id = %conversation_id,
                                    "Permission response flushed successfully"
                                );
                            }
                        } else {
                            error!(
                                conversation_id = %conversation_id,
                                "Stdin not available for permission response"
                            );
                        }
                    } else if line.contains("session/request_permission") {
                        // We detected the permission string but parsing failed
                        error!(
                            conversation_id = %conversation_id,
                            line = %line.trim(),
                            "Permission request detected but handle_permission_request returned None"
                        );
                    }

                    // Parse ACP event and handle appropriately
                    if let Some(event) = parsed_event {
                        match event {
                            AcpEvent::MessageChunk(text) => {
                                // Buffer text - only persist at message boundaries
                                debug!(conversation_id = %conversation_id, text_len = %text.len(), "Buffering message chunk");
                                message_buffer.push_str(&text);
                                last_message_event_at = Some(line_created_at);
                                last_message_event_seq = Some(raw_seq);
                            }
                            AcpEvent::ReasoningChunk(text) => {
                                // Buffer reasoning - only persist at message boundaries
                                debug!(conversation_id = %conversation_id, text_len = %text.len(), "Buffering reasoning chunk");
                                reasoning_buffer.push_str(&text);
                                last_message_event_at = Some(line_created_at);
                                last_message_event_seq = Some(raw_seq);
                            }
                            AcpEvent::ToolCall {
                                id,
                                name,
                                arguments,
                            } => {
                                // Buffer tool calls - persist with message complete
                                debug!(
                                    conversation_id = %conversation_id,
                                    tool_id = %id,
                                    tool_name = %name,
                                    "Buffering tool call"
                                );
                                if !message_buffer.is_empty() || !reasoning_buffer.is_empty() {
                                    if let Some(ref client) = callback_client {
                                        let mut msg_id = current_message_id.lock().await;
                                        if !reasoning_buffer.is_empty() {
                                            if let Some(new_id) = client
                                                .send_reasoning_chunk(
                                                    &conversation_id,
                                                    msg_id.as_deref(),
                                                    last_message_event_at,
                                                    last_message_event_seq,
                                                    &reasoning_buffer,
                                                )
                                                .await
                                            {
                                                if msg_id.is_none() {
                                                    *msg_id = Some(new_id);
                                                }
                                            }
                                        }
                                        if !message_buffer.is_empty() {
                                            if let Some(new_id) = client
                                                .send_text_chunk(
                                                    &conversation_id,
                                                    msg_id.as_deref(),
                                                    last_message_event_at,
                                                    last_message_event_seq,
                                                    &message_buffer,
                                                )
                                                .await
                                            {
                                                if msg_id.is_none() {
                                                    *msg_id = Some(new_id);
                                                }
                                            }
                                        }
                                        // Don't clear msg_id here - we want to keep it for tool calls
                                        // It will be cleared after message_complete
                                    }

                                    message_buffer.clear();
                                    reasoning_buffer.clear();
                                    last_message_event_at = None;
                                    last_message_event_seq = None;
                                }
                                pending_tool_calls.push((raw_seq, CallbackToolCall {
                                    id,
                                    name,
                                    arguments,
                                    status: CallbackToolCallStatus::Pending,
                                    result: None,
                                }));
                            }
                            AcpEvent::ToolCallUpdate { id, status, result } => {
                                // Update buffered tool call status
                                debug!(
                                    conversation_id = %conversation_id,
                                    tool_id = %id,
                                    status = %status,
                                    "Updating buffered tool call"
                                );
                                let tool_status =
                                    resolve_tool_call_status(&status, result.is_some());
                                let mut updated_pending = false;
                                if let Some((_, tc)) =
                                    pending_tool_calls.iter_mut().find(|(_, tc)| tc.id == id)
                                {
                                    tc.status = tool_status;
                                    if result.is_some() {
                                        tc.result = result.clone();
                                    }
                                    updated_pending = true;
                                }
                                if !updated_pending {
                                    if let Some(message_id) = recorded_tool_calls.get(&id) {
                                        if let Some(ref client) = callback_client {
                                            client
                                                .update_tool_call(
                                                    &conversation_id,
                                                    message_id,
                                                    &id,
                                                    tool_status,
                                                    result.clone(),
                                                )
                                                .await;
                                        }
                                    } else {
                                        debug!(
                                            conversation_id = %conversation_id,
                                            tool_id = %id,
                                            "Tool call update received before record"
                                        );
                                    }
                                }
                            }
                            AcpEvent::MessageComplete {
                                stop_reason,
                                content,
                            } => {
                                if let Some(text) = content {
                                    if message_buffer.is_empty() && !text.trim().is_empty() {
                                        message_buffer.push_str(&text);
                                        last_message_event_at = Some(line_created_at);
                                        last_message_event_seq = Some(raw_seq);
                                    }
                                }
                                if message_buffer.is_empty() && reasoning_buffer.is_empty() {
                                    let tool_outputs: Vec<String> = pending_tool_calls
                                        .iter()
                                        .filter_map(|(_, tool_call)| tool_call.result.as_ref())
                                        .map(|value| value.trim())
                                        .filter(|value| !value.is_empty())
                                        .map(|value| value.to_string())
                                        .collect();
                                    if !tool_outputs.is_empty() {
                                        message_buffer = tool_outputs.join("\n\n");
                                        last_message_event_at = Some(line_created_at);
                                        last_message_event_seq = Some(raw_seq);
                                    }
                                }
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
                                    let mut msg_id = current_message_id.lock().await;

                                    // Send buffered reasoning if any
                                    if !reasoning_buffer.is_empty() {
                                        if let Some(new_id) = client
                                            .send_reasoning_chunk(
                                                &conversation_id,
                                                msg_id.as_deref(),
                                                last_message_event_at,
                                                last_message_event_seq,
                                                &reasoning_buffer,
                                            )
                                            .await
                                        {
                                            if msg_id.is_none() {
                                                *msg_id = Some(new_id);
                                            }
                                        }
                                    }

                                    // Send buffered message text if any
                                    if !message_buffer.is_empty() {
                                        if let Some(new_id) = client
                                            .send_text_chunk(
                                                &conversation_id,
                                                msg_id.as_deref(),
                                                last_message_event_at,
                                                last_message_event_seq,
                                                &message_buffer,
                                            )
                                            .await
                                        {
                                            if msg_id.is_none() {
                                                *msg_id = Some(new_id);
                                            }
                                        }
                                    }

                                    // Send buffered tool calls
                                    for (seq, tool_call) in &pending_tool_calls {
                                        if let Some(ref msg) = *msg_id {
                                            client
                                                .record_tool_call(
                                                    &conversation_id,
                                                    msg,
                                                    Some(*seq),
                                                    tool_call.clone(),
                                                )
                                                .await;
                                            recorded_tool_calls
                                                .insert(tool_call.id.clone(), msg.clone());
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

                                    // Clear message ID for next turn
                                    *msg_id = None;
                                }

                                // Flush raw events after message boundary for timely replay
                                flush_raw_events(
                                    &callback_client,
                                    &conversation_id,
                                    &mut raw_events,
                                )
                                .await;
                                last_raw_flush = Instant::now();

                                // Clear buffers for next message turn
                                message_buffer.clear();
                                reasoning_buffer.clear();
                                pending_tool_calls.clear();
                                last_message_event_at = None;
                                last_message_event_seq = None;
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
                let mut msg_id = current_message_id.lock().await;
                if !reasoning_buffer.is_empty() {
                    if let Some(new_id) = client
                        .send_reasoning_chunk(
                            &conversation_id,
                            msg_id.as_deref(),
                            last_message_event_at,
                            last_message_event_seq,
                            &reasoning_buffer,
                        )
                        .await
                    {
                        if msg_id.is_none() {
                            *msg_id = Some(new_id);
                        }
                    }
                }
                if !message_buffer.is_empty() {
                    if let Some(new_id) = client
                        .send_text_chunk(
                            &conversation_id,
                            msg_id.as_deref(),
                            last_message_event_at,
                            last_message_event_seq,
                            &message_buffer,
                        )
                        .await
                    {
                        if msg_id.is_none() {
                            *msg_id = Some(new_id);
                        }
                    }
                }
                if let Some(ref id) = *msg_id {
                    client
                        .complete_message(&conversation_id, id, StopReason::EndTurn)
                        .await;
                }
            }
        }

        flush_raw_events(&callback_client, &conversation_id, &mut raw_events).await;
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
    /// Message completion with optional final content and stop reason
    MessageComplete {
        stop_reason: String,
        content: Option<String>,
    },
}

impl AcpEvent {
    fn event_type(&self) -> &'static str {
        match self {
            Self::MessageChunk(_) => "message_chunk",
            Self::ReasoningChunk(_) => "reasoning_chunk",
            Self::ToolCall { .. } => "tool_call",
            Self::ToolCallUpdate { .. } => "tool_call_update",
            Self::MessageComplete { .. } => "message_complete",
        }
    }
}

fn resolve_tool_call_status(
    raw_status: &str,
    has_result: bool,
) -> CallbackToolCallStatus {
    let normalized = raw_status.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "pending" => CallbackToolCallStatus::Pending,
        "running" | "in_progress" | "in-progress" => CallbackToolCallStatus::Running,
        "completed" | "complete" | "succeeded" | "success" => CallbackToolCallStatus::Completed,
        "failed" | "error" | "errored" | "cancelled" | "canceled" => {
            CallbackToolCallStatus::Failed
        }
        "unknown" if has_result => CallbackToolCallStatus::Completed,
        _ if has_result => CallbackToolCallStatus::Completed,
        _ => CallbackToolCallStatus::Pending,
    }
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
        let content_text = extract_text_from_result(result);
        if let Some(stop_reason) = result.get("stopReason").and_then(|s| s.as_str()) {
            return Some(AcpEvent::MessageComplete {
                stop_reason: stop_reason.to_string(),
                content: content_text,
            });
        }
        // Check for text in result.content (standard response)
        if let Some(text) = content_text {
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
                    // Parse tool call from update (Claude Code + Codex variants)
                    if let Some(id) = update
                        .get("toolCallId")
                        .or_else(|| update.get("id"))
                        .and_then(|v| v.as_str())
                    {
                        let name = update
                            .get("title")
                            .or_else(|| update.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let arguments = update
                            .get("rawInput")
                            .or_else(|| update.get("input"))
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
                    let id = update
                        .get("toolCallId")
                        .or_else(|| update.get("id"))
                        .and_then(|v| v.as_str());
                    let status = update
                        .get("status")
                        .or_else(|| update.get("fields").and_then(|f| f.get("status")))
                        .and_then(|v| v.as_str());
                    let result = update
                        .get("result")
                        .or_else(|| update.get("fields").and_then(|f| f.get("result")))
                        .and_then(|v| v.as_str());
                    let result = if result.is_some() {
                        result.map(|value| value.to_string())
                    } else {
                        extract_tool_output(update)
                    };
                    if let Some(id) = id {
                        return Some(AcpEvent::ToolCallUpdate {
                            id: id.to_string(),
                            status: status.unwrap_or("unknown").to_string(),
                            result,
                        });
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
    result
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Check if a JSON-RPC message is a permission request and generate a response.
/// Returns Some((request_id, response_json)) if it's a permission request, None otherwise.
fn handle_permission_request(line: &str) -> Option<(serde_json::Value, serde_json::Value)> {
    let json_value: serde_json::Value = serde_json::from_str(line).ok()?;

    // Check if this is a request (has "id" and "method")
    let id = json_value.get("id")?;
    let method = json_value.get("method").and_then(|m| m.as_str())?;

    if method != "session/request_permission" {
        return None;
    }

    // Auto-approve permission requests by selecting the first option
    let option_id = json_value
        .get("params")
        .and_then(|p| p.get("options"))
        .and_then(|o| o.as_array())
        .and_then(|arr| arr.first())
        .and_then(|opt| opt.get("optionId"))
        .and_then(|id| id.as_str())
        .unwrap_or("allow");

    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "outcome": {
                "outcome": "selected",
                "optionId": option_id
            }
        }
    });

    Some((id.clone(), response))
}

async fn flush_raw_events(
    callback_client: &Option<Arc<CallbackClient>>,
    conversation_id: &str,
    raw_events: &mut Vec<CallbackRawEvent>,
) {
    if raw_events.is_empty() {
        return;
    }

    if let Some(ref client) = callback_client {
        let events = std::mem::take(raw_events);
        client.record_raw_events(conversation_id, events).await;
    } else {
        warn!(
            conversation_id = %conversation_id,
            event_count = raw_events.len(),
            "Dropping raw events - callback client not configured"
        );
        raw_events.clear();
    }
}

/// Extract text from a content value (can be object or array).
fn extract_text_from_content(content: Option<&serde_json::Value>) -> Option<String> {
    let content = content?;

    // If content is a direct object with type: "text"
    if content.is_object() {
        let content_type = content.get("type").and_then(|t| t.as_str());
        if matches!(content_type, Some("text") | Some("output_text")) {
            return content
                .get("text")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
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

/// Extract tool output text from a tool_call_update payload.
fn extract_tool_output(update: &serde_json::Value) -> Option<String> {
    let stdout = update
        .get("_meta")
        .and_then(|meta| meta.get("claudeCode"))
        .and_then(|claude| claude.get("toolResponse"))
        .and_then(|tool_response| tool_response.get("stdout"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    if stdout.is_some() {
        return stdout;
    }

    let content = update.get("content")?;
    if let Some(arr) = content.as_array() {
        for item in arr {
            if let Some(nested) = item.get("content") {
                if let Some(text) = extract_text_from_content(Some(nested)) {
                    return Some(text);
                }
            }
            if let Some(text) = extract_text_from_content(Some(item)) {
                return Some(text);
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

/// Receive a JSON-RPC payload for a conversation.
///
/// This endpoint forwards arbitrary JSON-RPC messages to the running CLI.
#[utoipa::path(
    post,
    path = "/api/acp/rpc",
    request_body = RpcRequest,
    responses(
        (status = 200, description = "RPC accepted", body = RpcResponse),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "acp"
)]
pub async fn send_rpc(
    State(state): State<RestApiState>,
    Json(request): Json<RpcRequest>,
) -> Result<Json<RpcResponse>, (StatusCode, Json<ErrorResponse>)> {
    debug!(
        conversation_id = %request.conversation_id,
        "Received JSON-RPC payload for conversation"
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

    let mut payload = request.payload;
    let payload_obj = payload.as_object_mut().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "RPC payload must be an object".to_string(),
                code: Some("RPC_INVALID_PAYLOAD".to_string()),
            }),
        )
    })?;

    if !payload_obj.contains_key("jsonrpc") {
        payload_obj.insert(
            "jsonrpc".to_string(),
            serde_json::Value::String("2.0".to_string()),
        );
    }

    if let Some(method) = payload_obj.get("method").and_then(|v| v.as_str()) {
        const ALLOWED_METHODS: [&str; 2] = ["session/cancel", "session/set_model"];
        if !ALLOWED_METHODS.contains(&method) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("RPC method not allowed: {}", method),
                    code: Some("RPC_METHOD_NOT_ALLOWED".to_string()),
                }),
            ));
        }

        if let Some(params) = payload_obj.get_mut("params") {
            if let Some(params_obj) = params.as_object_mut() {
                if !params_obj.contains_key("sessionId") {
                    params_obj.insert(
                        "sessionId".to_string(),
                        serde_json::Value::String(acp_session_id.clone()),
                    );
                }
            }
        } else {
            payload_obj.insert(
                "params".to_string(),
                serde_json::Value::Object(serde_json::Map::from_iter([(
                    "sessionId".to_string(),
                    serde_json::Value::String(acp_session_id.clone()),
                )])),
            );
        }
    } else {
        let has_id = payload_obj.get("id").is_some();
        let has_result = payload_obj.get("result").is_some() || payload_obj.get("error").is_some();
        if !has_id || !has_result {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "RPC response must include id and result/error".to_string(),
                    code: Some("RPC_INVALID_RESPONSE".to_string()),
                }),
            ));
        }
    }

    // Send to CLI stdin
    let mut stdin = conversation.stdin.lock().await;
    if let Some(ref mut stdin_handle) = *stdin {
        let message = format!("{}\n", serde_json::to_string(&payload).unwrap_or_default());
        if let Err(e) = stdin_handle.write_all(message.as_bytes()).await {
            error!(
                conversation_id = %request.conversation_id,
                error = %e,
                "Failed to write RPC to CLI stdin"
            );
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: format!("Failed to send RPC to CLI: {}", e),
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

    Ok(Json(RpcResponse {
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
            .replace_all(
                &config_content,
                &format!(r#"base_url = "{}""#, openai_base_url),
            )
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
        stream_acp_events,
        init_conversation,
        receive_prompt,
        send_rpc,
    ),
    components(schemas(
        ContentBlock,
        ErrorResponse,
        InitConversationRequest,
        InitConversationResponse,
        PromptRequest,
        PromptResponse,
        RpcRequest,
        RpcResponse,
    )),
    tags(
        (name = "acp", description = "ACP sandbox control endpoints")
    )
)]
pub struct RestApiDoc;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handle_permission_request_valid() {
        let request = r#"{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"options":[{"kind":"allow_always","name":"Always Allow","optionId":"allow_always"},{"kind":"allow_once","name":"Allow","optionId":"allow"},{"kind":"reject_once","name":"Reject","optionId":"reject"}],"sessionId":"test-session","toolCall":{"toolCallId":"tool123","rawInput":{"command":"ls"},"title":"ls"}}}"#;

        let result = handle_permission_request(request);
        assert!(result.is_some());

        let (id, response) = result.unwrap();
        assert_eq!(id, serde_json::json!(0));

        // Check response structure
        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], 0);
        assert_eq!(response["result"]["outcome"]["outcome"], "selected");
        // Should select first option (allow_always)
        assert_eq!(response["result"]["outcome"]["optionId"], "allow_always");
    }

    #[test]
    fn test_handle_permission_request_fallback_option() {
        // Request with empty options array - should fallback to "allow"
        let request = r#"{"jsonrpc":"2.0","id":123,"method":"session/request_permission","params":{"options":[]}}"#;

        let result = handle_permission_request(request);
        assert!(result.is_some());

        let (_id, response) = result.unwrap();
        assert_eq!(response["result"]["outcome"]["optionId"], "allow");
    }

    #[test]
    fn test_handle_permission_request_not_permission_method() {
        let request = r#"{"jsonrpc":"2.0","id":1,"method":"session/update","params":{}}"#;

        let result = handle_permission_request(request);
        assert!(result.is_none());
    }

    #[test]
    fn test_handle_permission_request_notification_no_id() {
        // Notifications don't have an id field
        let request = r#"{"jsonrpc":"2.0","method":"session/request_permission","params":{}}"#;

        let result = handle_permission_request(request);
        assert!(result.is_none());
    }

    #[test]
    fn test_handle_permission_request_invalid_json() {
        let request = "not valid json";

        let result = handle_permission_request(request);
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_otel_config_storage() {
        let state = RestApiState::new();

        // Initially no OTel config
        let env_vars = state.get_cli_env_vars(None, None).await;
        assert!(!env_vars
            .iter()
            .any(|(k, _)| k == "OTEL_EXPORTER_OTLP_ENDPOINT"));

        // Configure OTel endpoint
        let _ = state
            .configure(
                "https://example.com/api/acp/callback".to_string(),
                "test-jwt".to_string(),
                "sandbox-123".to_string(),
                None, // api_proxy_url
                None, // stream_secret
                Some("https://example.com/api/otel/v1/traces".to_string()),
            )
            .await;

        // Now OTel env vars should be present (requires callback_client for JWT)
        let env_vars = state.get_cli_env_vars(Some("conv-123"), None).await;

        // Check OTEL env vars are set
        let endpoint = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_EXPORTER_OTLP_ENDPOINT");
        assert!(endpoint.is_some());
        assert_eq!(
            endpoint.unwrap().1,
            "https://example.com/api/otel/v1/traces"
        );

        let headers = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_EXPORTER_OTLP_HEADERS");
        assert!(headers.is_some());
        assert!(headers.unwrap().1.starts_with("Authorization=Bearer "));

        let attrs = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_RESOURCE_ATTRIBUTES");
        assert!(attrs.is_some());
        assert!(attrs.unwrap().1.contains("sandbox.id=sandbox-123"));
        assert!(attrs.unwrap().1.contains("conversation.id=conv-123"));

        let telemetry = env_vars
            .iter()
            .find(|(k, _)| k == "CLAUDE_CODE_ENABLE_TELEMETRY");
        assert!(telemetry.is_some());
        assert_eq!(telemetry.unwrap().1, "1");

        // Check OTEL_TRACES_EXPORTER is set (critical for trace export)
        let traces_exporter = env_vars.iter().find(|(k, _)| k == "OTEL_TRACES_EXPORTER");
        assert!(traces_exporter.is_some());
        assert_eq!(traces_exporter.unwrap().1, "otlp");

        // Check CLAUDE_CODE_ENHANCED_TELEMETRY_BETA is set (required for trace export)
        let enhanced_telemetry = env_vars
            .iter()
            .find(|(k, _)| k == "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA");
        assert!(enhanced_telemetry.is_some());
        assert_eq!(enhanced_telemetry.unwrap().1, "true");
    }

    #[tokio::test]
    async fn test_otel_env_vars_without_otel_config() {
        let state = RestApiState::new();

        // Configure WITHOUT OTel endpoint
        let _ = state
            .configure(
                "https://example.com/api/acp/callback".to_string(),
                "test-jwt".to_string(),
                "sandbox-456".to_string(),
                None, // api_proxy_url
                None, // stream_secret
                None, // otel_endpoint - NOT set
            )
            .await;

        // OTel env vars should NOT be present without otel_endpoint
        let env_vars = state.get_cli_env_vars(Some("conv-456"), None).await;

        let endpoint = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_EXPORTER_OTLP_ENDPOINT");
        assert!(endpoint.is_none());
    }

    #[tokio::test]
    async fn test_otel_conversation_id_in_resource_attributes() {
        let state = RestApiState::new();

        let _ = state
            .configure(
                "https://example.com/api/acp/callback".to_string(),
                "test-jwt".to_string(),
                "sandbox-789".to_string(),
                None,
                None,
                Some("https://example.com/api/otel/v1/traces".to_string()),
            )
            .await;

        // With conversation_id
        let env_vars = state.get_cli_env_vars(Some("my-conv-id"), None).await;
        let attrs = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_RESOURCE_ATTRIBUTES")
            .unwrap();
        assert!(attrs.1.contains("conversation.id=my-conv-id"));

        // Without conversation_id
        let env_vars_no_conv = state.get_cli_env_vars(None, None).await;
        let attrs_no_conv = env_vars_no_conv
            .iter()
            .find(|(k, _)| k == "OTEL_RESOURCE_ATTRIBUTES")
            .unwrap();
        assert!(!attrs_no_conv.1.contains("conversation.id="));
        assert!(attrs_no_conv.1.contains("sandbox.id=sandbox-789"));
    }

    #[tokio::test]
    async fn test_trace_context_propagation() {
        let state = RestApiState::new();

        // Configure OTel so resource attributes are populated
        let _ = state
            .configure(
                "https://example.com/api/acp/callback".to_string(),
                "test-jwt".to_string(),
                "sandbox-trace-test".to_string(),
                None, // api_proxy_url
                None, // stream_secret
                Some("https://example.com/api/otel/v1/traces".to_string()),
            )
            .await;

        let trace_ctx = TraceContext {
            trace_id: "0af7651916cd43dd8448eb211c80319c".to_string(),
            span_id: "b7ad6b7169203331".to_string(),
            trace_flags: Some(1),
        };

        // With trace context - verify TRACEPARENT env var
        let env_vars = state
            .get_cli_env_vars(Some("conv-123"), Some(&trace_ctx))
            .await;
        let traceparent = env_vars.iter().find(|(k, _)| k == "TRACEPARENT");
        assert!(traceparent.is_some());
        assert_eq!(
            traceparent.unwrap().1,
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        );

        // Verify trace context is added to OTEL_RESOURCE_ATTRIBUTES for correlation
        let attrs = env_vars
            .iter()
            .find(|(k, _)| k == "OTEL_RESOURCE_ATTRIBUTES")
            .unwrap();
        // Uses underscores so Axiom indexes these as flat searchable fields
        assert!(attrs
            .1
            .contains("parent_trace_id=0af7651916cd43dd8448eb211c80319c"));
        assert!(attrs.1.contains("parent_span_id=b7ad6b7169203331"));

        // Without trace context - no TRACEPARENT and no parent_* attributes
        let env_vars_no_trace = state.get_cli_env_vars(Some("conv-456"), None).await;
        let traceparent_none = env_vars_no_trace.iter().find(|(k, _)| k == "TRACEPARENT");
        assert!(traceparent_none.is_none());

        let attrs_no_trace = env_vars_no_trace
            .iter()
            .find(|(k, _)| k == "OTEL_RESOURCE_ATTRIBUTES")
            .unwrap();
        assert!(!attrs_no_trace.1.contains("parent_trace_id="));
        assert!(!attrs_no_trace.1.contains("parent_span_id="));
    }
}
