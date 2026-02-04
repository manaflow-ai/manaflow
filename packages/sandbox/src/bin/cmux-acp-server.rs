//! cmux-acp-server binary entry point.
//!
//! Standalone ACP server for sandbox integration. Handles REST API requests
//! from Convex and manages conversations with coding CLIs.
//!
//! Provides two sets of endpoints:
//! - `/api/acp/*` - Existing ACP endpoints for claude-code-acp, codex-acp, etc.
//! - `/api/agents/*` - sandbox-agent endpoints with Codex thread pool optimization
//!
//! SECURITY: This server has NO direct Convex access. It can only communicate
//! back to Convex via the callback URL using the JWT provided at spawn time.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::http::StatusCode;
use axum::routing::{any, get, post};
use axum::Router;
use clap::Parser;
use tracing::{error, info, warn, Level};
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

/// Global prewarm completion flag.
/// Used by the /ready endpoint to indicate when agent servers are warmed up.
static PREWARM_COMPLETE: AtomicBool = AtomicBool::new(false);

use cmux_sandbox::acp_server::{
    build_llm_proxy_router, cmux_code_asset_proxy, cmux_code_proxy, configure, init_conversation,
    novnc_proxy, novnc_ws, opencode_preflight, opencode_proxy, opencode_pty_ws,
    pty_capture_session, pty_create_session, pty_delete_session, pty_get_session, pty_health,
    pty_input_session, pty_list_sessions, pty_preflight, pty_resize_session, pty_session_ws,
    pty_update_session, receive_prompt, send_rpc, set_integrated_llm_proxy, set_lazy_prewarm,
    stream_acp_events, stream_preflight, vnc_ws, ApiProxies, CallbackClient, LazyPrewarm,
    LlmProxyState, RestApiDoc, RestApiState,
};

// sandbox-agent provides universal agent API with thread pool optimization
use sandbox_agent::router::{
    build_router_with_state as build_agent_router, prewarm_agents, ApiDoc as AgentApiDoc,
    AppState as AgentAppState, AuthConfig as AgentAuthConfig,
};
use sandbox_agent_agent_management::agents::AgentManager;

/// Lazy prewarm handler for E2B sandboxes.
/// Triggers prewarm after configure() sets env vars, since E2B doesn't preserve
/// process env vars through snapshot restore.
struct AgentPrewarmHandler {
    state: Arc<AgentAppState>,
}

impl LazyPrewarm for AgentPrewarmHandler {
    fn prewarm(&self) {
        let state = self.state.clone();
        tokio::spawn(async move {
            prewarm_agents(&state).await;
            PREWARM_COMPLETE.store(true, Ordering::Relaxed);
            info!("Lazy prewarm complete - /ready endpoint now returns 200");
        });
    }
}

async fn empty_204() -> StatusCode {
    StatusCode::NO_CONTENT
}

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

    /// Initial API proxy URL (optional). Normally set via /api/acp/configure from Convex.
    /// The outer proxy forwards requests with JWT authentication and injects the real API key.
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

    /// Prewarm agent servers (Codex, OpenCode) on startup for faster first session creation.
    /// This spawns shared servers and pre-creates Codex threads in the background.
    #[arg(long, env = "ACP_PREWARM")]
    prewarm: bool,

    /// Agent install directory for sandbox-agent.
    /// Defaults to ~/.cmux/agents
    #[arg(long, env = "AGENT_INSTALL_DIR")]
    agent_install_dir: Option<PathBuf>,
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

/// Ready check response (includes prewarm status).
#[derive(serde::Serialize, utoipa::ToSchema)]
struct ReadyResponse {
    status: &'static str,
    version: &'static str,
    prewarm_complete: bool,
}

