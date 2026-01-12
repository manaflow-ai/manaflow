//! REST API endpoints for ACP conversation management.
//!
//! Provides HTTP endpoints for creating and managing conversations.
//! The actual ACP protocol communication happens over WebSocket.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{debug, error};
use utoipa::{OpenApi, ToSchema};

/// State for REST API handlers.
#[derive(Clone)]
pub struct RestApiState {
    /// HTTP client for Convex requests
    http_client: Client,
    /// Convex URL
    convex_url: String,
    /// Convex admin key
    admin_key: String,
}

impl RestApiState {
    /// Create new REST API state.
    pub fn new(convex_url: String, admin_key: String) -> Self {
        Self {
            http_client: Client::new(),
            convex_url,
            admin_key,
        }
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

/// Provider ID for coding CLIs.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    /// Claude Code
    Claude,
    /// OpenAI Codex CLI
    Codex,
    /// Google Gemini CLI
    Gemini,
    /// Opencode multi-provider CLI
    Opencode,
}

impl std::fmt::Display for ProviderId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderId::Claude => write!(f, "claude"),
            ProviderId::Codex => write!(f, "codex"),
            ProviderId::Gemini => write!(f, "gemini"),
            ProviderId::Opencode => write!(f, "opencode"),
        }
    }
}

/// Isolation mode for conversation sandboxing.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IsolationMode {
    /// No isolation, run directly in container
    None,
    /// Shared bubblewrap namespace
    SharedNamespace,
    /// Dedicated bubblewrap namespace
    DedicatedNamespace,
}

/// Conversation status.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ConversationStatus {
    /// Conversation is active
    Active,
    /// Conversation completed normally
    Completed,
    /// Conversation was cancelled
    Cancelled,
    /// Conversation encountered an error
    Error,
}

/// Request to create a new conversation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateConversationRequest {
    /// Team ID (Convex document ID)
    #[serde(rename = "teamId")]
    pub team_id: String,
    /// Provider to use (claude, codex, gemini, opencode)
    #[serde(rename = "providerId")]
    pub provider_id: ProviderId,
    /// Working directory for the CLI
    pub cwd: String,
    /// Isolation mode (optional, defaults to none)
    #[serde(rename = "isolationMode")]
    pub isolation_mode: Option<IsolationMode>,
    /// Namespace ID for shared isolation (optional)
    #[serde(rename = "namespaceId")]
    pub namespace_id: Option<String>,
    /// Sandbox instance ID (optional)
    #[serde(rename = "sandboxInstanceId")]
    pub sandbox_instance_id: Option<String>,
}

/// Response from creating a conversation.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateConversationResponse {
    /// Conversation ID
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    /// JWT token for WebSocket authentication
    pub jwt: String,
    /// WebSocket URL for ACP connection
    #[serde(rename = "websocketUrl")]
    pub websocket_url: String,
}

/// Agent info from the CLI.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AgentInfo {
    /// Agent name (e.g., "@zed-industries/claude-code-acp")
    pub name: String,
    /// Agent version
    pub version: String,
    /// Agent title (optional)
    pub title: Option<String>,
}

/// Mode information.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ModeInfo {
    /// Mode ID
    pub id: String,
    /// Mode name
    pub name: String,
    /// Mode description
    pub description: Option<String>,
}

/// Modes configuration.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ModesConfig {
    /// Current mode ID
    #[serde(rename = "currentModeId")]
    pub current_mode_id: String,
    /// Available modes
    #[serde(rename = "availableModes")]
    pub available_modes: Vec<ModeInfo>,
}

/// Conversation details.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Conversation {
    /// Conversation ID
    #[serde(rename = "_id")]
    pub id: String,
    /// Team ID
    #[serde(rename = "teamId")]
    pub team_id: String,
    /// User ID (optional)
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    /// Session ID
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// Provider ID
    #[serde(rename = "providerId")]
    pub provider_id: String,
    /// Working directory
    pub cwd: String,
    /// Status
    pub status: String,
    /// Stop reason (if completed)
    #[serde(rename = "stopReason", skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    /// Isolation mode
    #[serde(rename = "isolationMode", skip_serializing_if = "Option::is_none")]
    pub isolation_mode: Option<String>,
    /// Namespace ID
    #[serde(rename = "namespaceId", skip_serializing_if = "Option::is_none")]
    pub namespace_id: Option<String>,
    /// Sandbox instance ID
    #[serde(rename = "sandboxInstanceId", skip_serializing_if = "Option::is_none")]
    pub sandbox_instance_id: Option<String>,
    /// Agent info
    #[serde(rename = "agentInfo", skip_serializing_if = "Option::is_none")]
    pub agent_info: Option<AgentInfo>,
    /// Modes configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<ModesConfig>,
    /// Created timestamp (ms)
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    /// Updated timestamp (ms)
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
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

