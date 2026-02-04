//! Proxy helpers for UI services (cmux-code, noVNC, VNC).
//!
//! These endpoints live on the cmux-acp-server and expose local UI services
//! via path-rewritten routes.

use std::borrow::Cow;
use std::{env, net::SocketAddr, path::Path};

use axum::{
    body::{Body, Bytes},
    extract::ws::{rejection::WebSocketUpgradeRejection, WebSocketUpgrade},
    http::{
        header::{CONTENT_TYPE, HOST},
        HeaderMap, HeaderValue, Method, StatusCode, Uri,
    },
    response::{IntoResponse, Redirect, Response},
};
use tracing::{debug, error, warn};
use url::{form_urlencoded, Url};

use crate::acp_server::ws_util::try_set_ws_nodelay;
use crate::vnc_proxy::proxy_vnc_websocket;

const DEFAULT_CMUX_CODE_URL: &str = "http://127.0.0.1:39378";
const DEFAULT_VNC_PORT: u16 = 5901;
const DEFAULT_NOVNC_DIR: &str = "/usr/share/novnc";

fn cmux_code_base_url() -> String {
    env::var("CMUX_CODE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CMUX_CODE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

fn vnc_port() -> u16 {
    env::var("CMUX_VNC_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_VNC_PORT)
}

fn novnc_dir() -> String {
    env::var("CMUX_NOVNC_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_NOVNC_DIR.to_string())
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

fn first_header_value(value: &str) -> &str {
    value.split(',').next().unwrap_or(value).trim()
}

fn forwarded_host(headers: &HeaderMap) -> Option<&str> {
    if let Some(value) = headers
        .get("x-forwarded-host")
        .and_then(|v| v.to_str().ok())
    {
        let host = first_header_value(value);
        if !host.is_empty() {
            return Some(host);
        }
    }
    headers
        .get(HOST)
        .and_then(|value| value.to_str().ok())
        .map(first_header_value)
        .filter(|value| !value.is_empty())
}

struct HtmlRewrite {
    host: Option<String>,
    proto: String,
}

fn forwarded_proto(headers: &HeaderMap) -> String {
    if let Some(proto) = forwarded_proto_header(headers) {
        if proto != "http" {
            return proto;
        }
        if let Some(scheme) = origin_scheme(headers) {
            return scheme;
        }
        if let Some(host) = forwarded_host(headers) {
            let host = host_without_port(host);
            if !is_local_host(host) {
                return "https".to_string();
            }
        }
        return proto;
    }
    if let Some(scheme) = origin_scheme(headers) {
        return scheme;
    }
    if let Some(host) = forwarded_host(headers) {
        let host = host_without_port(host);
        if !is_local_host(host) {
            return "https".to_string();
        }
    }
    "http".to_string()
}

fn forwarded_proto_header(headers: &HeaderMap) -> Option<String> {
    for header in [
        "x-forwarded-proto",
        "x-forwarded-protocol",
        "x-forwarded-scheme",
    ] {
        if let Some(value) = headers.get(header).and_then(|v| v.to_str().ok()) {
            let proto = first_header_value(value);
            if !proto.is_empty() {
                return Some(proto.to_string());
            }
        }
    }
    None
}

fn origin_scheme(headers: &HeaderMap) -> Option<String> {
    for header in ["origin", "referer"] {
        if let Some(value) = headers.get(header).and_then(|v| v.to_str().ok()) {
            if let Ok(url) = Url::parse(value) {
                return Some(url.scheme().to_string());
            }
        }
    }
    None
}

fn origin_for_base_url(base_url: &str) -> Option<String> {
    let url = Url::parse(base_url).ok()?;
    let host = url.host_str()?;
    let mut origin = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        origin.push_str(&format!(":{port}"));
    }
    Some(origin)
}

fn websocket_origin(base_url: &str, headers: &HeaderMap) -> Option<String> {
    let base_origin = origin_for_base_url(base_url);
    let base_host_is_local = Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(is_local_host))
        .unwrap_or(false);
    if base_host_is_local {
        return base_origin;
    }
    if let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) {
        if !origin.is_empty() {
            return Some(origin.to_string());
        }
    }
    if let Some(host) = forwarded_host(headers) {
        let proto = forwarded_proto(headers);
        return Some(format!("{}://{}", proto, host));
    }
    base_origin
}

fn replace_html_value(mut html: String, needle: &str, terminator: &str, value: &str) -> String {
    let mut search_start = 0;
    while let Some(found) = html[search_start..].find(needle) {
        let value_start = search_start + found + needle.len();
        if let Some(end_rel) = html[value_start..].find(terminator) {
            let value_end = value_start + end_rel;
            html.replace_range(value_start..value_end, value);
            search_start = value_start + value.len() + terminator.len();
        } else {
            break;
        }
    }
    html
}

fn host_without_port(host: &str) -> &str {
    if host.starts_with('[') {
        if let Some(end) = host.find(']') {
            return &host[..=end];
        }
    }
    if let Some((name, _port)) = host.rsplit_once(':') {
        return name;
    }
    host
}

fn is_local_host(host: &str) -> bool {
    let host = host.trim();
    host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "0.0.0.0"
        || host == "::1"
}

fn rewrite_cmux_code_html(body: Bytes, rewrite: &HtmlRewrite) -> Bytes {
    let Ok(mut html) = String::from_utf8(body.to_vec()) else {
        return body;
    };
    if let Some(host) = rewrite.host.as_deref() {
        let mut hosts = vec![host.to_string()];
        let host_without = host_without_port(host);
        if host_without != host {
            hosts.push(host_without.to_string());
        }
        for host_variant in hosts {
            let origin = format!("{}://{}", rewrite.proto, host_variant);
            for base in [
                "http://127.0.0.1:39378",
                "http://localhost:39378",
                "http://0.0.0.0:39378",
            ] {
                if html.contains(base) {
                    html = html.replace(base, &origin);
                }
                let encoded = match base.strip_prefix("http://") {
                    Some(host_port) => format!("http%3A%2F%2F{host_port}"),
                    None => continue,
                };
                if html.contains(&encoded) {
                    let encoded_origin = format!("{}%3A%2F%2F{}", rewrite.proto, host_variant);
                    html = html.replace(&encoded, &encoded_origin);
                }
            }
            let insecure_origin = format!("http://{host_variant}");
            if html.contains(&insecure_origin) {
                html = html.replace(&insecure_origin, &origin);
            }
            let insecure_origin_escaped = format!("http%3A%2F%2F{host_variant}");
            let secure_origin_escaped = format!("{}%3A%2F%2F{}", rewrite.proto, host_variant);
            if html.contains(&insecure_origin_escaped) {
                html = html.replace(&insecure_origin_escaped, &secure_origin_escaped);
            }
        }
        html = replace_html_value(html, "\"remoteAuthority\":\"", "\"", host);
        html = replace_html_value(html, "&quot;remoteAuthority&quot;:&quot;", "&quot;", host);
    }
    html = replace_html_value(html, "\"serverBasePath\":\"", "\"", "/api/cmux-code");
    html = replace_html_value(
        html,
        "&quot;serverBasePath&quot;:&quot;",
        "&quot;",
        "/api/cmux-code",
    );
    html = replace_html_value(html, "serverBasePath: \"", "\"", "/api/cmux-code");
    html = replace_html_value(html, "serverBasePath:\"", "\"", "/api/cmux-code");
    Bytes::from(html)
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

fn split_path_query(path_and_query: &str) -> (&str, Option<&str>) {
    match path_and_query.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (path_and_query, None),
    }
}

fn normalize_oss_path(path: &str) -> Cow<'_, str> {
    if let Some(rest) = path.strip_prefix("/oss-") {
        if !rest.contains('/') && !path.ends_with('/') {
            return Cow::Owned(format!("{path}/"));
        }
    }
    Cow::Borrowed(path)
}

fn should_rewrite_novnc_path(query: Option<&str>) -> bool {
    for (key, value) in query
        .map(|q| form_urlencoded::parse(q.as_bytes()))
        .into_iter()
        .flatten()
    {
        if key == "path" {
            return value == "websockify" || value == "api/novnc/websockify";
        }
    }
    true
}

fn rewrite_novnc_query(query: Option<&str>) -> String {
    let mut saw_path = false;
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    for (key, value) in query
        .map(|q| form_urlencoded::parse(q.as_bytes()))
        .into_iter()
        .flatten()
    {
        if key == "path" {
            saw_path = true;
            if value == "websockify" || value == "api/novnc/websockify" {
                serializer.append_pair("path", "api/novnc/ws");
            } else {
                serializer.append_pair(&key, &value);
            }
        } else {
            serializer.append_pair(&key, &value);
        }
    }
    if !saw_path {
        serializer.append_pair("path", "api/novnc/ws");
    }
    serializer.finish()
}

async fn proxy_http_request(
    base_url: &str,
    method: Method,
    path: &str,
    query: Option<&str>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_http_request_with_rewrite(base_url, method, path, query, headers, body, None).await
}

async fn proxy_http_request_with_rewrite(
    base_url: &str,
    method: Method,
    path: &str,
    query: Option<&str>,
    headers: HeaderMap,
    body: Bytes,
    rewrite: Option<HtmlRewrite>,
) -> Response {
    let target_url = match build_target_url(base_url, path, query) {
        Ok(url) => url.to_string(),
        Err(error) => {
            error!("Invalid proxy target URL: {error}");
            let mut response =
                (StatusCode::BAD_GATEWAY, "Invalid proxy target URL").into_response();
            apply_cors(response.headers_mut());
            return response;
        }
    };

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

    let proto = forwarded_proto(&headers);
    let client = reqwest::Client::builder()
        .http1_only()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut req = client.request(reqwest_method.clone(), &target_url);

    if let Some(host) = forwarded_host(&headers) {
        req = req.header(reqwest::header::HOST, host);
        req = req.header("X-Forwarded-Host", host);
        req = req.header("X-Forwarded-Proto", proto.as_str());
    }

    for (key, value) in headers.iter() {
        let key_lower = key.as_str().to_lowercase();
        if key == HOST
            || key == "connection"
            || key == "upgrade"
            || key_lower == "x-forwarded-host"
            || key_lower == "x-forwarded-proto"
            || key_lower == "forwarded"
        {
            continue;
        }
        if let Ok(val_str) = value.to_str() {
            if let Ok(name) = reqwest::header::HeaderName::from_bytes(key.as_str().as_bytes()) {
                req = req.header(name, val_str);
            }
        }
    }

    if !body.is_empty() {
        req = req.body(body.to_vec());
    }

    debug!(
        method = %reqwest_method,
        target_url = %target_url,
        "Proxying HTTP request"
    );

    match req.send().await {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let mut response = Response::builder().status(status);
            let content_type = resp
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string();

            for (key, value) in resp.headers() {
                let key_lower = key.as_str().to_lowercase();
                if key_lower == "content-length" || key_lower == "transfer-encoding" {
                    continue;
                }
                if let Ok(val) = HeaderValue::from_bytes(value.as_bytes()) {
                    response = response.header(key, val);
                }
            }

            let body_bytes = match resp.bytes().await {
                Ok(bytes) => bytes,
                Err(err) => {
                    error!("Failed to read proxy response body: {err}");
                    let mut response =
                        (StatusCode::BAD_GATEWAY, "Failed to read proxy response").into_response();
                    apply_cors(response.headers_mut());
                    return response;
                }
            };

            let body_bytes = if let Some(rewrite) = rewrite {
                if content_type.starts_with("text/html") {
                    rewrite_cmux_code_html(body_bytes, &rewrite)
                } else {
                    body_bytes
                }
            } else {
                body_bytes
            };

            let mut response = response
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response());
            apply_cors(response.headers_mut());
            response
        }
        Err(err) => {
            error!("Proxy request failed: {err}");
            let mut response = (StatusCode::BAD_GATEWAY, "Proxy request failed").into_response();
            apply_cors(response.headers_mut());
            response
        }
    }
}

