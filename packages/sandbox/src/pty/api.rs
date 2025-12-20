//! PTY API routes
//!
//! REST endpoints for managing PTY sessions within sandboxes.

use super::types::{
    CapturePtyResponse, CreatePtyRequest, InputPtyRequest, PtyInfo, ResizePtyRequest,
    UpdatePtyRequest,
};
use super::PtyState;
use crate::errors::{ErrorBody, SandboxError, SandboxResult};
use crate::service::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::{error, info, warn};

/// Build PTY routes for sandbox-scoped sessions
pub fn pty_routes() -> Router<AppState> {
    Router::new()
        // Sandbox-scoped PTY routes
        .route(
            "/sandboxes/{sandbox_id}/sessions",
            get(list_sandbox_sessions).post(create_sandbox_session),
        )
        .route(
            "/sandboxes/{sandbox_id}/sessions/{session_id}",
            get(get_session)
                .delete(delete_session)
                .patch(update_session),
        )
        .route(
            "/sandboxes/{sandbox_id}/sessions/{session_id}/input",
            post(send_input),
        )
        .route(
            "/sandboxes/{sandbox_id}/sessions/{session_id}/resize",
            post(resize_session),
        )
        .route(
            "/sandboxes/{sandbox_id}/sessions/{session_id}/capture",
            get(capture_session),
        )
        .route(
            "/sandboxes/{sandbox_id}/sessions/{session_id}/ws",
            any(session_websocket),
        )
        // Top-level PTY routes (for host-namespace sessions, e.g., development)
        .route(
            "/sessions",
            get(list_all_sessions).post(create_host_session),
        )
        .route(
            "/sessions/{session_id}",
            get(get_session_by_id)
                .delete(delete_session_by_id)
                .patch(update_session_by_id),
        )
        .route("/sessions/{session_id}/input", post(send_input_by_id))
        .route("/sessions/{session_id}/resize", post(resize_session_by_id))
        .route("/sessions/{session_id}/capture", get(capture_session_by_id))
        .route("/sessions/{session_id}/ws", any(session_websocket_by_id))
        // Event WebSocket (broadcasts all PTY events)
        .route("/ws", any(events_websocket))
}

// =============================================================================
// Sandbox-scoped handlers
// =============================================================================

/// List PTY sessions for a specific sandbox
#[utoipa::path(
    get,
    path = "/sandboxes/{sandbox_id}/sessions",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID")
    ),
    responses(
        (status = 200, description = "List of PTY sessions in sandbox", body = [PtyInfo])
    )
)]
pub async fn list_sandbox_sessions(
    State(state): State<AppState>,
    Path(sandbox_id): Path<String>,
) -> Json<Vec<PtyInfo>> {
    Json(state.pty_state.get_ordered_sessions(Some(&sandbox_id)))
}

/// Create a PTY session in a sandbox
#[utoipa::path(
    post,
    path = "/sandboxes/{sandbox_id}/sessions",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID")
    ),
    request_body = CreatePtyRequest,
    responses(
        (status = 201, description = "PTY session created in sandbox", body = PtyInfo),
        (status = 400, description = "Sandbox not found", body = ErrorBody),
        (status = 500, description = "Internal error", body = ErrorBody)
    )
)]
pub async fn create_sandbox_session(
    State(state): State<AppState>,
    Path(sandbox_id): Path<String>,
    Json(request): Json<CreatePtyRequest>,
) -> SandboxResult<(StatusCode, Json<PtyInfo>)> {
    // Get sandbox PID for nsenter
    let sandbox_pid = state
        .service
        .get_sandbox_pid(sandbox_id.clone())
        .await
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Sandbox not found: {}", sandbox_id))
        })?;

    let info = state
        .pty_state
        .create_session(&request, Some(sandbox_id), Some(sandbox_pid))
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok((StatusCode::CREATED, Json(info)))
}

/// Get a PTY session
#[utoipa::path(
    get,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn get_session(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
) -> SandboxResult<Json<PtyInfo>> {
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    Ok(Json(session.to_info()))
}

/// Delete a PTY session
#[utoipa::path(
    delete,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "Deleted PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found or not in sandbox", body = ErrorBody)
    )
)]
pub async fn delete_session(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
) -> SandboxResult<Json<PtyInfo>> {
    // Verify session belongs to sandbox
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    if session.sandbox_id.as_deref() != Some(&sandbox_id) {
        return Err(SandboxError::InvalidRequest(format!(
            "Session {} not in sandbox {}",
            session_id, sandbox_id
        )));
    }

    let info = state.pty_state.delete_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    Ok(Json(info))
}