/// Tool call in a message.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ToolCall {
    /// Tool call ID
    pub id: String,
    /// Tool name
    pub name: String,
    /// Arguments (JSON string)
    pub arguments: String,
    /// Status
    pub status: String,
    /// Result (optional)
    pub result: Option<String>,
}

/// Message in a conversation.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Message {
    /// Message ID
    #[serde(rename = "_id")]
    pub id: String,
    /// Conversation ID
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    /// Role (user or assistant)
    pub role: String,
    /// Content blocks
    pub content: Vec<serde_json::Value>,
    /// Tool calls (optional)
    #[serde(rename = "toolCalls", skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Created timestamp (ms)
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

/// Query parameters for listing conversations.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ListConversationsQuery {
    /// Team slug or ID
    #[serde(rename = "teamSlugOrId")]
    pub team_slug_or_id: String,
    /// Filter by status (optional)
    pub status: Option<String>,
    /// Maximum number of results (default: 50)
    pub limit: Option<i32>,
}

/// Query parameters for listing messages.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ListMessagesQuery {
    /// Team slug or ID
    #[serde(rename = "teamSlugOrId")]
    pub team_slug_or_id: String,
    /// Maximum number of results (default: 100)
    pub limit: Option<i32>,
}

/// Convex API response wrapper.
#[derive(Debug, Deserialize)]
struct ConvexResponse<T> {
    status: String,
    value: Option<T>,
    #[serde(rename = "errorMessage")]
    error_message: Option<String>,
}

impl RestApiState {
    /// Call a Convex mutation.
    async fn call_mutation<T: serde::de::DeserializeOwned>(
        &self,
        function_path: &str,
        args: serde_json::Value,
    ) -> Result<T, (StatusCode, ErrorResponse)> {
        let url = format!("{}/api/mutation", self.convex_url);

        debug!(function = %function_path, "Calling Convex mutation");

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Convex {}", self.admin_key))
            .json(&json!({
                "path": function_path,
                "args": args,
            }))
            .send()
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to call Convex");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorResponse {
                        error: format!("Failed to call Convex: {}", e),
                        code: Some("CONVEX_ERROR".to_string()),
                    },
                )
            })?;

        let body: ConvexResponse<T> = response.json().await.map_err(|e| {
            error!(error = %e, "Failed to parse Convex response");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: format!("Failed to parse Convex response: {}", e),
                    code: Some("PARSE_ERROR".to_string()),
                },
            )
        })?;

        if body.status != "success" {
            let error_msg = body
                .error_message
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err((
                StatusCode::BAD_REQUEST,
                ErrorResponse {
                    error: error_msg,
                    code: Some("CONVEX_ERROR".to_string()),
                },
            ));
        }

        body.value.ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: "No value in response".to_string(),
                    code: Some("NO_VALUE".to_string()),
                },
            )
        })
    }

    /// Call a Convex query.
    async fn call_query<T: serde::de::DeserializeOwned>(
        &self,
        function_path: &str,
        args: serde_json::Value,
    ) -> Result<T, (StatusCode, ErrorResponse)> {
        let url = format!("{}/api/query", self.convex_url);

        debug!(function = %function_path, "Calling Convex query");

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Convex {}", self.admin_key))
            .json(&json!({
                "path": function_path,
                "args": args,
            }))
            .send()
            .await
            .map_err(|e| {
                error!(error = %e, "Failed to call Convex");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorResponse {
                        error: format!("Failed to call Convex: {}", e),
                        code: Some("CONVEX_ERROR".to_string()),
                    },
                )
            })?;

        let body: ConvexResponse<T> = response.json().await.map_err(|e| {
            error!(error = %e, "Failed to parse Convex response");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: format!("Failed to parse Convex response: {}", e),
                    code: Some("PARSE_ERROR".to_string()),
                },
            )
        })?;

        if body.status != "success" {
            let error_msg = body
                .error_message
                .unwrap_or_else(|| "Unknown error".to_string());
            return Err((
                StatusCode::BAD_REQUEST,
                ErrorResponse {
                    error: error_msg,
                    code: Some("CONVEX_ERROR".to_string()),
                },
            ));
        }

        body.value.ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse {
                    error: "No value in response".to_string(),
                    code: Some("NO_VALUE".to_string()),
                },
            )
        })
    }
}

