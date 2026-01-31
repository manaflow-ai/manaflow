//! Proxy for OpenCode's headless serve mode.
//!
//! OpenCode provides a web UI via `opencode serve`. This module proxies requests
//! from `/api/opencode/*` to the internal OpenCode server, stripping the basepath
//! since OpenCode doesn't support serving from a subpath natively.

use std::env;

use axum::{
    body::Bytes,
    extract::{Path, WebSocketUpgrade},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use tracing::{debug, error, warn};

use super::ws_util::try_set_ws_nodelay;
use url::Url;

/// Build a fresh HTTP client for OpenCode requests.
/// We create a new client per-request to avoid connection pooling issues.
fn build_opencode_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minutes for long LLM responses
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|e| {
            warn!("Failed to build OpenCode client with custom settings: {e}, using default");
            reqwest::Client::new()
        })
}

const DEFAULT_OPENCODE_BASE_URL: &str = "http://127.0.0.1:39385";

fn opencode_base_url() -> String {
    env::var("OPENCODE_SERVER_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OPENCODE_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn apply_cors(headers: &mut HeaderMap) {
    headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    headers.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET,POST,PATCH,PUT,DELETE,OPTIONS"),
    );
    headers.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("*"),
    );
    headers.insert(
        "Access-Control-Expose-Headers",
        HeaderValue::from_static("*"),
    );
}

fn build_target_url(base: &str, path: &str, query: Option<&str>) -> Result<Url, url::ParseError> {
    let mut url = Url::parse(base)?;
    let trimmed_path = path.trim_start_matches('/');
    let new_path = if trimmed_path.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", trimmed_path)
    };
    url.set_path(&new_path);
    url.set_query(query);
    Ok(url)
}

/// Preflight handler for CORS
pub async fn opencode_preflight() -> Response {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()));
    apply_cors(response.headers_mut());
    response
}

/// Catch-all proxy handler for OpenCode requests.
/// Strips `/api/opencode` prefix and forwards to internal opencode server.
pub async fn opencode_proxy(method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    // Wrap in catch to handle any panics gracefully
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        opencode_proxy_inner(method, uri, headers, body)
    }));

    match result {
        Ok(future) => future.await,
        Err(panic_info) => {
            error!("OpenCode proxy handler panicked: {:?}", panic_info);
            let mut response = (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error: handler panicked",
            )
                .into_response();
            apply_cors(response.headers_mut());
            response
        }
    }
}

