use crate::errors::{ErrorBody, SandboxError, SandboxResult};
use crate::models::{
    CreateSandboxRequest, ExecRequest, ExecResponse, HealthResponse, HostEvent, NotificationLevel,
    NotificationLogEntry, NotificationRequest, OpenUrlRequest, SandboxSummary,
};
use crate::notifications::NotificationStore;
use crate::service::{AppState, GhResponseRegistry, HostEventSender, SandboxService};
use axum::body::Body;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::HOST;
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use std::sync::Arc;
use utoipa::OpenApi as UtoipaOpenApi;
use utoipa_swagger_ui::SwaggerUi;
use uuid::Uuid;

#[derive(Deserialize)]
struct ProxyParams {
    port: u16,
}

#[derive(Deserialize)]
struct AttachParams {
    cols: Option<u16>,
    rows: Option<u16>,
    command: Option<String>,
    #[serde(default = "default_tty")]
    tty: bool,
}

fn default_tty() -> bool {
    true
}

#[derive(UtoipaOpenApi)]
#[openapi(
    paths(
        create_sandbox,
        list_sandboxes,
        get_sandbox,
        exec_sandbox,
        delete_sandbox,
        health,
        upload_files,
        open_url_post,
        list_notifications,
        send_notification,
    ),
    components(schemas(
        CreateSandboxRequest,
        ExecRequest,
        ExecResponse,
        SandboxSummary,
        crate::models::SandboxNetwork,
        crate::models::SandboxStatus,
        HealthResponse,
        ErrorBody,
        NotificationRequest,
        NotificationLogEntry,
        NotificationLevel,
        OpenUrlRequest
    )),
    tags((name = "sandboxes", description = "Manage bubblewrap-based sandboxes"))
)]
pub struct ApiDoc;

pub fn build_router(
    service: Arc<dyn SandboxService>,
    host_events: HostEventSender,
    gh_responses: GhResponseRegistry,
    gh_auth_cache: crate::service::GhAuthCache,
    notifications: NotificationStore,
) -> Router {
    let state = AppState::new(
        service,
        host_events,
        gh_responses,
        gh_auth_cache,
        notifications,
    );
    let openapi = ApiDoc::openapi();
    let swagger_routes: Router<AppState> =
        SwaggerUi::new("/docs").url("/openapi.json", openapi).into();

    Router::new()
        .route("/healthz", get(health))
        .route("/sandboxes", get(list_sandboxes).post(create_sandbox))
        .route("/sandboxes/{id}", get(get_sandbox).delete(delete_sandbox))
        .route("/sandboxes/{id}/exec", post(exec_sandbox))
        .route(
            "/sandboxes/{id}/files",
            post(upload_files).layer(DefaultBodyLimit::disable()),
        )
        .route("/sandboxes/{id}/attach", any(attach_sandbox))
        .route("/sandboxes/{id}/proxy", any(proxy_sandbox))
        // Multiplexed WebSocket endpoint - single connection for all PTY sessions
        .route("/mux/attach", any(mux_attach))
        // Open URL on host - used by sandboxed processes to open links
        .route("/open-url", get(open_url).post(open_url_post))
        // Push a notification to connected clients
        .route(
            "/notifications",
            get(list_notifications).post(send_notification),
        )
        .merge(swagger_routes)
        // Fallback for subdomain routing: {index}-{port}.host -> sandbox's internal port
        .fallback(subdomain_proxy)
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/healthz",
    responses((status = 200, description = "Server is healthy", body = HealthResponse))
)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

#[utoipa::path(
    post,
    path = "/sandboxes",
    request_body = CreateSandboxRequest,
    responses(
        (status = 201, description = "Sandbox created", body = SandboxSummary),
        (status = 400, description = "Bad request", body = ErrorBody)
    )
)]
async fn create_sandbox(
    state: axum::extract::State<AppState>,
    Json(request): Json<CreateSandboxRequest>,
) -> SandboxResult<(StatusCode, Json<SandboxSummary>)> {
    let summary = state.service.create(request).await?;
    Ok((StatusCode::CREATED, Json(summary)))
}

#[utoipa::path(
    get,
    path = "/sandboxes",
    responses((status = 200, description = "List of sandboxes", body = [SandboxSummary]))
)]
async fn list_sandboxes(
    state: axum::extract::State<AppState>,
) -> SandboxResult<Json<Vec<SandboxSummary>>> {
    let sandboxes = state.service.list().await?;
    Ok(Json(sandboxes))
}

