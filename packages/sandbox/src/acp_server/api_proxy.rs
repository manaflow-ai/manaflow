//! Internal API proxy for forwarding coding CLI requests to API providers.
//!
//! Two modes of operation:
//!
//! 1. Direct mode (local development):
//!    CLI → Local Proxy (has API key) → api.anthropic.com
//!
//! 2. Outer proxy mode (production with Vercel):
//!    CLI → Local Proxy (has JWT) → cmux.sh/api/proxy/anthropic (has API key) → api.anthropic.com
//!
//! In outer proxy mode, the local proxy injects the conversation JWT, and the
//! Vercel proxy verifies it and adds the real API key.

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use reqwest::Client;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tracing::{debug, error, info, warn};

use super::callback::CallbackClient;

/// API provider configuration.
#[derive(Clone)]
pub struct ProviderConfig {
    /// The real API base URL (e.g., "https://api.anthropic.com")
    pub upstream_url: String,
    /// API key to add to requests
    pub api_key: String,
    /// Header name for the API key (e.g., "x-api-key" for Anthropic, "Authorization" for OpenAI)
    pub auth_header: String,
    /// Auth header value format (e.g., "Bearer {key}" for OpenAI, just "{key}" for Anthropic)
    pub auth_format: AuthFormat,
}

/// Format for the auth header value.
#[derive(Clone)]
pub enum AuthFormat {
    /// Just the key: "sk-ant-..."
    Plain,
    /// Bearer token: "Bearer sk-..."
    Bearer,
}

impl ProviderConfig {
    /// Create Anthropic provider config.
    pub fn anthropic(api_key: String) -> Self {
        Self {
            upstream_url: "https://api.anthropic.com".to_string(),
            api_key,
            auth_header: "x-api-key".to_string(),
            auth_format: AuthFormat::Plain,
        }
    }

    /// Create OpenAI provider config.
    pub fn openai(api_key: String) -> Self {
        Self {
            upstream_url: "https://api.openai.com".to_string(),
            api_key,
            auth_header: "authorization".to_string(),
            auth_format: AuthFormat::Bearer,
        }
    }

    /// Create Google AI provider config.
    pub fn google(api_key: String) -> Self {
        Self {
            upstream_url: "https://generativelanguage.googleapis.com".to_string(),
            api_key,
            auth_header: "x-goog-api-key".to_string(),
            auth_format: AuthFormat::Plain,
        }
    }

    /// Create Anthropic outer proxy config (forwards to Vercel proxy with JWT).
    pub fn anthropic_outer(outer_proxy_url: String, conversation_jwt: String) -> Self {
        Self {
            upstream_url: outer_proxy_url,
            api_key: conversation_jwt,
            auth_header: "authorization".to_string(),
            auth_format: AuthFormat::Bearer,
        }
    }

    /// Create OpenAI outer proxy config (forwards to Vercel proxy with JWT).
    pub fn openai_outer(outer_proxy_url: String, conversation_jwt: String) -> Self {
        Self {
            upstream_url: outer_proxy_url,
            api_key: conversation_jwt,
            auth_header: "authorization".to_string(),
            auth_format: AuthFormat::Bearer,
        }
    }

    /// Get the formatted auth header value.
    fn auth_value(&self) -> String {
        match self.auth_format {
            AuthFormat::Plain => self.api_key.clone(),
            AuthFormat::Bearer => format!("Bearer {}", self.api_key),
        }
    }
}

/// State for the API proxy.
#[derive(Clone)]
pub struct ApiProxyState {
    /// HTTP client for forwarding requests
    client: Client,
    /// Provider configuration
    config: ProviderConfig,
}

