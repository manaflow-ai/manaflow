//! cmux-acp-server binary entry point.
//!
//! Standalone ACP server for sandbox integration. Handles REST API requests
//! from Convex and manages conversations with coding CLIs.
//!
//! SECURITY: This server has NO direct Convex access. It can only communicate
//! back to Convex via the callback URL using the JWT provided at spawn time.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use clap::Parser;
use tracing::{error, info, warn, Level};
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use cmux_sandbox::acp_server::{
    configure, init_conversation, pty_capture_session, pty_create_session, pty_delete_session,
    pty_get_session, pty_health, pty_input_session, pty_list_sessions, pty_preflight,
    pty_resize_session, pty_session_ws, pty_update_session, receive_prompt, send_rpc,
    stream_acp_events, stream_preflight, ApiProxies, CallbackClient, RestApiDoc, RestApiState,
};

/// ACP Server for sandbox integration.
#[derive(Parser, Debug)]
#[command(name = "cmux-acp-server")]
#[command(about = "ACP server for cmux sandbox")]
struct Args {
    /// Port to listen on
    #[arg(short, long, env = "ACP_PORT", default_value = "39384")]
    port: u16,

    /// JWT secret for conversation token verification (optional when using /api/acp/configure)
    #[arg(long, env = "CMUX_CONVERSATION_JWT_SECRET")]
    jwt_secret: Option<String>,

    /// Default working directory for spawned CLIs
    #[arg(long, env = "ACP_WORKING_DIR", default_value = "/workspace")]
    working_dir: PathBuf,

    /// Anthropic API key for Claude Code
    #[arg(long, env = "ANTHROPIC_API_KEY")]
    anthropic_api_key: Option<String>,

    /// OpenAI API key for Codex
    #[arg(long, env = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,

    /// Google API key for Gemini CLI
    #[arg(long, env = "GOOGLE_API_KEY")]
    google_api_key: Option<String>,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,

    /// Use internal API proxy instead of passing API keys directly to CLIs.
    /// This is more secure as API keys are never exposed to CLI processes.
    #[arg(long, env = "ACP_USE_PROXY", default_value = "true")]
    use_proxy: bool,

    /// API proxy URL (e.g., "https://cmux.sh/api") for production mode.
    /// When set, per-conversation proxies forward to this URL with JWT authentication
    /// instead of using local API keys. The proxy verifies the JWT and injects the real API key.
    #[arg(long, env = "API_PROXY_URL")]
    api_proxy_url: Option<String>,

    // === Callback mode environment variables (set by Convex when spawning sandbox) ===
    /// Convex callback URL for posting state updates.
    /// This is the ONLY way the sandbox can communicate back to Convex.
    /// Example: https://polite-canary-804.convex.site/api/acp/callback
    #[arg(long, env = "CONVEX_CALLBACK_URL")]
    callback_url: Option<String>,

    /// JWT token for authenticating callbacks to Convex.
    /// Contains sandboxId and teamId claims. Provided by Convex at sandbox spawn time.
    #[arg(long, env = "SANDBOX_JWT")]
    sandbox_jwt: Option<String>,

    /// Sandbox ID (Convex document ID) for this instance.
    /// Used for sandbox_ready callback and logging.
    #[arg(long, env = "SANDBOX_ID")]
    sandbox_id: Option<String>,
}

/// Health check endpoint response.
#[derive(serde::Serialize, utoipa::ToSchema)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// Health check handler.
#[utoipa::path(
    get,
    path = "/health",
    responses(
        (status = 200, description = "Server is healthy", body = HealthResponse)
    ),
    tag = "health"
)]
async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// OpenAPI documentation for the ACP server.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "cmux ACP Server",
        description = "ACP (Agent Client Protocol) server for sandbox integration. \
            Provides REST endpoints for Convex to control the sandbox and spawn coding agents.",
        version = "0.1.0"
    ),
    paths(health),
    components(schemas(HealthResponse)),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "acp", description = "ACP sandbox control endpoints")
    )
)]
struct ApiDoc;