/// Update a PTY session
#[utoipa::path(
    patch,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = UpdatePtyRequest,
    responses(
        (status = 200, description = "Updated PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn update_session(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
    Json(request): Json<UpdatePtyRequest>,
) -> SandboxResult<Json<PtyInfo>> {
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    if let Some(name) = request.name {
        session.set_name(name);
    }
    if let Some(index) = request.index {
        session.set_index(index);
    }
    if let Some(metadata) = request.metadata {
        session.merge_metadata(metadata);
    }

    Ok(Json(session.to_info()))
}

/// Send input to a PTY session
#[utoipa::path(
    post,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}/input",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = InputPtyRequest,
    responses(
        (status = 204, description = "Input sent"),
        (status = 400, description = "Session not found", body = ErrorBody),
        (status = 500, description = "Failed to write input", body = ErrorBody)
    )
)]
pub async fn send_input(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
    Json(request): Json<InputPtyRequest>,
) -> SandboxResult<StatusCode> {
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    session
        .write_input(&request.data)
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Resize a PTY session
#[utoipa::path(
    post,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}/resize",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = ResizePtyRequest,
    responses(
        (status = 204, description = "PTY resized"),
        (status = 400, description = "Session not found", body = ErrorBody),
        (status = 500, description = "Failed to resize", body = ErrorBody)
    )
)]
pub async fn resize_session(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
    Json(request): Json<ResizePtyRequest>,
) -> SandboxResult<StatusCode> {
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    session
        .resize(request.cols, request.rows)
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Capture PTY screen content
#[utoipa::path(
    get,
    path = "/sandboxes/{sandbox_id}/sessions/{session_id}/capture",
    tag = "pty",
    params(
        ("sandbox_id" = String, Path, description = "Sandbox ID"),
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "Screen content captured", body = CapturePtyResponse),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn capture_session(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
) -> SandboxResult<Json<CapturePtyResponse>> {
    let session = state
        .pty_state
        .get_session_for_sandbox(&session_id, Some(&sandbox_id))
        .ok_or_else(|| {
            SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
        })?;

    Ok(Json(CapturePtyResponse {
        content: session.get_scrollback(),
    }))
}

/// WebSocket for PTY terminal I/O
async fn session_websocket(
    State(state): State<AppState>,
    Path((sandbox_id, session_id)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let pty_state = state.pty_state.clone();
    ws.on_upgrade(move |socket| {
        handle_session_websocket(socket, pty_state, session_id, Some(sandbox_id))
    })
}

// =============================================================================
// Top-level (host namespace) handlers
// =============================================================================

/// List all PTY sessions
#[utoipa::path(
    get,
    path = "/sessions",
    tag = "pty",
    responses(
        (status = 200, description = "List of all PTY sessions", body = [PtyInfo])
    )
)]
pub async fn list_all_sessions(State(state): State<AppState>) -> Json<Vec<PtyInfo>> {
    Json(state.pty_state.get_ordered_sessions(None))
}

/// Create a PTY session in host namespace
#[utoipa::path(
    post,
    path = "/sessions",
    tag = "pty",
    request_body = CreatePtyRequest,
    responses(
        (status = 201, description = "PTY session created", body = PtyInfo),
        (status = 500, description = "Internal error", body = ErrorBody)
    )
)]
pub async fn create_host_session(
    State(state): State<AppState>,
    Json(request): Json<CreatePtyRequest>,
) -> SandboxResult<(StatusCode, Json<PtyInfo>)> {
    let info = state
        .pty_state
        .create_session(&request, None, None)
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok((StatusCode::CREATED, Json(info)))
}

/// Get a session by ID (any sandbox)
#[utoipa::path(
    get,
    path = "/sessions/{session_id}",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn get_session_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> SandboxResult<Json<PtyInfo>> {
    let session = state.pty_state.get_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    Ok(Json(session.to_info()))
}

/// Delete a session by ID
#[utoipa::path(
    delete,
    path = "/sessions/{session_id}",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "Deleted PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn delete_session_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> SandboxResult<Json<PtyInfo>> {
    let info = state.pty_state.delete_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    Ok(Json(info))
}

/// Update a session by ID
#[utoipa::path(
    patch,
    path = "/sessions/{session_id}",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = UpdatePtyRequest,
    responses(
        (status = 200, description = "Updated PTY session info", body = PtyInfo),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn update_session_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<UpdatePtyRequest>,
) -> SandboxResult<Json<PtyInfo>> {
    let session = state.pty_state.get_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    if let Some(name) = request.name {
        session.set_name(name);
    }
    if let Some(index) = request.index {
        session.set_index(index);
    }
    if let Some(metadata) = request.metadata {
        session.merge_metadata(metadata);
    }

    Ok(Json(session.to_info()))
}