fn build_ws_request(
    base_url: &str,
    path: &str,
    query: Option<&str>,
    headers: &HeaderMap,
) -> Result<axum::http::Request<()>, Box<dyn std::error::Error + Send + Sync>> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let mut url = build_target_url(base_url, path, query)?;
    let scheme = match url.scheme() {
        "https" => "wss",
        _ => "ws",
    };
    url.set_scheme(scheme).map_err(|_| "invalid scheme")?;

    let mut request = url.to_string().into_client_request()?;
    if let Some(value) = headers.get("sec-websocket-protocol") {
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", value.clone());
    }
    // Do not forward Sec-WebSocket-Extensions. tokio-tungstenite does not
    // support permessage-deflate unless explicitly enabled, and negotiating
    // extensions here can cause upstream handshake failures.
    let proto = forwarded_proto(headers);
    if let Some(origin) = websocket_origin(base_url, headers) {
        if let Ok(value) = HeaderValue::from_str(&origin) {
            request.headers_mut().insert("Origin", value);
        }
    }
    if let Some(value) = headers.get("user-agent") {
        request.headers_mut().insert("User-Agent", value.clone());
    }
    if let Some(value) = headers.get("cookie") {
        request.headers_mut().insert("Cookie", value.clone());
    }
    if let Some(value) = headers.get("authorization") {
        request.headers_mut().insert("Authorization", value.clone());
    }
    if let Some(host) = forwarded_host(headers) {
        if let Ok(value) = HeaderValue::from_str(host) {
            request.headers_mut().insert("X-Forwarded-Host", value);
        }
    }
    if let Ok(value) = HeaderValue::from_str(&proto) {
        request.headers_mut().insert("X-Forwarded-Proto", value);
    }

    Ok(request)
}

