//! cmux-acp-server binary entry point.
//!
//! Standalone ACP server for iOS app integration. Handles WebSocket connections
//! from iOS clients and manages conversations with coding CLIs.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::routing::{any, get, post};
use axum::Router;
use clap::Parser;
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use cmux_sandbox::acp_server::{
    acp_websocket_handler, create_conversation, get_conversation, get_conversation_messages,
    list_conversations, refresh_conversation_jwt, set_conversation_jwt, AcpServerState, ApiKeys,
    ApiProxies, RestApiDoc, RestApiState,
};

/// ACP Server for iOS app integration.
#[derive(Parser, Debug)]
#[command(name = "cmux-acp-server")]
#[command(about = "ACP server for cmux iOS app")]
struct Args {
    /// Port to listen on
    #[arg(short, long, env = "ACP_PORT", default_value = "39384")]
    port: u16,

    /// Convex deployment URL
    #[arg(long, env = "CONVEX_URL")]
    convex_url: String,

    /// JWT secret for conversation token verification
    #[arg(long, env = "CMUX_CONVERSATION_JWT_SECRET")]
    jwt_secret: String,

    /// Convex admin key for API authentication
    #[arg(long, env = "CONVEX_ADMIN_KEY")]
    convex_admin_key: String,

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

/// OpenAPI documentation for the ACP server (health endpoints only).
#[derive(OpenApi)]
#[openapi(
    info(
        title = "cmux ACP Server",
        description = "ACP (Agent Client Protocol) server for iOS app integration. \
            Provides REST endpoints for conversation management and WebSocket endpoints \
            for communicating with coding agents (Claude Code, Codex, etc.).",
        version = "0.1.0"
    ),
    paths(health),
    components(schemas(HealthResponse)),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "conversations", description = "Conversation management endpoints"),
        (name = "acp", description = "WebSocket endpoints for ACP protocol")
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

    info!(
        port = args.port,
        working_dir = %args.working_dir.display(),
        use_proxy = args.use_proxy,
        api_proxy_url = ?args.api_proxy_url,
        "Starting cmux-acp-server"
    );

    // Create ACP server state
    let mut state = AcpServerState::new(
        args.convex_url.clone(),
        args.jwt_secret.clone(),
        args.convex_admin_key.clone(),
        args.working_dir.clone(),
    );

    // Configure API proxy mode (production) or local proxy mode (development)
    if let Some(ref api_proxy_url) = args.api_proxy_url {
        // Production mode: use external API proxy (Vercel) for API calls
        // Per-conversation proxies will forward to this URL with JWT auth
        info!(
            api_proxy_url = %api_proxy_url,
            "Using API proxy mode (per-conversation JWT auth)"
        );
        state = state.with_api_proxy_url(api_proxy_url.clone());
    } else if args.use_proxy {
        // Development mode: start local API proxies with direct API keys
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

        state = state.with_proxies(Arc::new(proxies));
    } else {
        // Deprecated: fall back to direct API keys
        info!("Using direct API keys (proxy disabled)");
        let api_keys = ApiKeys {
            anthropic_api_key: args.anthropic_api_key.clone(),
            openai_api_key: args.openai_api_key.clone(),
            google_api_key: args.google_api_key.clone(),
        };
        state = state.with_api_keys(api_keys);
    }

    // Create REST API state
    let rest_state = RestApiState::new(args.convex_url.clone(), args.convex_admin_key.clone());

    // Build REST API router (separate state)
    let rest_router = Router::new()
        .route(
            "/api/conversations",
            get(list_conversations).post(create_conversation),
        )
        .route(
            "/api/conversations/{conversation_id}",
            get(get_conversation),
        )
        .route(
            "/api/conversations/{conversation_id}/messages",
            get(get_conversation_messages),
        )
        .route(
            "/api/conversations/{conversation_id}/jwt",
            post(refresh_conversation_jwt),
        )
        .with_state(rest_state);

    // Build main router with WebSocket routes
    let app = Router::new()
        .route("/health", get(health))
        .route("/healthz", get(health))
        .route("/api/acp", any(acp_websocket_handler))
        .route(
            "/api/conversations/{conversation_id}/ws",
            any(acp_websocket_handler),
        )
        .route(
            "/api/conversations/{conversation_id}/proxy-jwt",
            post(set_conversation_jwt),
        )
        .with_state(state)
        .merge(rest_router)
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", merged_openapi()));

    // Bind and serve
    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