/// Ready check handler.
/// Returns 200 OK only when both the server is healthy AND prewarm is complete.
/// Use this endpoint for container/sandbox readiness checks to ensure
/// agent thread pools are warmed up for fast session creation.
#[utoipa::path(
    get,
    path = "/ready",
    responses(
        (status = 200, description = "Server is ready (prewarm complete)", body = ReadyResponse),
        (status = 503, description = "Server is starting (prewarm in progress)", body = ReadyResponse)
    ),
    tag = "health"
)]
async fn ready() -> (StatusCode, axum::Json<ReadyResponse>) {
    let prewarm_complete = PREWARM_COMPLETE.load(Ordering::Relaxed);
    let response = ReadyResponse {
        status: if prewarm_complete { "ok" } else { "warming" },
        version: env!("CARGO_PKG_VERSION"),
        prewarm_complete,
    };
    let status = if prewarm_complete {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, axum::Json(response))
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
    paths(health, ready),
    components(schemas(HealthResponse, ReadyResponse)),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "acp", description = "ACP sandbox control endpoints")
    )
)]
struct ApiDoc;

/// Merge OpenAPI documents from ACP server, REST API, and sandbox-agent.
fn merged_openapi() -> utoipa::openapi::OpenApi {
    let mut api = ApiDoc::openapi();
    let rest_api = RestApiDoc::openapi();
    api.merge(rest_api);
    // Include sandbox-agent API documentation under /api/agents
    let agent_api = AgentApiDoc::openapi();
    api.merge(agent_api);
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
        prewarm = args.prewarm,
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
    // Mode 1: Local proxy with actual API keys (for local dev)
    let _api_proxies = if args.use_proxy
        && (args.anthropic_api_key.is_some()
            || args.openai_api_key.is_some()
            || args.google_api_key.is_some())
    {
        info!("Starting local API proxies (direct key mode)...");
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

    // Mode 2: Integrated LLM proxy for prewarm
    // LLM proxy routes are mounted on the main server (port 39384) instead of a separate server.
    // Prewarmed processes use http://127.0.0.1:39384/anthropic etc.
    // The proxy starts without JWT or outer URL - waits for /api/acp/configure to provide both.
    // The outer proxy URL is set dynamically via configure() from Convex (CONVEX_SITE_URL).

    // Create LLM proxy state (will be mounted as routes on main server)
    let llm_proxy_state = if args.prewarm {
        info!("Setting up integrated LLM proxy (JWT and proxy URL will be set via /api/acp/configure)...");

        // Create state with 60s timeout - gives time for configure() after spawn
        let state = LlmProxyState::new(std::time::Duration::from_secs(60));

        // Set environment variables for prewarmed processes to use the main server
        let anthropic_url = format!("http://127.0.0.1:{}/anthropic", args.port);
        let openai_url = format!("http://127.0.0.1:{}/openai", args.port);

        std::env::set_var("ANTHROPIC_BASE_URL", &anthropic_url);
        std::env::set_var("ANTHROPIC_API_KEY", "sk-ant-proxy-placeholder");
        std::env::set_var("OPENAI_BASE_URL", &openai_url);
        std::env::set_var("OPENAI_API_KEY", "sk-proxy-placeholder");

        info!(
            anthropic_url = %anthropic_url,
            openai_url = %openai_url,
            "Integrated LLM proxy configured - env vars set for prewarm"
        );

        // Store in global so configure() can set JWT later
        if !set_integrated_llm_proxy(state.clone()) {
            warn!("Integrated LLM proxy already initialized (should not happen)");
        }

        Some(state)
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

    // Create sandbox-agent state for /api/agents endpoints
    // This provides the universal agent API with Codex thread pool optimization
    let agent_install_dir = args.agent_install_dir.clone().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".cmux")
            .join("agents")
    });
    info!(agent_install_dir = %agent_install_dir.display(), "Agent install directory");

    let agent_manager = match AgentManager::new(&agent_install_dir) {
        Ok(m) => m,
        Err(e) => {
            error!(error = %e, "Failed to create agent manager");
            return Err(anyhow::anyhow!("Failed to create agent manager: {}", e));
        }
    };

    let agent_state = AgentAppState::new(AgentAuthConfig::disabled(), agent_manager);
    let (agent_router, agent_state_ref) = build_agent_router(Arc::new(agent_state));

    // Prewarm agent servers if enabled
    // This spawns shared servers and pre-creates Codex threads for faster first session
    //
    // IMPORTANT: Skip prewarm for E2B sandboxes (CMUX_SKIP_PREWARM=1).
    // E2B doesn't preserve process env vars through snapshot restore, so prewarmed processes
    // would lose their OPENAI_BASE_URL pointing to the boot proxy. Instead, we set up lazy
    // prewarm that triggers after configure() sets the correct env vars.
    let skip_prewarm = std::env::var("CMUX_SKIP_PREWARM")
        .map(|v| !v.is_empty() && v != "0")
        .unwrap_or(false);

    if args.prewarm && !skip_prewarm {
        // Immediate prewarm (Morph, Docker - RAM snapshots preserve env vars)
        info!("Prewarming agent servers (Codex thread pool)...");
        let prewarm_state = agent_state_ref.clone();
        tokio::spawn(async move {
            prewarm_agents(&prewarm_state).await;
            PREWARM_COMPLETE.store(true, Ordering::Relaxed);
            info!("Prewarm complete - /ready endpoint now returns 200");
        });
    } else if args.prewarm && skip_prewarm {
        // Lazy prewarm (E2B - env vars don't survive snapshot restore)
        // Set up handler that will be triggered after configure() sets env vars
        info!("Setting up lazy prewarm (CMUX_SKIP_PREWARM is set)");
        let handler = Arc::new(AgentPrewarmHandler {
            state: agent_state_ref.clone(),
        });
        if !set_lazy_prewarm(handler) {
            warn!("Lazy prewarm handler already set (should not happen)");
        }
        // Mark PREWARM_COMPLETE so /ready returns 200 for template build.
        // The actual prewarm will happen after configure() on sandbox spawn.
        PREWARM_COMPLETE.store(true, Ordering::Relaxed);
    } else {
        // Prewarm not requested - mark as complete immediately
        PREWARM_COMPLETE.store(true, Ordering::Relaxed);
    }

    // Build REST API router for ACP endpoints
    // These endpoints allow Convex to control the sandbox:
    // - /api/acp/configure: Inject callback settings (required after spawn)
    // - /api/acp/init: Initialize a conversation (spawn CLI)
    // - /api/acp/prompt: Send prompts to an active conversation
    let app = Router::new()
        .route("/health", get(health))
        .route("/healthz", get(health))
        .route("/ready", get(ready))
        .route("/favicon.ico", get(empty_204))
        .route("/manifest.json", get(empty_204))
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
        .route("/api/pty/sessions/{session_id}/ws", get(pty_session_ws))
        // cmux-code (VS Code) proxy - strip /api/cmux-code prefix
        .route("/api/cmux-code/{*path}", any(cmux_code_proxy))
        .route("/api/cmux-code", any(cmux_code_proxy))
        .route("/api/cmux-code/", any(cmux_code_proxy))
        // noVNC static assets and WebSocket proxy
        .route("/api/novnc/ws", get(novnc_ws))
        .route("/api/novnc/websockify", get(novnc_ws))
        .route("/api/novnc/{*path}", get(novnc_proxy))
        .route("/api/novnc", get(novnc_proxy))
        // Raw VNC WebSocket proxy
        .route("/api/vnc", get(vnc_ws))
        // OpenCode headless server proxy - WebSocket route must be explicit
        .route("/api/opencode/pty/{pty_id}/connect", get(opencode_pty_ws))
        // OpenCode catch-all proxy (strips /api/opencode prefix)
        .route(
            "/api/opencode/{*path}",
            get(opencode_proxy)
                .post(opencode_proxy)
                .put(opencode_proxy)
                .patch(opencode_proxy)
                .delete(opencode_proxy)
                .options(opencode_preflight),
        )
        .route(
            "/api/opencode",
            get(opencode_proxy)
                .post(opencode_proxy)
                .options(opencode_preflight),
        )
        // cmux-code static assets served at /oss-*
        .fallback(cmux_code_asset_proxy)
        .with_state(rest_state)
        // Mount sandbox-agent routes under /api/agents
        // Provides universal agent API with Codex thread pool optimization
        .nest("/api/agents", agent_router)
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", merged_openapi()));

    // Mount LLM proxy routes if prewarm is enabled
    // Routes: /anthropic/*, /openai/*, /v1/* - proxy to outer API with JWT
    let app = if let Some(llm_state) = llm_proxy_state {
        app.merge(build_llm_proxy_router(llm_state))
    } else {
        app
    };

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
