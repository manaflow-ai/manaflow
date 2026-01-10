//! WebSocket handler for ACP connections from iOS clients.

use std::io;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use tracing::{debug, error, info};

use super::agent::WrappedAgent;
use super::persistence::ConvexClient;
use super::spawner::{AcpProvider, IsolationMode};

/// State for the ACP server.
#[derive(Clone)]
pub struct AcpServerState {
    /// Convex URL for persistence
    pub convex_url: String,
    /// JWT secret for verification
    pub jwt_secret: String,
    /// Default working directory
    pub default_cwd: std::path::PathBuf,
}

impl AcpServerState {
    /// Create new ACP server state.
    pub fn new(convex_url: String, jwt_secret: String, default_cwd: std::path::PathBuf) -> Self {
        Self {
            convex_url,
            jwt_secret,
            default_cwd,
        }
    }
}

/// Conversation token payload.
#[derive(Debug, Clone)]
pub struct ConversationTokenPayload {
    pub conversation_id: String,
    pub team_id: String,
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

    let provider = extract_provider(&query);
    let isolation = extract_isolation(&query);

    ws.on_upgrade(move |socket| handle_acp_connection(socket, state, jwt, provider, isolation))
}

/// Handle an ACP WebSocket connection.
async fn handle_acp_connection(
    socket: WebSocket,
    state: AcpServerState,
    jwt: Option<String>,
    provider: AcpProvider,
    isolation: IsolationMode,
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

    // Create Convex client
    let convex_client = ConvexClient::new(&state.convex_url);

    // Create wrapped agent
    let agent = Arc::new(WrappedAgent::new(
        convex_client,
        token_payload.conversation_id.clone(),
        provider,
        isolation,
        state.default_cwd.clone(),
        vec![], // TODO: Add env vars
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

    // Split WebSocket
    let (mut ws_write, mut ws_read) = socket.split();

    // Create channels for bidirectional communication
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Spawn writer task
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Err(e) = ws_write.send(msg).await {
                error!(error = %e, "Failed to send WebSocket message");
                break;
            }
        }
    });

    // Read loop
    while let Some(result) = ws_read.next().await {
        match result {
            Ok(Message::Binary(data)) => {
                let msg = String::from_utf8_lossy(&data);
                debug!(message = %msg, "Received ACP message");

                // TODO: Parse JSON-RPC message and route to agent
                // For now, echo back
                if let Err(e) = tx.send(Message::Binary(data)) {
                    error!(error = %e, "Failed to queue response");
                    break;
                }
            }
            Ok(Message::Text(text)) => {
                debug!(message = %text, "Received ACP text message");

                // TODO: Parse JSON-RPC message and route to agent
                if let Err(e) = tx.send(Message::Text(text)) {
                    error!(error = %e, "Failed to queue response");
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                info!(
                    conversation_id = %token_payload.conversation_id,
                    "WebSocket closed"
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

    // Clean up
    drop(tx);
    let _ = write_task.await;

    info!(
        conversation_id = %token_payload.conversation_id,
        "ACP connection closed"
    );
}

/// WebSocket reader wrapper for ACP protocol.
pub struct WsRead {
    stream: futures::stream::SplitStream<axum::extract::ws::WebSocket>,
}

impl tokio::io::AsyncRead for WsRead {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        loop {
            match futures::ready!(self.stream.poll_next_unpin(cx)) {
                Some(Ok(Message::Binary(data))) => {
                    buf.put_slice(&data);
                    return std::task::Poll::Ready(Ok(()));
                }
                Some(Ok(Message::Text(data))) => {
                    buf.put_slice(data.as_bytes());
                    return std::task::Poll::Ready(Ok(()));
                }
                Some(Ok(Message::Close(_))) | None => {
                    return std::task::Poll::Ready(Ok(()));
                }
                Some(Err(e)) => {
                    return std::task::Poll::Ready(Err(io::Error::other(e)));
                }
                _ => continue,
            }
        }
    }
}

/// WebSocket writer wrapper for ACP protocol.
pub struct WsWrite {
    sink: futures::stream::SplitSink<axum::extract::ws::WebSocket, Message>,
}

impl tokio::io::AsyncWrite for WsWrite {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<io::Result<usize>> {
        match self
            .sink
            .start_send_unpin(Message::Binary(Bytes::copy_from_slice(buf)))
        {
            Ok(_) => {
                let _ = self.sink.poll_flush_unpin(cx);
                std::task::Poll::Ready(Ok(buf.len()))
            }
            Err(e) => std::task::Poll::Ready(Err(io::Error::other(e))),
        }
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        self.sink.poll_flush_unpin(cx).map_err(io::Error::other)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<io::Result<()>> {
        self.sink.poll_close_unpin(cx).map_err(io::Error::other)
    }
}
