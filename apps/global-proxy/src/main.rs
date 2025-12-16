use std::{net::SocketAddr, str::FromStr};

use global_proxy::{ProxyConfig, spawn_proxy};
use http::uri::Scheme;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "global_proxy=info,hyper=warn".to_string()),
        )
        .compact()
        .init();

    let bind_addr: SocketAddr = match std::env::var("GLOBAL_PROXY_BIND") {
        Ok(addr) => addr.parse()?,
        Err(_) => {
            let port = std::env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(8080);
            SocketAddr::from(([0, 0, 0, 0], port))
        }
    };
    let backend_host =
        std::env::var("GLOBAL_PROXY_BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    let backend_scheme = match std::env::var("GLOBAL_PROXY_BACKEND_SCHEME") {
        Ok(value) => Scheme::from_str(&value)
            .map_err(|_| format!("GLOBAL_PROXY_BACKEND_SCHEME '{}' is invalid", value))?,
        Err(_) => Scheme::HTTP,
    };

    let morph_domain_suffix = std::env::var("GLOBAL_PROXY_MORPH_DOMAIN_SUFFIX")
        .ok()
        .and_then(normalize_suffix);
    let workspace_domain_suffix = std::env::var("GLOBAL_PROXY_WORKSPACE_DOMAIN_SUFFIX")
        .ok()
        .and_then(normalize_suffix);

    let handle = spawn_proxy(ProxyConfig {
        bind_addr,
        backend_host,
        backend_scheme,
        morph_domain_suffix,
        workspace_domain_suffix,
    })
    .await?;

    info!(addr = %handle.addr, "global proxy listening");

    tokio::signal::ctrl_c().await?;

    handle.shutdown().await;
    Ok(())
}

fn normalize_suffix(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('.') {
        Some(trimmed.to_string())
    } else {
        Some(format!(".{}", trimmed))
    }
}