impl ApiProxyState {
    /// Create a new proxy state.
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

/// Handle all requests by proxying to upstream.
async fn proxy_handler(
    State(state): State<ApiProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    // Build upstream URL
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let upstream_url = format!("{}{}", state.config.upstream_url, path_and_query);

    debug!(
        method = %method,
        path = %path_and_query,
        upstream = %upstream_url,
        "Proxying request"
    );

    // Build request to upstream
    let mut request_builder = state.client.request(method.clone(), &upstream_url);

    // Copy headers, excluding host and content-length (will be recalculated)
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers and headers we'll set ourselves
        if name_str == "host"
            || name_str == "content-length"
            || name_str == "transfer-encoding"
            || name_str == "connection"
            || name_str == state.config.auth_header.to_lowercase()
        {
            continue;
        }
        if let Ok(header_value) = value.to_str() {
            request_builder = request_builder.header(name.as_str(), header_value);
        }
    }

    // Add the API key header
    request_builder = request_builder.header(&state.config.auth_header, state.config.auth_value());

    // Get body bytes
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read request body");
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };

    // Send request
    let response = match request_builder.body(body_bytes).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!(error = %e, upstream = %upstream_url, "Upstream request failed");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(format!("Upstream request failed: {}", e)))
                .unwrap();
        }
    };

    // Build response
    let status = response.status();
    let response_headers = response.headers().clone();

    // Get response body as stream for streaming responses
    let response_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read upstream response");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("Failed to read upstream response"))
                .unwrap();
        }
    };

    // Build axum response
    let mut builder = Response::builder().status(status);

    // Copy response headers
    for (name, value) in response_headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers
        if name_str == "transfer-encoding" || name_str == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    builder.body(Body::from(response_bytes)).unwrap()
}