#[utoipa::path(
    get,
    path = "/sandboxes/{id}",
    params(
        ("id" = String, Path, description = "Sandbox identifier (UUID or short ID)")
    ),
    responses(
        (status = 200, description = "Sandbox detail", body = SandboxSummary),
        (status = 404, description = "Sandbox not found", body = ErrorBody)
    )
)]
async fn get_sandbox(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
) -> SandboxResult<Json<SandboxSummary>> {
    match state.service.get(id.clone()).await? {
        Some(summary) => Ok(Json(summary)),
        None => Err(SandboxError::NotFound(Uuid::nil())), // TODO: Better error
    }
}

#[utoipa::path(
    post,
    path = "/sandboxes/{id}/exec",
    params(
        ("id" = String, Path, description = "Sandbox identifier (UUID or short ID)")
    ),
    request_body = ExecRequest,
    responses(
        (status = 200, description = "Command executed", body = ExecResponse),
        (status = 404, description = "Sandbox not found", body = ErrorBody)
    )
)]
async fn exec_sandbox(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ExecRequest>,
) -> SandboxResult<Json<ExecResponse>> {
    let response = state.service.exec(id, request).await?;
    Ok(Json(response))
}

#[utoipa::path(
    post,
    path = "/sandboxes/{id}/files",
    params(
        ("id" = String, Path, description = "Sandbox identifier (UUID or short ID)")
    ),
    request_body = Vec<u8>,
    responses(
        (status = 200, description = "Files uploaded"),
        (status = 404, description = "Sandbox not found", body = ErrorBody)
    )
)]
async fn upload_files(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
    body: Body,
) -> SandboxResult<StatusCode> {
    state.service.upload_archive(id, body).await?;
    Ok(StatusCode::OK)
}

async fn attach_sandbox(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
    Query(params): Query<AttachParams>,
    ws: WebSocketUpgrade,
) -> Response {
    let initial_size = match (params.cols, params.rows) {
        (Some(c), Some(r)) => Some((c, r)),
        _ => None,
    };

    let command = params
        .command
        .map(|c| vec!["/bin/sh".to_string(), "-c".to_string(), c]);

    ws.on_upgrade(move |socket| async move {
        if let Err(e) = state
            .service
            .attach(id, socket, initial_size, command, params.tty)
            .await
        {
            tracing::error!("attach failed: {e}");
        }
    })
}

async fn proxy_sandbox(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
    Query(params): Query<ProxyParams>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = state.service.proxy(id, params.port, socket).await {
            tracing::error!("proxy failed: {e}");
        }
    })
}

/// Parse subdomain pattern to extract sandbox index and port.
/// Format: {index}-{port}.rest (e.g., "0-39380.localhost:46835")
fn parse_subdomain(host: &str) -> Option<(usize, u16)> {
    let subdomain = host.split('.').next()?;
    let parts: Vec<&str> = subdomain.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let index = parts[0].parse::<usize>().ok()?;
    let port = parts[1].parse::<u16>().ok()?;
    Some((index, port))
}

