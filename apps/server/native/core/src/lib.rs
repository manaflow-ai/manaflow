#![deny(clippy::all)]

mod branches;
mod diff;
mod merge_base;
mod proxy;
mod repo;
mod types;
mod util;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use types::{BranchInfo, DiffEntry, GitDiffOptions, GitListRemoteBranchesOptions};

#[napi]
pub async fn get_time() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    #[cfg(debug_assertions)]
    println!("[cmux_native_core] get_time invoked");
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    now.as_millis().to_string()
}

#[napi]
pub async fn git_diff(opts: GitDiffOptions) -> Result<Vec<DiffEntry>> {
    #[cfg(debug_assertions)]
    println!(
    "[cmux_native_git] git_diff headRef={} baseRef={:?} originPathOverride={:?} repoUrl={:?} repoFullName={:?} includeContents={:?} maxBytes={:?}",
    opts.headRef,
    opts.baseRef,
    opts.originPathOverride,
    opts.repoUrl,
    opts.repoFullName,
    opts.includeContents,
    opts.maxBytes
  );
    tokio::task::spawn_blocking(move || diff::refs::diff_refs(opts))
        .await
        .map_err(|e| Error::from_reason(format!("Join error: {e}")))?
        .map_err(|e| Error::from_reason(format!("{e:#}")))
}

#[napi]
pub async fn git_list_remote_branches(
    opts: GitListRemoteBranchesOptions,
) -> Result<Vec<BranchInfo>> {
    #[cfg(debug_assertions)]
    println!(
    "[cmux_native_git] git_list_remote_branches repoFullName={:?} repoUrl={:?} originPathOverride={:?}",
    opts.repoFullName,
    opts.repoUrl,
    opts.originPathOverride
  );
    tokio::task::spawn_blocking(move || branches::list_remote_branches(opts))
        .await
        .map_err(|e| Error::from_reason(format!("Join error: {e}")))?
        .map_err(|e| Error::from_reason(format!("{e:#}")))
}

// Proxy server exports
use parking_lot::Mutex;
use std::sync::Arc;

#[napi]
pub struct ProxyServer {
    inner: Arc<Mutex<Option<proxy::ProxyServer>>>,
}

#[napi(object)]
pub struct ProxyRoute {
    pub morph_id: String,
    pub scope: String,
    pub domain_suffix: String,
    pub morph_domain_suffix: Option<String>,
}

#[napi(object)]
pub struct ProxyContextInfo {
    pub id: String,
    pub username: String,
    pub password: String,
    pub web_contents_id: u32,
}

#[napi]
impl ProxyServer {
    #[napi(factory)]
    pub async fn start(listen_addr: String, enable_http2: bool) -> Result<Self> {
        let server = proxy::ProxyServer::start(listen_addr, enable_http2)
            .await
            .map_err(Error::from_reason)?;

        Ok(Self {
            inner: Arc::new(Mutex::new(Some(server))),
        })
    }

    /// Start proxy with auto port finding (tries ports starting from start_port)
    #[napi(factory)]
    pub async fn start_with_auto_port(
        host: String,
        start_port: u16,
        max_attempts: u32,
        enable_http2: bool,
    ) -> Result<Self> {
        let mut last_error = String::from("No attempts made");

        for i in 0..max_attempts {
            let port = start_port.saturating_add(i as u16);
            let addr = format!("{}:{}", host, port);

            match proxy::ProxyServer::start(addr, enable_http2).await {
                Ok(server) => {
                    return Ok(Self {
                        inner: Arc::new(Mutex::new(Some(server))),
                    });
                }
                Err(e) => {
                    last_error = e;
                    // Continue to next port
                }
            }
        }

        Err(Error::from_reason(format!(
            "Failed to bind proxy after {} attempts. Last error: {}",
            max_attempts, last_error
        )))
    }

    #[napi]
    pub fn port(&self) -> u16 {
        self.inner.lock().as_ref().map(|s| s.port()).unwrap_or(0)
    }

    #[napi]
    pub fn create_context(
        &self,
        web_contents_id: u32,
        route: Option<ProxyRoute>,
    ) -> ProxyContextInfo {
        let server = self.inner.lock();
        let server = server.as_ref().expect("Server not started");

        let internal_route = route.map(|r| proxy::routing::Route {
            morph_id: r.morph_id,
            scope: r.scope,
            domain_suffix: r.domain_suffix,
            morph_domain_suffix: r.morph_domain_suffix,
        });

        let ctx = server.create_context(web_contents_id, internal_route);

        ProxyContextInfo {
            id: ctx.id,
            username: ctx.username,
            password: ctx.password,
            web_contents_id: ctx.web_contents_id,
        }
    }

    #[napi]
    pub fn release_context(&self, context_id: String) {
        let server = self.inner.lock();
        if let Some(server) = server.as_ref() {
            server.release_context(&context_id);
        }
    }

    #[napi]
    pub fn stop(&self) {
        let mut server = self.inner.lock();
        if let Some(server) = server.take() {
            server.stop();
        }
    }
}

#[cfg(test)]
mod tests;