/// API proxy server handle.
pub struct ApiProxy {
    /// Address the proxy is listening on
    pub addr: SocketAddr,
    /// Shutdown signal sender
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ApiProxy {
    /// Start a new API proxy server.
    pub async fn start(config: ProviderConfig, port: u16) -> anyhow::Result<Self> {
        let state = ApiProxyState::new(config);

        let app = Router::new()
            .route("/{*path}", any(proxy_handler))
            .route("/", any(proxy_handler))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = TcpListener::bind(addr).await?;
        let actual_addr = listener.local_addr()?;

        info!(addr = %actual_addr, "API proxy started");

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        // Spawn server task
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        Ok(Self {
            addr: actual_addr,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Get the base URL for this proxy.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Stop the proxy server.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for ApiProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Collection of API proxies for different providers.
pub struct ApiProxies {
    pub anthropic: Option<ApiProxy>,
    pub openai: Option<ApiProxy>,
    pub google: Option<ApiProxy>,
}

impl ApiProxies {
    /// Start proxies for the given API keys.
    pub async fn start(
        anthropic_key: Option<String>,
        openai_key: Option<String>,
        google_key: Option<String>,
    ) -> anyhow::Result<Self> {
        let anthropic = if let Some(key) = anthropic_key {
            Some(ApiProxy::start(ProviderConfig::anthropic(key), 0).await?)
        } else {
            None
        };

        let openai = if let Some(key) = openai_key {
            Some(ApiProxy::start(ProviderConfig::openai(key), 0).await?)
        } else {
            None
        };

        let google = if let Some(key) = google_key {
            Some(ApiProxy::start(ProviderConfig::google(key), 0).await?)
        } else {
            None
        };

        Ok(Self {
            anthropic,
            openai,
            google,
        })
    }

    /// Get environment variables to set for CLI processes.
    pub fn env_vars(&self) -> Vec<(String, String)> {
        let mut vars = Vec::new();

        if let Some(ref proxy) = self.anthropic {
            vars.push(("ANTHROPIC_BASE_URL".to_string(), proxy.base_url()));
        }

        if let Some(ref proxy) = self.openai {
            vars.push(("OPENAI_BASE_URL".to_string(), proxy.base_url()));
        }

        // Google doesn't have a simple base URL env var, skip for now
        // if let Some(ref proxy) = self.google {
        //     vars.push(("GOOGLE_AI_BASE_URL".to_string(), proxy.base_url()));
        // }

        vars
    }
}

/// Shared JWT holder that can be set dynamically.
#[derive(Clone)]
pub struct JwtHolder {
    jwt: std::sync::Arc<tokio::sync::RwLock<Option<String>>>,
    notify: std::sync::Arc<tokio::sync::Notify>,
}

impl JwtHolder {
    /// Create a new JWT holder, optionally with an initial JWT.
    pub fn new(initial_jwt: Option<String>) -> Self {
        Self {
            jwt: std::sync::Arc::new(tokio::sync::RwLock::new(initial_jwt)),
            notify: std::sync::Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// Set the JWT, waking any waiters.
    pub async fn set(&self, jwt: String) {
        let mut guard = self.jwt.write().await;
        *guard = Some(jwt);
        self.notify.notify_waiters();
    }

    /// Get the JWT, waiting up to timeout if not set.
    pub async fn get_with_timeout(&self, timeout: std::time::Duration) -> Option<String> {
        // Check if already set
        {
            let guard = self.jwt.read().await;
            if let Some(ref jwt) = *guard {
                return Some(jwt.clone());
            }
        }

        // Wait for notification with timeout
        let wait_result = tokio::time::timeout(timeout, self.notify.notified()).await;

        // Check again after waiting
        if wait_result.is_ok() {
            let guard = self.jwt.read().await;
            guard.clone()
        } else {
            // Timeout - check one more time
            let guard = self.jwt.read().await;
            guard.clone()
        }
    }

    /// Get the JWT immediately without waiting.
    #[allow(dead_code)]
    pub async fn get(&self) -> Option<String> {
        self.jwt.read().await.clone()
    }
}

/// Configuration for error callbacks (set dynamically after proxy starts).
#[derive(Clone)]
pub struct ErrorCallbackConfig {
    pub callback_url: String,
    pub sandbox_id: String,
}

/// Holder for error callback configuration that can be set dynamically.
#[derive(Clone)]
pub struct ErrorCallbackHolder {
    config: Arc<tokio::sync::RwLock<Option<ErrorCallbackConfig>>>,
}

impl ErrorCallbackHolder {
    /// Create a new holder without config.
    pub fn new() -> Self {
        Self {
            config: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    /// Set the error callback configuration.
    pub async fn set(&self, config: ErrorCallbackConfig) {
        let mut guard = self.config.write().await;
        *guard = Some(config);
    }

    /// Get the config (if set).
    pub async fn get(&self) -> Option<ErrorCallbackConfig> {
        self.config.read().await.clone()
    }
}

impl Default for ErrorCallbackHolder {
    fn default() -> Self {
        Self::new()
    }
}

/// Provider route configuration.
#[derive(Clone)]
struct ProviderRoute {
    /// Path prefix (e.g., "/anthropic")
    path_prefix: String,
    /// Outer proxy URL (e.g., "https://cmux.sh/api/anthropic")
    outer_proxy_url: String,
}

/// Retry configuration for API requests.
const MAX_RETRIES: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 500;
const MAX_BACKOFF_MS: u64 = 5000;

/// State for the unified outer proxy handler that routes by path prefix.
#[derive(Clone)]
struct UnifiedProxyState {
    /// HTTP client for forwarding requests
    client: Client,
    /// Provider routes indexed by path prefix
    routes: Vec<ProviderRoute>,
    /// JWT holder for dynamic JWT setting
    jwt_holder: JwtHolder,
    /// Timeout for waiting for JWT
    jwt_timeout: std::time::Duration,
    /// Error callback holder for reporting persistent errors
    error_callback_holder: ErrorCallbackHolder,
}

impl UnifiedProxyState {
    /// Find the matching route for a path.
    fn find_route(&self, path: &str) -> Option<&ProviderRoute> {
        self.routes
            .iter()
            .find(|r| path.starts_with(&r.path_prefix))
    }
}

/// State for the outer proxy handler that waits for JWT (legacy, for single-provider proxy).
#[derive(Clone)]
struct OuterProxyState {
    /// HTTP client for forwarding requests
    client: Client,
    /// Outer proxy URL (e.g., "https://cmux.sh/api/proxy/anthropic")
    outer_proxy_url: String,
    /// JWT holder for dynamic JWT setting
    jwt_holder: JwtHolder,
    /// Timeout for waiting for JWT
    jwt_timeout: std::time::Duration,
}

/// Handle requests by waiting for JWT and forwarding to outer proxy.
async fn outer_proxy_handler(
    State(state): State<OuterProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    // Wait for JWT with timeout
    let jwt = match state.jwt_holder.get_with_timeout(state.jwt_timeout).await {
        Some(jwt) => jwt,
        None => {
            error!("JWT not set within timeout, rejecting request");
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Body::from("JWT not configured"))
                .unwrap();
        }
    };

    // Build upstream URL
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let upstream_url = format!("{}{}", state.outer_proxy_url, path_and_query);

    debug!(
        method = %method,
        path = %path_and_query,
        upstream = %upstream_url,
        "Proxying request to outer proxy"
    );

    // Build request to upstream
    let mut request_builder = state.client.request(method.clone(), &upstream_url);

    // Copy headers, excluding host and content-length (will be recalculated)
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers and auth (we add our own)
        if name_str == "host"
            || name_str == "content-length"
            || name_str == "transfer-encoding"
            || name_str == "connection"
            || name_str == "authorization"
            || name_str == "x-api-key"
        {
            continue;
        }
        if let Ok(header_value) = value.to_str() {
            request_builder = request_builder.header(name.as_str(), header_value);
        }
    }

    // Add JWT as Bearer token
    request_builder = request_builder.header("Authorization", format!("Bearer {}", jwt));

    // Get body bytes
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read request body");
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };

    // Send request
    let response = match request_builder.body(body_bytes).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!(error = %e, upstream = %upstream_url, "Outer proxy request failed");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(format!("Outer proxy request failed: {}", e)))
                .unwrap();
        }
    };

    // Build response
    let status = response.status();
    let response_headers = response.headers().clone();

    // Get response body
    let response_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read outer proxy response");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("Failed to read outer proxy response"))
                .unwrap();
        }
    };

    // Build axum response
    let mut builder = Response::builder().status(status);

    // Copy response headers
    for (name, value) in response_headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers
        if name_str == "transfer-encoding" || name_str == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    builder.body(Body::from(response_bytes)).unwrap()
}

/// Check if a status code is retryable (429 or 5xx).
fn is_retryable_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

/// Calculate backoff duration for a given attempt (0-indexed).
fn calculate_backoff(attempt: u32) -> Duration {
    let backoff_ms = INITIAL_BACKOFF_MS * 2u64.pow(attempt);
    Duration::from_millis(backoff_ms.min(MAX_BACKOFF_MS))
}

/// Build headers for upstream request, filtering out hop-by-hop headers.
fn build_upstream_headers(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let name_str = name.as_str().to_lowercase();
            // Skip hop-by-hop headers and auth (we add our own)
            if name_str == "host"
                || name_str == "content-length"
                || name_str == "transfer-encoding"
                || name_str == "connection"
                || name_str == "authorization"
                || name_str == "x-api-key"
            {
                return None;
            }
            value
                .to_str()
                .ok()
                .map(|v| (name.to_string(), v.to_string()))
        })
        .collect()
}

