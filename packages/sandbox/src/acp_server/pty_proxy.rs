use std::collections::HashMap;
use std::env;

use axum::{
    body::Bytes,
    extract::{Path, Query, WebSocketUpgrade},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use reqwest::Method;
use tracing::error;

use super::ws_util::try_set_ws_nodelay;
use url::Url;

const DEFAULT_PTY_BASE_URL: &str = "http://127.0.0.1:39383";

fn pty_base_url() -> String {
    let from_env = env::var("PTY_SERVER_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var("CMUX_PTY_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
    from_env
        .unwrap_or_else(|| DEFAULT_PTY_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn apply_pty_cors(headers: &mut HeaderMap) {
    headers.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    headers.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET,POST,PATCH,DELETE,OPTIONS"),
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

fn build_pty_url(base: &str, path: &str) -> Result<Url, url::ParseError> {
    let mut url = Url::parse(base)?;
    let base_path = url.path().trim_end_matches('/');
    let (raw_path, raw_query) = match path.split_once('?') {
        Some((path_part, query_part)) => (path_part, Some(query_part)),
        None => (path, None),
    };
    let trimmed_path = raw_path.trim_start_matches('/');
    let joined_path = if base_path.is_empty() || base_path == "/" {
        format!("/{}", trimmed_path)
    } else {
        format!("{}/{}", base_path, trimmed_path)
    };
    url.set_path(&joined_path);
    url.set_query(raw_query);
    url.set_fragment(None);
    Ok(url)
}

async fn proxy_pty_request(
    method: Method,
    path: &str,
    body: Option<Vec<u8>>,
    content_type: Option<String>,
) -> Response {
    let base_url = pty_base_url();
    let target_url = match build_pty_url(&base_url, path) {
        Ok(url) => url.to_string(),
        Err(error) => {
            error!("Invalid PTY base URL: {error}");
            let mut response = (StatusCode::BAD_GATEWAY, "Invalid PTY base URL").into_response();
            apply_pty_cors(response.headers_mut());
            return response;
        }
    };

    let client = reqwest::Client::builder()
        .http1_only()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut req = client.request(method, &target_url);

    if let Some(ct) = content_type {
        req = req.header("Content-Type", ct);
    }

    if let Some(body_bytes) = body {
        req = req.body(body_bytes);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

            let mut response = Response::builder().status(status);

            if let Some(ct) = resp.headers().get("content-type") {
                if let Ok(val) = axum::http::header::HeaderValue::from_bytes(ct.as_bytes()) {
                    response = response.header("Content-Type", val);
                }
            }

            match resp.bytes().await {
                Ok(body) => {
                    let mut built = response
                        .body(axum::body::Body::from(body))
                        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
                    apply_pty_cors(built.headers_mut());
                    built
                }
                Err(error) => {
                    error!("Failed to read PTY proxy response: {error}");
                    let mut response = StatusCode::BAD_GATEWAY.into_response();
                    apply_pty_cors(response.headers_mut());
                    response
                }
            }
        }
        Err(error) => {
            error!("PTY proxy request failed: {error}");
            let mut response =
                (StatusCode::BAD_GATEWAY, format!("PTY proxy error: {error}")).into_response();
            apply_pty_cors(response.headers_mut());
            response
        }
    }
}

fn apply_query_to_path(path: &str, params: &HashMap<String, String>) -> String {
    if params.is_empty() {
        return path.to_string();
    }

    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", key, value))
        .collect::<Vec<String>>()
        .join("&");
    format!("{}?{}", path, query)
}

pub async fn pty_preflight() -> Response {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| Response::new(axum::body::Body::empty()));
    apply_pty_cors(response.headers_mut());
    response
}

pub async fn pty_health() -> Response {
    proxy_pty_request(Method::GET, "/health", None, None).await
}

pub async fn pty_list_sessions() -> Response {
    proxy_pty_request(Method::GET, "/sessions", None, None).await
}

pub async fn pty_create_session(headers: HeaderMap, body: Bytes) -> Response {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    proxy_pty_request(Method::POST, "/sessions", Some(body.to_vec()), content_type).await
}

pub async fn pty_get_session(Path(session_id): Path<String>) -> Response {
    let path = format!("/sessions/{}", session_id);
    proxy_pty_request(Method::GET, &path, None, None).await
}

pub async fn pty_update_session(
    headers: HeaderMap,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Response {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let path = format!("/sessions/{}", session_id);
    proxy_pty_request(Method::PATCH, &path, Some(body.to_vec()), content_type).await
}

pub async fn pty_delete_session(Path(session_id): Path<String>) -> Response {
    let path = format!("/sessions/{}", session_id);
    proxy_pty_request(Method::DELETE, &path, None, None).await
}

pub async fn pty_resize_session(
    headers: HeaderMap,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Response {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let path = format!("/sessions/{}/resize", session_id);
    proxy_pty_request(Method::POST, &path, Some(body.to_vec()), content_type).await
}

pub async fn pty_capture_session(
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let path = format!("/sessions/{}/capture", session_id);
    let path_with_query = apply_query_to_path(&path, &params);
    proxy_pty_request(Method::GET, &path_with_query, None, None).await
}

pub async fn pty_input_session(
    headers: HeaderMap,
    Path(session_id): Path<String>,
    body: Bytes,
) -> Response {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());

    let path = format!("/sessions/{}/input", session_id);
    proxy_pty_request(Method::POST, &path, Some(body.to_vec()), content_type).await
}

pub async fn pty_session_ws(Path(session_id): Path<String>, ws: WebSocketUpgrade) -> Response {
    let path = format!("/sessions/{}/ws", session_id);
    let mut response = ws.on_upgrade(move |socket| async move {
        if let Err(error) = proxy_websocket(socket, &path).await {
            error!("PTY WebSocket proxy error: {error}");
        }
    });
    apply_pty_cors(response.headers_mut());
    response
}

async fn proxy_websocket(
    client_socket: axum::extract::ws::WebSocket,
    path: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

    let base_url = pty_base_url();
    let mut ws_url = build_pty_url(&base_url, path)?;
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