/// Subdomain routing: {index}-{port}.host -> proxy to sandbox[index]'s internal port
/// Example: 0-39380.localhost:46835 -> sandbox 0's internal port 39380 (noVNC)
/// Handles both HTTP requests and WebSocket upgrades.
async fn subdomain_proxy(
    state: State<AppState>,
    ws: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
    headers: HeaderMap,
    req: axum::http::Request<Body>,
) -> Response {
    // Get host from headers
    let host = headers
        .get(HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    // Parse subdomain pattern
    let Some((index, port)) = parse_subdomain(host) else {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    };

    // Find sandbox by index
    let sandboxes = match state.service.list().await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to list sandboxes: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to list sandboxes",
            )
                .into_response();
        }
    };

    let sandbox = sandboxes.iter().find(|s| s.index == index);
    let Some(sandbox) = sandbox else {
        return (
            StatusCode::NOT_FOUND,
            format!("Sandbox with index {} not found", index),
        )
            .into_response();
    };

    let sandbox_ip = sandbox.network.sandbox_ip.clone();
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();

    // Check if this is a WebSocket upgrade (for noVNC/websockify)
    if let Ok(ws) = ws {
        tracing::info!(
            sandbox_index = index,
            port = port,
            sandbox_ip = %sandbox_ip,
            path = %path_and_query,
            "subdomain WebSocket proxy"
        );

        return ws.on_upgrade(move |client_socket| async move {
            if let Err(e) = proxy_websocket(client_socket, &sandbox_ip, port, &path_and_query).await
            {
                tracing::error!("WebSocket proxy error: {e}");
            }
        });
    }

    // HTTP reverse proxy
    let target_url = format!("http://{}:{}{}", sandbox_ip, port, path_and_query);

    tracing::info!(
        sandbox_index = index,
        port = port,
        sandbox_ip = %sandbox_ip,
        target_url = %target_url,
        "subdomain HTTP proxy"
    );

    // Build the proxied request with matching method
    let client = reqwest::Client::new();
    let method = req.method().clone();
    let proxy_req = client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET),
        &target_url,
    );

    // Copy relevant request headers
    let mut proxy_req = proxy_req;
    for (key, value) in headers.iter() {
        // Skip hop-by-hop headers
        if key == HOST || key == "connection" || key == "upgrade" {
            continue;
        }
        if let Ok(val_str) = value.to_str() {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_str().as_bytes()) {
                proxy_req = proxy_req.header(name, val_str);
            }
        }
    }

    match proxy_req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            let mut response = axum::response::Response::builder().status(status);

            // Copy headers from upstream response
            for (key, value) in resp.headers() {
                if let Ok(name) = axum::http::header::HeaderName::try_from(key.as_str()) {
                    if let Ok(val) = axum::http::header::HeaderValue::from_bytes(value.as_bytes()) {
                        response = response.header(name, val);
                    }
                }
            }

            // Stream the body
            match resp.bytes().await {
                Ok(body) => response
                    .body(Body::from(body))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
                Err(e) => {
                    tracing::error!("Failed to read proxy response body: {e}");
                    StatusCode::BAD_GATEWAY.into_response()
                }
            }
        }
        Err(e) => {
            tracing::error!("Proxy request failed: {e}");
            (StatusCode::BAD_GATEWAY, format!("Proxy error: {e}")).into_response()
        }
    }
}