async fn proxy_websocket_request(
    base_url: &str,
    path: &str,
    query: Option<&str>,
    headers: &HeaderMap,
    client_socket: axum::extract::ws::WebSocket,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

    let request = build_ws_request(base_url, path, query, headers)?;

    let (upstream_ws, response) = tokio_tungstenite::connect_async(request).await?;
    if let Some(protocol) = response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
    {
        tracing::debug!(protocol = %protocol, "cmux-code upstream websocket protocol");
    }
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
            Ok(TungsteniteMessage::Close(_)) => {
                let _ = client_sink
                    .send(axum::extract::ws::Message::Close(None))
                    .await;
                break;
            }
            Ok(TungsteniteMessage::Ping(data)) => {
                let _ = client_sink
                    .send(axum::extract::ws::Message::Ping(data.into()))
                    .await;
            }
            Ok(TungsteniteMessage::Pong(data)) => {
                let _ = client_sink
                    .send(axum::extract::ws::Message::Pong(data.into()))
                    .await;
            }
            Ok(TungsteniteMessage::Frame(_)) => {}
            Err(_) => break,
        }
    }

    let _ = client_to_upstream.await;
    Ok(())
}

/// Proxy cmux-code (code-server) requests from `/api/cmux-code/*`.
pub async fn cmux_code_proxy(
    ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
    headers: HeaderMap,
    req: axum::http::Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    let method = parts.method;
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");
    let stripped = path_and_query
        .strip_prefix("/api/cmux-code")
        .unwrap_or(path_and_query);
    let (path, query) = split_path_query(stripped);
    let normalized_path = normalize_oss_path(path);
    let path = normalized_path.as_ref();

    if method == Method::OPTIONS {
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::NO_CONTENT.into_response());
        apply_cors(response.headers_mut());
        return response;
    }

    if let Ok(ws) = ws {
        let origin = headers
            .get("origin")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-");
        let host = forwarded_host(&headers).unwrap_or("-");
        let protocol_header = headers
            .get("sec-websocket-protocol")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-");
        let upgrade_header = headers
            .get("upgrade")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-");
        let connection_header = headers
            .get("connection")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("-");
        tracing::info!(
            path = %path,
            query = ?query,
            origin = %origin,
            host = %host,
            upgrade = %upgrade_header,
            connection = %connection_header,
            protocols = %protocol_header,
            "cmux-code websocket upgrade"
        );
        let protocols = headers
            .get("sec-websocket-protocol")
            .and_then(|value| value.to_str().ok())
            .map(|value| {
                value
                    .split(',')
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let ws = if protocols.is_empty() {
            ws
        } else {
            ws.protocols(protocols)
        };
        let base_url = cmux_code_base_url();
        let path = path.to_string();
        let query = query.map(|value| value.to_string());
        return ws.on_upgrade(move |socket| async move {
            if let Err(error) =
                proxy_websocket_request(&base_url, &path, query.as_deref(), &headers, socket).await
            {
                error!("cmux-code WebSocket proxy error: {error}");
            }
        });
    }

    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(err) => {
            error!("Failed to read cmux-code request body: {err}");
            let mut response =
                (StatusCode::BAD_REQUEST, "Failed to read request body").into_response();
            apply_cors(response.headers_mut());
            return response;
        }
    };

    let rewrite = Some(HtmlRewrite {
        host: forwarded_host(&headers).map(|host| host.to_string()),
        proto: forwarded_proto(&headers),
    });

    proxy_http_request_with_rewrite(
        &cmux_code_base_url(),
        method,
        path,
        query,
        headers,
        body_bytes,
        rewrite,
    )
    .await
}