/// Merge OpenAPI documents.
fn merged_openapi() -> utoipa::openapi::OpenApi {
    let mut api = ApiDoc::openapi();
    let rest_api = RestApiDoc::openapi();
    api.merge(rest_api);
    api
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize logging
    let filter = if args.verbose {
        EnvFilter::default().add_directive(Level::DEBUG.into())
    } else {
        EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::default().add_directive(Level::INFO.into()))
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();

    // Check if we're in callback mode (required for persistence)
    let callback_mode = args.callback_url.is_some() && args.sandbox_jwt.is_some();

    info!(
        port = args.port,
        working_dir = %args.working_dir.display(),
        use_proxy = args.use_proxy,
        api_proxy_url = ?args.api_proxy_url,
        callback_mode = callback_mode,
        sandbox_id = ?args.sandbox_id,
        "Starting cmux-acp-server"
    );

    // Initialize callback client if in callback mode
    // This is the ONLY way the sandbox can communicate back to Convex
    let callback_client =
        if let (Some(callback_url), Some(sandbox_jwt)) = (&args.callback_url, &args.sandbox_jwt) {
            info!(
                callback_url = %callback_url,
                "Callback mode enabled - sandbox can persist to Convex"
            );
            Some(CallbackClient::new(
                callback_url.clone(),
                sandbox_jwt.clone(),
            ))
        } else {
            warn!("Callback mode NOT enabled - sandbox cannot persist to Convex!");
            warn!("Set CONVEX_CALLBACK_URL and SANDBOX_JWT for persistence.");
            None
        };

    // Start API proxies if configured (for passing API keys securely to CLIs)
    let _api_proxies = if args.use_proxy
        && (args.anthropic_api_key.is_some()
            || args.openai_api_key.is_some()
            || args.google_api_key.is_some())
    {
        info!("Starting local API proxies...");
        let proxies = ApiProxies::start(
            args.anthropic_api_key.clone(),
            args.openai_api_key.clone(),
            args.google_api_key.clone(),
        )
        .await?;

        if let Some(ref proxy) = proxies.anthropic {
            info!(base_url = %proxy.base_url(), "Anthropic API proxy started");
        }
        if let Some(ref proxy) = proxies.openai {
            info!(base_url = %proxy.base_url(), "OpenAI API proxy started");
        }
        if let Some(ref proxy) = proxies.google {
            info!(base_url = %proxy.base_url(), "Google API proxy started");
        }

        Some(Arc::new(proxies))
    } else {
        None
    };

    // Create REST API state for ACP endpoints (Convex -> Sandbox communication)
    // SECURITY: RestApiState only has callback access, not direct Convex query/mutation access
    let mut rest_state = RestApiState::new().with_default_cwd(args.working_dir.clone());

    if let Some(ref client) = callback_client {
        rest_state = rest_state.with_callback_client(client.clone());
        info!("REST API configured with callback client for Convex persistence");
    }

    // Build REST API router for ACP endpoints
    // These endpoints allow Convex to control the sandbox:
    // - /api/acp/configure: Inject callback settings (required after spawn)
    // - /api/acp/init: Initialize a conversation (spawn CLI)
    // - /api/acp/prompt: Send prompts to an active conversation
    let app = Router::new()
        .route("/health", get(health))
        .route("/healthz", get(health))
        .route("/api/acp/configure", post(configure))
        .route("/api/acp/init", post(init_conversation))
        .route("/api/acp/prompt", post(receive_prompt))
        .route("/api/acp/rpc", post(send_rpc))
        .route(
            "/api/acp/stream/{conversation_id}",
            get(stream_acp_events).options(stream_preflight),
        )
        .route("/api/pty/health", get(pty_health).options(pty_preflight))
        .route(
            "/api/pty/sessions",
            get(pty_list_sessions)
                .post(pty_create_session)
                .options(pty_preflight),
        )
        .route(
            "/api/pty/sessions/{session_id}",
            get(pty_get_session)
                .delete(pty_delete_session)
                .patch(pty_update_session)
                .options(pty_preflight),
        )
        .route(
            "/api/pty/sessions/{session_id}/resize",
            post(pty_resize_session).options(pty_preflight),
        )
        .route(
            "/api/pty/sessions/{session_id}/capture",
            get(pty_capture_session).options(pty_preflight),
        )
        .route(
            "/api/pty/sessions/{session_id}/input",
            post(pty_input_session).options(pty_preflight),
        )
        .route(
            "/api/pty/sessions/{session_id}/ws",
            get(pty_session_ws),
        )
        .with_state(rest_state)
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", merged_openapi()));

    // Bind and serve (IPv4 + best-effort IPv6)
    let addr_v4 = SocketAddr::from(([0, 0, 0, 0], args.port));
    info!("Listening on {}", addr_v4);

    // If in callback mode, notify Convex that sandbox is ready
    if let (Some(client), Some(sandbox_id)) = (&callback_client, &args.sandbox_id) {
        // Construct the sandbox URL that Convex should use to reach us
        // In production, this would be the external URL; for now use localhost
        let sandbox_url = format!("http://localhost:{}", args.port);
        info!(
            sandbox_id = %sandbox_id,
            sandbox_url = %sandbox_url,
            "Notifying Convex that sandbox is ready"
        );

        // Spawn the sandbox_ready notification as a background task
        // so it doesn't block server startup
        let client = client.clone();
        let sandbox_id = sandbox_id.clone();
        tokio::spawn(async move {
            if let Err(e) = client.sandbox_ready(&sandbox_id, &sandbox_url).await {
                tracing::error!(
                    error = %e,
                    "Failed to notify Convex that sandbox is ready"
                );
            } else {
                tracing::info!("Successfully notified Convex that sandbox is ready");
            }
        });
    }

    let listener_v4 = tokio::net::TcpListener::bind(addr_v4).await?;

    let addr_v6 = SocketAddr::from(([0u16; 8], args.port));
    match tokio::net::TcpListener::bind(addr_v6).await {
        Ok(listener_v6) => {
            let app_v6 = app.clone();
            tokio::spawn(async move {
                if let Err(err) = axum::serve(listener_v6, app_v6).await {
                    error!("IPv6 server error: {err}");
                }
            });
            info!("Listening on {}", addr_v6);
        }
        Err(err) => {
            warn!("Failed to bind IPv6 listener: {err}");
        }
    }

    axum::serve(listener_v4, app).await?;

    Ok(())
}