/// Send error callback to Convex if error callback is configured.
async fn send_error_callback_if_configured(
    state: &UnifiedProxyState,
    jwt: &str,
    code: &str,
    detail: Option<&str>,
) {
    let config = match state.error_callback_holder.get().await {
        Some(config) => config,
        None => {
            debug!("Error callback not configured, skipping");
            return;
        }
    };

    let callback_client = CallbackClient::new(&config.callback_url, jwt);
    callback_client
        .report_sandbox_error(&config.sandbox_id, code, detail)
        .await;
    info!(
        sandbox_id = %config.sandbox_id,
        code = %code,
        "Sent error callback to Convex"
    );
}

/// Handle requests by routing based on path prefix and forwarding to outer proxy.
/// Includes retry logic for transient errors (429, 5xx) with exponential backoff.
async fn unified_proxy_handler(
    State(state): State<UnifiedProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    // Wait for JWT with timeout
    let jwt = match state.jwt_holder.get_with_timeout(state.jwt_timeout).await {
        Some(jwt) => jwt,
        None => {
            error!("JWT not set within timeout, rejecting request");
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Body::from("JWT not configured"))
                .unwrap();
        }
    };

    // Get path and find matching route
    let path = uri.path();
    let route = match state.find_route(path) {
        Some(route) => route,
        None => {
            error!(path = %path, "No matching route for path");
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Body::from(format!("No route for path: {}", path)))
                .unwrap();
        }
    };

    // Strip the path prefix to get the actual API path
    let api_path = path.strip_prefix(&route.path_prefix).unwrap_or(path);
    let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let upstream_url = format!("{}{}{}", route.outer_proxy_url, api_path, query);

    debug!(
        method = %method,
        path = %path,
        api_path = %api_path,
        upstream = %upstream_url,
        "Proxying request to outer proxy"
    );

    // Get body bytes upfront (needed for retries)
    let body_bytes: Bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read request body");
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };

    // Build headers once (for retries)
    let upstream_headers = build_upstream_headers(&headers);

    // Retry loop
    let mut last_status: Option<StatusCode> = None;
    let mut last_response_bytes: Option<Bytes> = None;
    let mut last_response_headers: Option<reqwest::header::HeaderMap> = None;

    for attempt in 0..=MAX_RETRIES {
        if attempt > 0 {
            let backoff = calculate_backoff(attempt - 1);
            warn!(
                attempt = attempt,
                backoff_ms = backoff.as_millis(),
                upstream = %upstream_url,
                "Retrying request after backoff"
            );
            tokio::time::sleep(backoff).await;
        }

        // Build request
        let mut request_builder = state.client.request(method.clone(), &upstream_url);

        // Add headers
        for (name, value) in &upstream_headers {
            request_builder = request_builder.header(name.as_str(), value.as_str());
        }

        // Add JWT as Bearer token
        request_builder = request_builder.header("Authorization", format!("Bearer {}", jwt));

        // Send request
        let response = match request_builder.body(body_bytes.clone()).send().await {
            Ok(resp) => resp,
            Err(e) => {
                error!(
                    error = %e,
                    upstream = %upstream_url,
                    attempt = attempt,
                    "Outer proxy request failed"
                );
                // Network errors are retryable
                if attempt < MAX_RETRIES {
                    continue;
                }
                // After all retries, send error callback and return error
                send_error_callback_if_configured(
                    &state,
                    &jwt,
                    "network_error",
                    Some(&format!(
                        "Request failed after {} retries: {}",
                        MAX_RETRIES + 1,
                        e
                    )),
                )
                .await;
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from(format!("Outer proxy request failed: {}", e)))
                    .unwrap();
            }
        };

        let status = response.status();
        let response_headers = response.headers().clone();

        // Get response body
        let response_bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(e) => {
                error!(error = %e, "Failed to read outer proxy response");
                if attempt < MAX_RETRIES {
                    continue;
                }
                send_error_callback_if_configured(
                    &state,
                    &jwt,
                    "response_error",
                    Some(&format!("Failed to read response: {}", e)),
                )
                .await;
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::from("Failed to read outer proxy response"))
                    .unwrap();
            }
        };

        // Check if error is retryable
        if is_retryable_status(status) && attempt < MAX_RETRIES {
            warn!(
                status = %status,
                attempt = attempt,
                upstream = %upstream_url,
                "Retryable error, will retry"
            );
            last_status = Some(status);
            last_response_bytes = Some(response_bytes);
            last_response_headers = Some(response_headers);
            continue;
        }

        // Success or non-retryable error after all retries
        if is_retryable_status(status) {
            // All retries exhausted for a retryable error - send error callback
            let error_code = if status == StatusCode::TOO_MANY_REQUESTS {
                "rate_limit"
            } else {
                "server_error"
            };
            let detail = String::from_utf8_lossy(&response_bytes);
            let detail_preview = if detail.len() > 500 {
                format!("{}...", &detail[..500])
            } else {
                detail.to_string()
            };
            error!(
                status = %status,
                upstream = %upstream_url,
                detail = %detail_preview,
                "All retries exhausted, reporting error"
            );
            send_error_callback_if_configured(
                &state,
                &jwt,
                error_code,
                Some(&format!(
                    "API error {} after {} retries: {}",
                    status.as_u16(),
                    MAX_RETRIES + 1,
                    detail_preview
                )),
            )
            .await;
        }

        // Build and return response
        last_status = Some(status);
        last_response_bytes = Some(response_bytes);
        last_response_headers = Some(response_headers);
        break;
    }

    // Build final response
    let status = last_status.unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let response_bytes = last_response_bytes.unwrap_or_default();
    let response_headers = last_response_headers.unwrap_or_default();

    // Build axum response
    let mut builder = Response::builder().status(status);

    // Copy response headers
    for (name, value) in response_headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers
        if name_str == "transfer-encoding" || name_str == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    builder.body(Body::from(response_bytes)).unwrap()
}