/// Proxy cmux-code static assets served from `/oss-*` paths.
pub async fn cmux_code_asset_proxy(req: axum::http::Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    let method = parts.method;
    let path_and_query = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    if !path_and_query.starts_with("/oss-") {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    }

    let (path, query) = split_path_query(path_and_query);
    let normalized_path = normalize_oss_path(path);
    let path = normalized_path.as_ref();

    if method == Method::OPTIONS {
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::NO_CONTENT.into_response());
        apply_cors(response.headers_mut());
        return response;
    }

    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(err) => {
            error!("Failed to read cmux-code asset request body: {err}");
            let mut response =
                (StatusCode::BAD_REQUEST, "Failed to read request body").into_response();
            apply_cors(response.headers_mut());
            return response;
        }
    };

    proxy_http_request(
        &cmux_code_base_url(),
        method,
        path,
        query,
        parts.headers,
        body_bytes,
    )
    .await
}

/// Serve noVNC static files from `/api/novnc/*`, stripping the prefix.
pub async fn novnc_proxy(uri: Uri) -> Response {
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let stripped = path_and_query
        .strip_prefix("/api/novnc")
        .unwrap_or(path_and_query);
    let path = if stripped.is_empty() || stripped == "/" {
        "/vnc.html"
    } else {
        stripped.split('?').next().unwrap_or(stripped)
    };
    if path == "/vnc.html" && should_rewrite_novnc_path(uri.query()) {
        let query = rewrite_novnc_query(uri.query());
        let redirect_path = format!("/api/novnc/vnc.html?{query}");
        return Redirect::temporary(&redirect_path).into_response();
    }

    let novnc_root = novnc_dir();
    let base_dir = Path::new(&novnc_root);
    let requested = base_dir.join(path.trim_start_matches('/'));
    let canonical = match requested.canonicalize() {
        Ok(path) => path,
        Err(_) => return (StatusCode::NOT_FOUND, "File not found").into_response(),
    };

    if !canonical.starts_with(base_dir) {
        warn!(path = %path, "blocked noVNC directory traversal attempt");
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }

    let file_path = canonical.to_string_lossy().to_string();
    match tokio::fs::read(&file_path).await {
        Ok(contents) => {
            let content_type = match file_path.rsplit('.').next() {
                Some("html") => "text/html; charset=utf-8",
                Some("js") => "application/javascript",
                Some("css") => "text/css",
                Some("png") => "image/png",
                Some("svg") => "image/svg+xml",
                Some("ico") => "image/x-icon",
                _ => "application/octet-stream",
            };
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", content_type)
                .header("Cache-Control", "public, max-age=3600")
                .body(Body::from(contents))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => (StatusCode::NOT_FOUND, "File not found").into_response(),
    }
}

/// WebSocket proxy for noVNC (native Rust VNC proxy, no websockify).
pub async fn novnc_ws(ws: WebSocketUpgrade) -> Response {
    let vnc_addr = SocketAddr::from(([127, 0, 0, 1], vnc_port()));
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = proxy_vnc_websocket(socket, vnc_addr).await {
            error!("noVNC WebSocket proxy error: {error}");
        }
    })
}