/// Create a new conversation.
#[utoipa::path(
    post,
    path = "/api/conversations",
    request_body = CreateConversationRequest,
    responses(
        (status = 201, description = "Conversation created", body = CreateConversationResponse),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "conversations"
)]
pub async fn create_conversation(
    headers: HeaderMap,
    State(state): State<RestApiState>,
    Json(request): Json<CreateConversationRequest>,
) -> Result<(StatusCode, Json<CreateConversationResponse>), (StatusCode, Json<ErrorResponse>)> {
    // Generate a session ID
    let session_id = uuid::Uuid::new_v4().to_string();

    // Build args struct to properly skip None values during serialization
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CreateArgs {
        team_id: String,
        session_id: String,
        provider_id: String,
        cwd: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        isolation_mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        namespace_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        sandbox_instance_id: Option<String>,
    }

    let args = serde_json::to_value(CreateArgs {
        team_id: request.team_id.clone(),
        session_id,
        provider_id: request.provider_id.to_string(),
        cwd: request.cwd.clone(),
        isolation_mode: request.isolation_mode.as_ref().map(|m| match m {
            IsolationMode::None => "none".to_string(),
            IsolationMode::SharedNamespace => "shared_namespace".to_string(),
            IsolationMode::DedicatedNamespace => "dedicated_namespace".to_string(),
        }),
        namespace_id: request.namespace_id.clone(),
        sandbox_instance_id: request.sandbox_instance_id.clone(),
    })
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to serialize request: {}", e),
                code: Some("SERIALIZE_ERROR".to_string()),
            }),
        )
    })?;

    #[derive(Deserialize)]
    struct CreateResult {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        jwt: String,
    }

    let result: CreateResult = state
        .call_mutation("conversations:createInternal", args)
        .await
        .map_err(|(status, e)| (status, Json(e)))?;

    // Construct WebSocket URL from the incoming Host header
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost");
    let websocket_url = format!("ws://{}/api/acp", host);

    Ok((
        StatusCode::CREATED,
        Json(CreateConversationResponse {
            conversation_id: result.conversation_id,
            jwt: result.jwt,
            websocket_url,
        }),
    ))
}

/// List conversations for a team.
#[utoipa::path(
    get,
    path = "/api/conversations",
    params(
        ("teamSlugOrId" = String, Query, description = "Team slug or ID"),
        ("status" = Option<String>, Query, description = "Filter by status"),
        ("limit" = Option<i32>, Query, description = "Maximum results")
    ),
    responses(
        (status = 200, description = "List of conversations", body = Vec<Conversation>),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "conversations"
)]
pub async fn list_conversations(
    State(state): State<RestApiState>,
    Query(query): Query<ListConversationsQuery>,
) -> Result<Json<Vec<Conversation>>, (StatusCode, Json<ErrorResponse>)> {
    let args = json!({
        "teamSlugOrId": query.team_slug_or_id,
        "status": query.status,
        "limit": query.limit,
    });

    let conversations: Vec<Conversation> = state
        .call_query("conversations:list", args)
        .await
        .map_err(|(status, e)| (status, Json(e)))?;

    Ok(Json(conversations))
}

/// Get a conversation by ID.
#[utoipa::path(
    get,
    path = "/api/conversations/{conversation_id}",
    params(
        ("conversation_id" = String, Path, description = "Conversation ID"),
        ("teamSlugOrId" = String, Query, description = "Team slug or ID")
    ),
    responses(
        (status = 200, description = "Conversation details", body = Conversation),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "conversations"
)]
pub async fn get_conversation(
    State(state): State<RestApiState>,
    Path(conversation_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<Conversation>, (StatusCode, Json<ErrorResponse>)> {
    let args = json!({
        "teamSlugOrId": query.team_slug_or_id,
        "conversationId": conversation_id,
    });

    let conversation: Option<Conversation> = state
        .call_query("conversations:getById", args)
        .await
        .map_err(|(status, e)| (status, Json(e)))?;

    match conversation {
        Some(c) => Ok(Json(c)),
        None => Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Conversation not found".to_string(),
                code: Some("NOT_FOUND".to_string()),
            }),
        )),
    }
}