/// Unified API proxy that routes multiple providers through a single server.
pub struct UnifiedApiProxy {
    /// Address the proxy is listening on
    pub addr: SocketAddr,
    /// JWT holder for setting JWT dynamically
    jwt_holder: JwtHolder,
    /// Error callback holder for reporting persistent errors
    error_callback_holder: ErrorCallbackHolder,
    /// Shutdown signal sender
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl UnifiedApiProxy {
    /// Start a unified proxy that routes by path prefix.
    ///
    /// # Arguments
    /// * `api_proxy_url` - Base URL of the outer API proxy (e.g., "https://cmux.sh")
    /// * `providers` - List of provider path prefixes to route (e.g., ["anthropic", "openai"])
    /// * `initial_jwt` - Optional initial JWT (can be set later via `set_jwt`)
    /// * `jwt_timeout` - How long to wait for JWT if not set when request arrives
    pub async fn start(
        api_proxy_url: &str,
        providers: &[&str],
        initial_jwt: Option<String>,
        jwt_timeout: std::time::Duration,
    ) -> anyhow::Result<Self> {
        let jwt_holder = JwtHolder::new(initial_jwt);
        let error_callback_holder = ErrorCallbackHolder::new();

        // Build routes for each provider
        let mut routes: Vec<ProviderRoute> = providers
            .iter()
            .map(|provider| ProviderRoute {
                path_prefix: format!("/{}", provider),
                outer_proxy_url: format!("{}/api/{}", api_proxy_url, provider),
            })
            .collect();

        // Add fallback routes for OpenAI paths that Codex may use directly.
        // Codex ignores the path portion of base_url and calls these paths directly.
        routes.push(ProviderRoute {
            path_prefix: "/v1".to_string(),
            outer_proxy_url: format!("{}/api/openai/v1", api_proxy_url),
        });
        routes.push(ProviderRoute {
            path_prefix: "/responses".to_string(),
            outer_proxy_url: format!("{}/api/openai/v1/responses", api_proxy_url),
        });

        info!(
            routes = ?routes.iter().map(|r| &r.path_prefix).collect::<Vec<_>>(),
            "Setting up unified proxy routes"
        );

        let state = UnifiedProxyState {
            client: Client::new(),
            routes,
            jwt_holder: jwt_holder.clone(),
            jwt_timeout,
            error_callback_holder: error_callback_holder.clone(),
        };

        let app = Router::new()
            .route("/{*path}", any(unified_proxy_handler))
            .route("/", any(unified_proxy_handler))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        let listener = TcpListener::bind(addr).await?;
        let actual_addr = listener.local_addr()?;

        info!(addr = %actual_addr, "Unified API proxy started");

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        // Spawn server task
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        Ok(Self {
            addr: actual_addr,
            jwt_holder,
            error_callback_holder,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Set the JWT for this proxy.
    pub async fn set_jwt(&self, jwt: String) {
        self.jwt_holder.set(jwt).await;
    }

    /// Set the error callback configuration for this proxy.
    /// When set, the proxy will report persistent errors (429/5xx after retries) to Convex.
    pub async fn set_error_callback(&self, callback_url: String, sandbox_id: String) {
        self.error_callback_holder
            .set(ErrorCallbackConfig {
                callback_url,
                sandbox_id,
            })
            .await;
    }

    /// Get the base URL for this proxy.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Get the base URL for a specific provider.
    pub fn provider_url(&self, provider: &str) -> String {
        format!("http://{}/{}", self.addr, provider)
    }

    /// Stop the proxy server.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for UnifiedApiProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Per-conversation proxy that injects JWT and forwards to outer proxy (Vercel).
/// Supports dynamic JWT setting - if JWT isn't set before first request, waits up to timeout.
pub struct ConversationApiProxy {
    /// Address the proxy is listening on
    pub addr: SocketAddr,
    /// JWT holder for setting JWT dynamically
    jwt_holder: JwtHolder,
    /// Shutdown signal sender
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ConversationApiProxy {
    /// Start a per-conversation proxy that forwards to outer proxy with JWT.
    ///
    /// # Arguments
    /// * `outer_proxy_url` - Full URL of the outer proxy endpoint (e.g., "https://cmux.sh/api/proxy/anthropic")
    /// * `initial_jwt` - Optional initial JWT (can be set later via `set_jwt`)
    /// * `jwt_timeout` - How long to wait for JWT if not set when request arrives
    pub async fn start(
        outer_proxy_url: String,
        initial_jwt: Option<String>,
        jwt_timeout: std::time::Duration,
    ) -> anyhow::Result<Self> {
        let jwt_holder = JwtHolder::new(initial_jwt);

        let state = OuterProxyState {
            client: Client::new(),
            outer_proxy_url,
            jwt_holder: jwt_holder.clone(),
            jwt_timeout,
        };

        let app = Router::new()
            .route("/{*path}", any(outer_proxy_handler))
            .route("/", any(outer_proxy_handler))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        let listener = TcpListener::bind(addr).await?;
        let actual_addr = listener.local_addr()?;

        info!(addr = %actual_addr, "Per-conversation API proxy started");

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        // Spawn server task
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        Ok(Self {
            addr: actual_addr,
            jwt_holder,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Set the JWT for this proxy.
    pub async fn set_jwt(&self, jwt: String) {
        self.jwt_holder.set(jwt).await;
    }

    /// Get the base URL for this proxy.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Stop the proxy server.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for ConversationApiProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Collection of per-conversation API proxies using a unified server.
pub struct ConversationApiProxies {
    /// Unified proxy handling all providers
    proxy: UnifiedApiProxy,
}

impl ConversationApiProxies {
    /// Start per-conversation proxies that forward to outer proxy.
    ///
    /// # Arguments
    /// * `api_proxy_url` - Base URL of the API proxy (e.g., "https://cmux.sh")
    /// * `initial_jwt` - Optional initial JWT (can be set later)
    /// * `jwt_timeout` - How long to wait for JWT if not set when request arrives
    pub async fn start(
        api_proxy_url: &str,
        initial_jwt: Option<String>,
        jwt_timeout: std::time::Duration,
    ) -> anyhow::Result<Self> {
        // Start unified proxy with routes for both Anthropic and OpenAI
        let proxy = UnifiedApiProxy::start(
            api_proxy_url,
            &["anthropic", "openai"],
            initial_jwt,
            jwt_timeout,
        )
        .await?;

        Ok(Self { proxy })
    }

    /// Set JWT on the unified proxy.
    pub async fn set_jwt(&self, jwt: String) {
        self.proxy.set_jwt(jwt).await;
    }

    /// Set error callback configuration on the unified proxy.
    /// When set, the proxy will report persistent errors (429/5xx after retries) to Convex.
    pub async fn set_error_callback(&self, callback_url: String, sandbox_id: String) {
        self.proxy
            .set_error_callback(callback_url, sandbox_id)
            .await;
    }

    /// Get the Anthropic proxy (for logging/compatibility).
    /// Returns the unified proxy since it handles Anthropic routes.
    pub fn anthropic(&self) -> Option<&UnifiedApiProxy> {
        Some(&self.proxy)
    }

    /// Get the OpenAI proxy (for logging/compatibility).
    /// Returns the unified proxy since it handles OpenAI routes.
    pub fn openai(&self) -> Option<&UnifiedApiProxy> {
        Some(&self.proxy)
    }

    /// Get environment variables to set for CLI processes.
    /// Sets both the base URL (to route through proxy) and a placeholder API key
    /// (so the CLI doesn't reject requests before they reach the proxy).
    pub fn env_vars(&self) -> Vec<(String, String)> {
        vec![
            // Anthropic - route through unified proxy with /anthropic prefix
            (
                "ANTHROPIC_BASE_URL".to_string(),
                self.proxy.provider_url("anthropic"),
            ),
            (
                "ANTHROPIC_API_KEY".to_string(),
                "sk-ant-proxy-placeholder".to_string(),
            ),
            // OpenAI - route through unified proxy with /openai prefix
            (
                "OPENAI_BASE_URL".to_string(),
                self.proxy.provider_url("openai"),
            ),
            (
                "OPENAI_API_KEY".to_string(),
                "sk-openai-proxy-placeholder".to_string(),
            ),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_format() {
        let anthropic = ProviderConfig::anthropic("sk-ant-test".to_string());
        assert_eq!(anthropic.auth_value(), "sk-ant-test");

        let openai = ProviderConfig::openai("sk-test".to_string());
        assert_eq!(openai.auth_value(), "Bearer sk-test");
    }

    #[tokio::test]
    async fn test_jwt_holder_immediate() {
        // Test that JWT is returned immediately when already set
        let holder = JwtHolder::new(Some("test-jwt".to_string()));
        let jwt = holder
            .get_with_timeout(std::time::Duration::from_millis(100))
            .await;
        assert_eq!(jwt, Some("test-jwt".to_string()));
    }

    #[tokio::test]
    async fn test_jwt_holder_timeout() {
        // Test that timeout works when JWT is not set
        let holder = JwtHolder::new(None);
        let start = std::time::Instant::now();
        let jwt = holder
            .get_with_timeout(std::time::Duration::from_millis(100))
            .await;
        let elapsed = start.elapsed();

        assert!(jwt.is_none());
        assert!(elapsed >= std::time::Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_jwt_holder_set_after_wait() {
        // Test that JWT is returned when set during wait
        let holder = JwtHolder::new(None);
        let holder_clone = holder.clone();

        // Spawn task to set JWT after a delay
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            holder_clone.set("delayed-jwt".to_string()).await;
        });

        // This should wait and receive the JWT
        let jwt = holder
            .get_with_timeout(std::time::Duration::from_millis(200))
            .await;
        assert_eq!(jwt, Some("delayed-jwt".to_string()));
    }

    #[tokio::test]
    async fn test_jwt_holder_set_before_timeout() {
        // Test the exact scenario: JWT set AFTER wait starts but BEFORE timeout
        // This simulates the real use case where:
        // 1. LLM request comes in (starts waiting for JWT)
        // 2. REST API sets JWT
        // 3. LLM request continues with the JWT
        let holder = JwtHolder::new(None);
        let holder_for_setter = holder.clone();

        // Start waiting in background - wait up to 5 seconds
        let waiter = tokio::spawn(async move {
            holder
                .get_with_timeout(std::time::Duration::from_secs(5))
                .await
        });

        // Wait a bit, then set the JWT (simulating REST API call)
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        holder_for_setter.set("api-jwt".to_string()).await;

        // The waiter should have received the JWT
        let result = waiter.await.unwrap();
        assert_eq!(result, Some("api-jwt".to_string()));
    }
}