/// Raw VNC WebSocket proxy (for direct clients).
pub async fn vnc_ws(ws: WebSocketUpgrade) -> Response {
    let vnc_addr = SocketAddr::from(([127, 0, 0, 1], vnc_port()));
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = proxy_vnc_websocket(socket, vnc_addr).await {
            error!("VNC WebSocket proxy error: {error}");
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_ws_request, forwarded_proto, normalize_oss_path, rewrite_cmux_code_html,
        rewrite_novnc_query, should_rewrite_novnc_path, websocket_origin, HtmlRewrite,
    };
    use axum::body::Bytes;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn novnc_rewrite_when_path_missing() {
        assert!(should_rewrite_novnc_path(None));
        let rewritten = rewrite_novnc_query(None);
        assert_eq!(rewritten, "path=api%2Fnovnc%2Fws");
    }

    #[test]
    fn novnc_rewrite_when_default_path() {
        assert!(should_rewrite_novnc_path(Some("path=websockify")));
        let rewritten = rewrite_novnc_query(Some("path=websockify"));
        assert_eq!(rewritten, "path=api%2Fnovnc%2Fws");
    }

    #[test]
    fn novnc_rewrite_when_legacy_path() {
        assert!(should_rewrite_novnc_path(Some("path=api/novnc/websockify")));
        let rewritten = rewrite_novnc_query(Some("path=api/novnc/websockify"));
        assert_eq!(rewritten, "path=api%2Fnovnc%2Fws");
    }

    #[test]
    fn novnc_preserve_custom_path() {
        assert!(!should_rewrite_novnc_path(Some("path=custom")));
        let rewritten = rewrite_novnc_query(Some("path=custom"));
        assert_eq!(rewritten, "path=custom");
    }

    #[test]
    fn novnc_preserve_other_params() {
        assert!(should_rewrite_novnc_path(Some("autoconnect=true")));
        let rewritten = rewrite_novnc_query(Some("autoconnect=true"));
        assert_eq!(rewritten, "autoconnect=true&path=api%2Fnovnc%2Fws");
    }

    #[test]
    fn forwarded_proto_prefers_https_origin_over_http_header() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("http"));
        headers.insert("origin", HeaderValue::from_static("https://example.com"));
        headers.insert("host", HeaderValue::from_static("example.com"));
        assert_eq!(forwarded_proto(&headers), "https");
    }

    #[test]
    fn forwarded_proto_defaults_https_for_external_host() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("example.com"));
        assert_eq!(forwarded_proto(&headers), "https");
    }

    #[test]
    fn forwarded_proto_defaults_http_for_localhost() {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("localhost"));
        assert_eq!(forwarded_proto(&headers), "http");
    }

    #[test]
    fn rewrite_html_updates_resource_url_host_without_port() {
        let html = r#"<meta id="vscode-workbench-web-configuration" data-settings="{&quot;remoteAuthority&quot;:&quot;example.com:443&quot;,&quot;serverBasePath&quot;:&quot;/&quot;,&quot;productConfiguration&quot;:{&quot;extensionsGallery&quot;:{&quot;resourceUrlTemplate&quot;:&quot;http://example.com/oss-hash/web-extension-resource/open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}&quot;}}}">"#;
        let rewrite = HtmlRewrite {
            host: Some("example.com:443".to_string()),
            proto: "https".to_string(),
        };
        let rewritten = rewrite_cmux_code_html(Bytes::from(html), &rewrite);
        let text = String::from_utf8(rewritten.to_vec()).expect("utf8");
        assert!(text.contains("https://example.com/oss-hash/"));
        assert!(text.contains("/api/cmux-code"));
    }

    #[test]
    fn websocket_origin_prefers_local_upstream_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "origin",
            HeaderValue::from_static("https://proxy.example.com"),
        );
        headers.insert("host", HeaderValue::from_static("proxy.example.com"));
        let origin = websocket_origin("http://127.0.0.1:39378", &headers).expect("origin");
        assert_eq!(origin, "http://127.0.0.1:39378");
    }

    #[test]
    fn websocket_origin_uses_request_origin_for_remote_upstream() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "origin",
            HeaderValue::from_static("https://proxy.example.com"),
        );
        headers.insert("host", HeaderValue::from_static("proxy.example.com"));
        let origin = websocket_origin("https://cmux-code.internal", &headers).expect("origin");
        assert_eq!(origin, "https://proxy.example.com");
    }

    #[test]
    fn websocket_request_omits_extensions_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "sec-websocket-extensions",
            HeaderValue::from_static("permessage-deflate; client_max_window_bits"),
        );
        let request = build_ws_request("http://127.0.0.1:39378", "/oss-hash", None, &headers)
            .expect("build ws request");
        assert!(
            request.headers().get("sec-websocket-extensions").is_none(),
            "Sec-WebSocket-Extensions should not be forwarded"
        );
    }

    #[test]
    fn normalize_oss_path_adds_trailing_slash() {
        let normalized = normalize_oss_path("/oss-hash");
        assert_eq!(normalized, "/oss-hash/");
    }

    #[test]
    fn normalize_oss_path_preserves_nested_path() {
        let normalized = normalize_oss_path("/oss-hash/static/index.js");
        assert_eq!(normalized, "/oss-hash/static/index.js");
    }

    #[test]
    fn normalize_oss_path_keeps_trailing_slash() {
        let normalized = normalize_oss_path("/oss-hash/");
        assert_eq!(normalized, "/oss-hash/");
    }
}