/// Proxy WebSocket connection to sandbox internal port.
/// Used for noVNC websockify connections.
async fn proxy_websocket(
    client_socket: axum::extract::ws::WebSocket,
    sandbox_ip: &str,
    port: u16,
    path: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

    let url = format!("ws://{}:{}{}", sandbox_ip, port, path);
    tracing::debug!("Connecting to upstream WebSocket: {}", url);

    let (upstream_ws, _) = tokio_tungstenite::connect_async(&url).await?;
    let (mut upstream_sink, mut upstream_stream) = upstream_ws.split();

    let (mut client_sink, mut client_stream) = client_socket.split();

    // Spawn task to forward client -> upstream
    let client_to_upstream = tokio::spawn(async move {
        while let Some(msg_result) = client_stream.next().await {
            match msg_result {
                Ok(axum::extract::ws::Message::Binary(data)) => {
                    if upstream_sink
                        .send(TungsteniteMessage::Binary(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(axum::extract::ws::Message::Text(text)) => {
                    if upstream_sink
                        .send(TungsteniteMessage::Text(text.to_string()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(axum::extract::ws::Message::Close(_)) => break,
                Ok(axum::extract::ws::Message::Ping(data)) => {
                    if upstream_sink
                        .send(TungsteniteMessage::Ping(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(axum::extract::ws::Message::Pong(data)) => {
                    if upstream_sink
                        .send(TungsteniteMessage::Pong(data.to_vec()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Forward upstream -> client
    while let Some(msg_result) = upstream_stream.next().await {
        match msg_result {
            Ok(TungsteniteMessage::Binary(data)) => {
                if client_sink
                    .send(axum::extract::ws::Message::Binary(data.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Ok(TungsteniteMessage::Text(text)) => {
                if client_sink
                    .send(axum::extract::ws::Message::Text(text.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Ok(TungsteniteMessage::Close(_)) => break,
            Ok(TungsteniteMessage::Ping(data)) => {
                if client_sink
                    .send(axum::extract::ws::Message::Ping(data.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Ok(TungsteniteMessage::Pong(data)) => {
                if client_sink
                    .send(axum::extract::ws::Message::Pong(data.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Ok(_) => {} // Ignore Frame messages
            Err(_) => break,
        }
    }

    client_to_upstream.abort();
    Ok(())
}

/// Multiplexed WebSocket endpoint - handles multiple PTY sessions over a single connection.
async fn mux_attach(state: axum::extract::State<AppState>, ws: WebSocketUpgrade) -> Response {
    let host_event_rx = state.host_events.subscribe();
    let gh_responses = state.gh_responses.clone();
    let gh_auth_cache = state.gh_auth_cache.clone();
    ws.on_upgrade(move |socket| async move {
        if let Err(e) = state
            .service
            .mux_attach(socket, host_event_rx, gh_responses, gh_auth_cache)
            .await
        {
            tracing::error!("mux_attach failed: {e}");
        }
    })
}

/// Open a URL on the host machine. Used by sandboxed processes to open links.
async fn open_url(
    State(state): State<AppState>,
    Query(params): Query<OpenUrlRequest>,
) -> StatusCode {
    handle_open_url(state, params).await
}

#[utoipa::path(
    post,
    path = "/open-url",
    request_body = OpenUrlRequest,
    responses(
        (status = 200, description = "URL forwarded to host"),
        (status = 400, description = "Invalid URL", body = ErrorBody),
        (status = 500, description = "Failed to dispatch open-url request", body = ErrorBody)
    )
)]
async fn open_url_post(
    State(state): State<AppState>,
    Json(body): Json<OpenUrlRequest>,
) -> StatusCode {
    handle_open_url(state, body).await
}

async fn handle_open_url(state: AppState, params: OpenUrlRequest) -> StatusCode {
    // Validate URL to prevent command injection
    if !params.url.starts_with("http://") && !params.url.starts_with("https://") {
        return StatusCode::BAD_REQUEST;
    }

    match state.host_events.send(HostEvent::OpenUrl(OpenUrlRequest {
        url: params.url.clone(),
        sandbox_id: params.sandbox_id.clone(),
        tab_id: params.tab_id.clone(),
    })) {
        Ok(_) => StatusCode::OK,
        Err(error) => {
            tracing::warn!(
                "open-url broadcast had no listeners, falling back to local open: {error}"
            );
            match open::that(&params.url) {
                Ok(()) => StatusCode::OK,
                Err(e) => {
                    tracing::error!("Failed to open URL {}: {}", params.url, e);
                    StatusCode::INTERNAL_SERVER_ERROR
                }
            }
        }
    }
}

#[utoipa::path(
    get,
    path = "/notifications",
    responses((status = 200, description = "List recent notifications", body = [NotificationLogEntry]))
)]
async fn list_notifications(State(state): State<AppState>) -> Json<Vec<NotificationLogEntry>> {
    let entries = state.notifications.list().await;
    Json(entries)
}

#[utoipa::path(
    post,
    path = "/notifications",
    request_body = NotificationRequest,
    responses(
        (status = 200, description = "Notification dispatched"),
        (status = 202, description = "No listeners available; notification accepted")
    )
)]
async fn send_notification(
    State(state): State<AppState>,
    Json(body): Json<NotificationRequest>,
) -> StatusCode {
    let _ = state
        .notifications
        .record(
            body.message.clone(),
            body.level,
            body.sandbox_id.clone(),
            body.tab_id.clone(),
            body.pane_id.clone(),
        )
        .await;
    match state
        .host_events
        .send(HostEvent::Notification(NotificationRequest {
            message: body.message.clone(),
            level: body.level,
            sandbox_id: body.sandbox_id.clone(),
            tab_id: body.tab_id.clone(),
            pane_id: body.pane_id.clone(),
        })) {
        Ok(_) => StatusCode::OK,
        Err(error) => {
            tracing::warn!("no listeners for notification: {error}");
            StatusCode::ACCEPTED
        }
    }
}

#[utoipa::path(
    delete,
    path = "/sandboxes/{id}",
    params(
        ("id" = String, Path, description = "Sandbox identifier (UUID or short ID)")
    ),
    responses(
        (status = 200, description = "Sandbox stopped", body = SandboxSummary),
        (status = 404, description = "Sandbox not found", body = ErrorBody)
    )
)]
async fn delete_sandbox(
    state: axum::extract::State<AppState>,
    Path(id): Path<String>,
) -> SandboxResult<Json<SandboxSummary>> {
    match state.service.delete(id.clone()).await? {
        Some(summary) => Ok(Json(summary)),
        None => Err(SandboxError::NotFound(Uuid::nil())), // TODO: Better error handling
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{SandboxNetwork, SandboxStatus};
    use async_trait::async_trait;
    use axum::body::Body;
    use axum::extract::ws::WebSocket;
    use axum::http::Request;
    use chrono::Utc;
    use std::sync::Arc;
    use tokio::sync::Mutex;
    use tower::ServiceExt;
    use uuid::Uuid;

    #[derive(Clone, Default)]
    struct MockService {
        calls: Arc<Mutex<usize>>,
    }

    #[async_trait]
    impl SandboxService for MockService {
        async fn create(&self, request: CreateSandboxRequest) -> SandboxResult<SandboxSummary> {
            let mut calls = self.calls.lock().await;
            *calls += 1;
            Ok(fake_summary(request.name.unwrap_or_else(|| "mock".into())))
        }

        async fn list(&self) -> SandboxResult<Vec<SandboxSummary>> {
            Ok(vec![fake_summary("mock-list".into())])
        }

        async fn get(&self, _id: String) -> SandboxResult<Option<SandboxSummary>> {
            Ok(Some(fake_summary("mock-one".into())))
        }

        async fn exec(&self, _id: String, _exec: ExecRequest) -> SandboxResult<ExecResponse> {
            Ok(ExecResponse {
                exit_code: 0,
                stdout: "ok".into(),
                stderr: String::new(),
            })
        }

        async fn attach(
            &self,
            _id: String,
            _socket: WebSocket,
            _initial_size: Option<(u16, u16)>,
            _command: Option<Vec<String>>,
            _tty: bool,
        ) -> SandboxResult<()> {
            Ok(())
        }

        async fn mux_attach(
            &self,
            _socket: WebSocket,
            _host_event_rx: crate::service::HostEventReceiver,
            _gh_responses: crate::service::GhResponseRegistry,
            _gh_auth_cache: crate::service::GhAuthCache,
        ) -> SandboxResult<()> {
            Ok(())
        }

        async fn proxy(&self, _id: String, _port: u16, _socket: WebSocket) -> SandboxResult<()> {
            Ok(())
        }

        async fn upload_archive(&self, _id: String, _archive: Body) -> SandboxResult<()> {
            Ok(())
        }

        async fn delete(&self, _id: String) -> SandboxResult<Option<SandboxSummary>> {
            Ok(Some(fake_summary("mock-delete".into())))
        }
    }

    fn fake_summary(name: String) -> SandboxSummary {
        SandboxSummary {
            index: 0,
            id: Uuid::new_v4(),
            name,
            created_at: Utc::now(),
            workspace: "/tmp/mock".to_string(),
            status: SandboxStatus::Running,
            network: SandboxNetwork {
                host_interface: "vethh-mock".to_string(),
                sandbox_interface: "vethn-mock".to_string(),
                host_ip: "10.0.0.1".to_string(),
                sandbox_ip: "10.0.0.2".to_string(),
                cidr: 30,
            },
            display: None,
            correlation_id: None,
        }
    }

    fn make_test_router() -> Router {
        use std::collections::HashMap;
        let (host_event_tx, _) = tokio::sync::broadcast::channel(16);
        let gh_responses = Arc::new(Mutex::new(HashMap::new()));
        let gh_auth_cache = Arc::new(Mutex::new(None));
        let notifications = NotificationStore::new();
        build_router(
            Arc::new(MockService::default()),
            host_event_tx,
            gh_responses,
            gh_auth_cache,
            notifications,
        )
    }

    #[tokio::test]
    async fn serves_openapi_document() {
        let app = make_test_router();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/openapi.json")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn create_endpoint_returns_summary() {
        let app = make_test_router();
        let request = CreateSandboxRequest {
            name: Some("demo".into()),
            workspace: None,
            tab_id: None,
            read_only_paths: Vec::new(),
            tmpfs: Vec::new(),
            env: Vec::new(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sandboxes")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CREATED);
    }
}
