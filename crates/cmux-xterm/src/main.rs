use std::{net::SocketAddr, path::PathBuf};

use cmux_xterm_server::{build_router, session::AppState};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = AppState::new();
    let static_dir = std::env::var("STATIC_DIR").ok().map(PathBuf::from);
    let app = build_router(state.clone(), static_dir);

    let addr: SocketAddr = std::env::var("BIND")
        .unwrap_or_else(|_| "127.0.0.1:39383".to_string())
        .parse()?;
    tracing::info!("listening on http://{}", addr);
    let listener = TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .tcp_nodelay(true)
        .await?;
    Ok(())
}