/// Send input by session ID
#[utoipa::path(
    post,
    path = "/sessions/{session_id}/input",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = InputPtyRequest,
    responses(
        (status = 204, description = "Input sent"),
        (status = 400, description = "Session not found", body = ErrorBody),
        (status = 500, description = "Failed to write input", body = ErrorBody)
    )
)]
pub async fn send_input_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<InputPtyRequest>,
) -> SandboxResult<StatusCode> {
    let session = state.pty_state.get_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    session
        .write_input(&request.data)
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Resize by session ID
#[utoipa::path(
    post,
    path = "/sessions/{session_id}/resize",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    request_body = ResizePtyRequest,
    responses(
        (status = 204, description = "PTY resized"),
        (status = 400, description = "Session not found", body = ErrorBody),
        (status = 500, description = "Failed to resize", body = ErrorBody)
    )
)]
pub async fn resize_session_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(request): Json<ResizePtyRequest>,
) -> SandboxResult<StatusCode> {
    let session = state.pty_state.get_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    session
        .resize(request.cols, request.rows)
        .map_err(|e| SandboxError::Internal(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Capture by session ID
#[utoipa::path(
    get,
    path = "/sessions/{session_id}/capture",
    tag = "pty",
    params(
        ("session_id" = String, Path, description = "PTY session ID")
    ),
    responses(
        (status = 200, description = "Screen content captured", body = CapturePtyResponse),
        (status = 400, description = "Session not found", body = ErrorBody)
    )
)]
pub async fn capture_session_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> SandboxResult<Json<CapturePtyResponse>> {
    let session = state.pty_state.get_session(&session_id).ok_or_else(|| {
        SandboxError::InvalidRequest(format!("Session not found: {}", session_id))
    })?;

    Ok(Json(CapturePtyResponse {
        content: session.get_scrollback(),
    }))
}

/// WebSocket by session ID
async fn session_websocket_by_id(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let pty_state = state.pty_state.clone();
    ws.on_upgrade(move |socket| handle_session_websocket(socket, pty_state, session_id, None))
}

/// Events WebSocket - broadcasts all PTY events
async fn events_websocket(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let pty_state = state.pty_state.clone();
    ws.on_upgrade(move |socket| handle_events_websocket(socket, pty_state))
}

// =============================================================================
// WebSocket handlers
// =============================================================================

/// Handle a session WebSocket connection (terminal I/O)
async fn handle_session_websocket(
    socket: WebSocket,
    pty_state: Arc<PtyState>,
    session_id: String,
    sandbox_id: Option<String>,
) {
    let session = match pty_state.get_session_for_sandbox(&session_id, sandbox_id.as_deref()) {
        Some(s) => s,
        None => {
            warn!("WebSocket connection for unknown session: {}", session_id);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut output_rx = session.output_tx.subscribe();

    info!("[ws:{}] Session WebSocket connected", session_id);

    // Send current scrollback
    let scrollback = session.get_scrollback();
    if !scrollback.is_empty() {
        if let Err(e) = ws_sender.send(Message::Text(scrollback.into())).await {
            error!("[ws:{}] Failed to send scrollback: {}", session_id, e);
            return;
        }
    }

    // Spawn task to forward PTY output to WebSocket
    let session_id_clone = session_id.clone();
    let output_task = tokio::spawn(async move {
        while let Ok(data) = output_rx.recv().await {
            if ws_sender.send(Message::Text(data.into())).await.is_err() {
                break;
            }
        }
        info!("[ws:{}] Output task finished", session_id_clone);
    });

    // Handle incoming WebSocket messages (input)
    let session_clone = session.clone();
    let session_id_clone = session_id.clone();
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Err(e) = session_clone.write_input(&text) {
                    error!("[ws:{}] Failed to write input: {}", session_id_clone, e);
                    break;
                }
            }
            Ok(Message::Binary(data)) => {
                let text = String::from_utf8_lossy(&data);
                if let Err(e) = session_clone.write_input(&text) {
                    error!("[ws:{}] Failed to write input: {}", session_id_clone, e);
                    break;
                }
            }
            Ok(Message::Close(_)) => {
                info!("[ws:{}] Client closed connection", session_id_clone);
                break;
            }
            Err(e) => {
                error!("[ws:{}] WebSocket error: {}", session_id_clone, e);
                break;
            }
            _ => {}
        }
    }

    output_task.abort();
    info!("[ws:{}] Session WebSocket disconnected", session_id);
}

/// Handle events WebSocket (broadcasts all PTY events)
async fn handle_events_websocket(socket: WebSocket, pty_state: Arc<PtyState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let mut event_rx = pty_state.subscribe();

    info!("[ws:events] Events WebSocket connected");

    // Send initial state
    let state_sync = pty_state.get_full_state(None);
    if let Ok(json) = serde_json::to_string(&state_sync) {
        if let Err(e) = ws_sender.send(Message::Text(json.into())).await {
            error!("[ws:events] Failed to send initial state: {}", e);
            return;
        }
    }

    // Spawn task to forward events to WebSocket
    let event_task = tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&event) {
                if ws_sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
        info!("[ws:events] Event task finished");
    });

    // Keep connection alive by reading (ignore messages)
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Close(_)) => break,
            Err(e) => {
                error!("[ws:events] WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    event_task.abort();
    info!("[ws:events] Events WebSocket disconnected");
}