/// Get messages for a conversation.
#[utoipa::path(
    get,
    path = "/api/conversations/{conversation_id}/messages",
    params(
        ("conversation_id" = String, Path, description = "Conversation ID"),
        ("teamSlugOrId" = String, Query, description = "Team slug or ID"),
        ("limit" = Option<i32>, Query, description = "Maximum results")
    ),
    responses(
        (status = 200, description = "List of messages", body = Vec<Message>),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "conversations"
)]
pub async fn get_conversation_messages(
    State(state): State<RestApiState>,
    Path(conversation_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<Vec<Message>>, (StatusCode, Json<ErrorResponse>)> {
    let args = json!({
        "teamSlugOrId": query.team_slug_or_id,
        "conversationId": conversation_id,
        "limit": query.limit,
    });

    let messages: Vec<Message> = state
        .call_query("conversationMessages:listByConversation", args)
        .await
        .map_err(|(status, e)| (status, Json(e)))?;

    Ok(Json(messages))
}

/// Generate a new JWT for an existing conversation.
#[utoipa::path(
    post,
    path = "/api/conversations/{conversation_id}/jwt",
    params(
        ("conversation_id" = String, Path, description = "Conversation ID")
    ),
    responses(
        (status = 200, description = "New JWT generated", body = CreateConversationResponse),
        (status = 404, description = "Conversation not found", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse)
    ),
    tag = "conversations"
)]
pub async fn refresh_conversation_jwt(
    headers: HeaderMap,
    State(state): State<RestApiState>,
    Path(conversation_id): Path<String>,
) -> Result<Json<CreateConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    let args = json!({
        "conversationId": conversation_id,
    });

    #[derive(Deserialize)]
    struct JwtResult {
        jwt: String,
    }

    let result: JwtResult = state
        .call_mutation("conversations:generateJwt", args)
        .await
        .map_err(|(status, e)| (status, Json(e)))?;

    // Construct WebSocket URL from the incoming Host header
    let host = headers
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost");
    let websocket_url = format!("ws://{}/api/acp", host);

    Ok(Json(CreateConversationResponse {
        conversation_id,
        jwt: result.jwt,
        websocket_url,
    }))
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
    State(_state): State<RestApiState>,
    Json(request): Json<InitConversationRequest>,
) -> Result<Json<InitConversationResponse>, (StatusCode, Json<ErrorResponse>)> {
    debug!(
        conversation_id = %request.conversation_id,
        session_id = %request.session_id,
        provider_id = %request.provider_id,
        cwd = %request.cwd,
        "Initializing conversation on sandbox"
    );

    // TODO: Implement actual CLI spawning and state management
    // For now, just acknowledge the init request
    // The actual implementation will:
    // 1. Parse provider_id to AcpProvider
    // 2. Spawn the CLI process
    // 3. Store conversation state in a shared map
    // 4. Return success

    // Validate provider ID
    match request.provider_id.to_lowercase().as_str() {
        "claude" | "codex" | "gemini" | "opencode" => {}
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: format!("Unknown provider: {}", request.provider_id),
                    code: Some("UNKNOWN_PROVIDER".to_string()),
                }),
            ));
        }
    }

    // For now, just return success
    // Real implementation will store conversation state and spawn CLI
    Ok(Json(InitConversationResponse {
        success: true,
        error: None,
    }))
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
    State(_state): State<RestApiState>,
    Json(request): Json<PromptRequest>,
) -> Result<Json<PromptResponse>, (StatusCode, Json<ErrorResponse>)> {
    debug!(
        conversation_id = %request.conversation_id,
        session_id = %request.session_id,
        content_blocks = %request.content.len(),
        "Received prompt for conversation"
    );

    // TODO: Implement actual prompt forwarding
    // For now, just acknowledge the prompt
    // The actual implementation will:
    // 1. Look up conversation state by ID
    // 2. Format content as ACP message
    // 3. Send to CLI stdin
    // 4. CLI responses flow back via callback client
    // 5. Return immediately

    // For now, just return accepted
    Ok(Json(PromptResponse {
        accepted: true,
        error: None,
    }))
}

/// OpenAPI documentation for REST API endpoints.
#[derive(OpenApi)]
#[openapi(
    paths(
        create_conversation,
        list_conversations,
        get_conversation,
        get_conversation_messages,
        refresh_conversation_jwt,
        init_conversation,
        receive_prompt,
    ),
    components(schemas(
        CreateConversationRequest,
        CreateConversationResponse,
        Conversation,
        Message,
        ContentBlock,
        ToolCall,
        AgentInfo,
        ModeInfo,
        ModesConfig,
        ProviderId,
        IsolationMode,
        ErrorResponse,
        ConversationStatus,
        InitConversationRequest,
        InitConversationResponse,
        PromptRequest,
        PromptResponse,
    )),
    tags(
        (name = "conversations", description = "Conversation management endpoints"),
        (name = "acp", description = "ACP sandbox control endpoints")
    )
)]
pub struct RestApiDoc;