async fn opencode_proxy_inner(
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Extract path after /api/opencode
    let path = uri
        .path()
        .strip_prefix("/api/opencode")
        .unwrap_or(uri.path());
    let query = uri.query();
    let body_len = body.len();

    error!(
        method = %method,
        path = %path,
        query = ?query,
        body_len = body_len,
        "OpenCode proxy request received"
    );

    let base_url = opencode_base_url();
    let target_url = match build_target_url(&base_url, path, query) {
        Ok(url) => url.to_string(),
        Err(error) => {
            error!("Invalid OpenCode target URL: {error}");
            let mut response =
                (StatusCode::BAD_GATEWAY, "Invalid OpenCode target URL").into_response();
            apply_cors(response.headers_mut());
            return response;
        }
    };

    debug!(target_url = %target_url, "Proxying to OpenCode");

    let reqwest_method = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let client = build_opencode_client();
    let mut req = client.request(reqwest_method.clone(), &target_url);

    // Forward relevant headers
    if let Some(ct) = headers.get("content-type") {
        if let Ok(val) = ct.to_str() {
            req = req.header("Content-Type", val);
        }
    }
    if let Some(auth) = headers.get("authorization") {
        if let Ok(val) = auth.to_str() {
            req = req.header("Authorization", val);
        }
    }
    if let Some(accept) = headers.get("accept") {
        if let Ok(val) = accept.to_str() {
            req = req.header("Accept", val);
        }
    }

    if !body.is_empty() {
        req = req.body(body.to_vec());
    }

    debug!(
        method = %reqwest_method,
        target_url = %target_url,
        "Sending request to OpenCode"
    );

    let start = std::time::Instant::now();

    match req.send().await {
        Ok(resp) => {
            let elapsed = start.elapsed();
            let status_code = resp.status().as_u16();
            debug!(
                status = status_code,
                elapsed_ms = elapsed.as_millis(),
                "OpenCode response received"
            );

            let status =
                StatusCode::from_u16(status_code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

            // Check if this is an SSE response that needs streaming
            let is_sse = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .map(|ct| ct.contains("text/event-stream"))
                .unwrap_or(false);

            let mut response = Response::builder().status(status);

            // Forward response headers (except content-length and transfer-encoding
            // since we're buffering the body and axum will set these correctly)
            for (key, value) in resp.headers() {
                let key_lower = key.as_str().to_lowercase();
                if key_lower == "content-length" || key_lower == "transfer-encoding" {
                    continue;
                }
                if let Ok(val) = axum::http::header::HeaderValue::from_bytes(value.as_bytes()) {
                    if let Ok(name) = axum::http::header::HeaderName::try_from(key.as_str()) {
                        response = response.header(name, val);
                    }
                }
            }

            if is_sse {
                // For SSE, stream the response body directly without buffering
                debug!("Streaming SSE response");
                response = response.header("Cache-Control", "no-cache");

                let stream = resp.bytes_stream();
                let body = axum::body::Body::from_stream(stream);
                let mut built = response.body(body).unwrap_or_else(|e| {
                    error!("Failed to build SSE response body: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                });
                apply_cors(built.headers_mut());
                built
            } else {
                // For non-SSE, buffer the response body
                match resp.bytes().await {
                    Ok(body) => {
                        let body_len = body.len();
                        debug!(
                            body_len = body_len,
                            total_elapsed_ms = start.elapsed().as_millis(),
                            "OpenCode response body read"
                        );
                        let mut built =
                            response
                                .body(axum::body::Body::from(body))
                                .unwrap_or_else(|e| {
                                    error!("Failed to build response body: {e}");
                                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                                });
                        apply_cors(built.headers_mut());
                        built
                    }
                    Err(error) => {
                        error!(
                            error = %error,
                            elapsed_ms = start.elapsed().as_millis(),
                            "Failed to read OpenCode response body"
                        );
                        let mut response = (
                            StatusCode::BAD_GATEWAY,
                            format!("Failed to read OpenCode response: {error}"),
                        )
                            .into_response();
                        apply_cors(response.headers_mut());
                        response
                    }
                }
            }
        }
        Err(error) => {
            let elapsed = start.elapsed();
            error!(
                error = %error,
                elapsed_ms = elapsed.as_millis(),
                target_url = %target_url,
                "OpenCode proxy request failed"
            );

            // Provide more specific error messages
            let error_msg = if error.is_timeout() {
                format!("OpenCode request timed out after {}ms", elapsed.as_millis())
            } else if error.is_connect() {
                format!("Failed to connect to OpenCode server: {error}")
            } else {
                format!("OpenCode proxy error: {error}")
            };

            let mut response = (StatusCode::BAD_GATEWAY, error_msg).into_response();
            apply_cors(response.headers_mut());
            response
        }
    }
}

/// WebSocket proxy for PTY connections at /api/opencode/pty/{id}/connect
pub async fn opencode_pty_ws(Path(pty_id): Path<String>, ws: WebSocketUpgrade) -> Response {
    let path = format!("/pty/{}/connect", pty_id);
    let mut response = ws.on_upgrade(move |socket| async move {
        if let Err(error) = proxy_websocket(socket, &path).await {
            error!("OpenCode PTY WebSocket proxy error: {error}");
        }
    });
    apply_cors(response.headers_mut());
    response
}

async fn proxy_websocket(
    client_socket: axum::extract::ws::WebSocket,
    path: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

    let base_url = opencode_base_url();
    let mut ws_url = build_target_url(&base_url, path, None)?;
    let scheme = match ws_url.scheme() {
        "https" => "wss",
        _ => "ws",
    };
    ws_url.set_scheme(scheme).map_err(|_| "invalid scheme")?;

    let (upstream_ws, _) = tokio_tungstenite::connect_async(ws_url.to_string()).await?;
    try_set_ws_nodelay(&upstream_ws);
    let (mut upstream_sink, mut upstream_stream) = upstream_ws.split();
    let (mut client_sink, mut client_stream) = client_socket.split();

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
            Ok(TungsteniteMessage::Close(_)) => break,
            Ok(TungsteniteMessage::Frame(_)) => {}
            Err(_) => break,
        }
    }

    client_to_upstream.abort();
    Ok(())
}
