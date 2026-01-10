//! cmux-acp-server binary entry point.
//!
//! Standalone ACP server for iOS app integration. Handles WebSocket connections
//! from iOS clients and manages conversations with coding CLIs.

use std::net::SocketAddr;
use std::path::PathBuf;

use axum::routing::{any, get};
use axum::Router;
use clap::Parser;
use tracing::{info, Level};
use tracing_subscriber::EnvFilter;

use cmux_sandbox::acp_server::{acp_websocket_handler, AcpServerState};

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

    /// Default working directory for spawned CLIs
    #[arg(long, env = "ACP_WORKING_DIR", default_value = "/workspace")]
    working_dir: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

/// Health check endpoint response.
#[derive(serde::Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

/// Health check handler.
async fn health() -> axum::Json<HealthResponse> {
    axum::Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
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
        "Starting cmux-acp-server"
    );

    // Create ACP server state
    let state = AcpServerState::new(
        args.convex_url.clone(),
        args.jwt_secret.clone(),
        args.working_dir.clone(),
    );

    // Build router
    let app = Router::new()
        .route("/health", get(health))
        .route("/healthz", get(health))
        .route("/api/acp", any(acp_websocket_handler))
        .route(
            "/api/conversations/:conversation_id/ws",
            any(acp_websocket_handler),
        )
        .with_state(state);

    // Bind and serve
    let addr = SocketAddr::from(([0, 0, 0, 0], args.port));
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
