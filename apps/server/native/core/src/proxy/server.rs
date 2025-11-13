use super::auth::{generate_credentials, validate_basic_auth};
use super::routing::{is_loopback_hostname, rewrite_url_if_needed, Route};
use bytes::Bytes;
use http::{header, HeaderValue, Method, Request, Response, StatusCode, Uri};
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::server::conn::{http1, http2};
use hyper::service::service_fn;
use hyper::upgrade::Upgraded;
use hyper_rustls::HttpsConnectorBuilder;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::{TokioExecutor, TokioIo};
use parking_lot::RwLock;
use rustls::crypto::aws_lc_rs;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use std::cmp::min;
use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Notify;
use tokio_rustls::{client::TlsStream, TlsConnector};
use tracing::{debug, error, info, warn};
use webpki_roots::TLS_SERVER_ROOTS;

type BoxBody =
    http_body_util::combinators::BoxBody<Bytes, Box<dyn std::error::Error + Send + Sync>>;
type ProxyError = Box<dyn std::error::Error + Send + Sync>;

const HTTP2_PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
const CMUX_HOST_OVERRIDE_HEADER: &str = "X-Cmux-Host-Override";

struct BufferedStream {
    stream: TcpStream,
    buffer: Vec<u8>,
    cursor: usize,
}

impl BufferedStream {
    fn new(stream: TcpStream, buffer: Vec<u8>) -> Self {
        Self {
            stream,
            buffer,
            cursor: 0,
        }
    }
}

impl AsyncRead for BufferedStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.cursor < self.buffer.len() && buf.remaining() > 0 {
            let remaining = self.buffer.len() - self.cursor;
            let to_copy = min(remaining, buf.remaining());
            buf.put_slice(&self.buffer[self.cursor..self.cursor + to_copy]);
            self.cursor += to_copy;
            return Poll::Ready(Ok(()));
        }

        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl AsyncWrite for BufferedStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        Pin::new(&mut this.stream).poll_write(cx, data)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        Pin::new(&mut this.stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        Pin::new(&mut this.stream).poll_shutdown(cx)
    }
}

#[derive(Clone, Debug)]
pub struct ProxyContext {
    pub id: String,
    pub username: String,
    pub password: String,
    pub web_contents_id: u32,
    #[allow(dead_code)]
    pub route: Option<Route>,
}

struct InternalContext {
    username: String,
    password: String,
    web_contents_id: u32,
    route: Option<Route>,
}

pub struct ProxyServer {
    port: u16,
    contexts: Arc<RwLock<HashMap<String, InternalContext>>>,
    contexts_by_username: Arc<RwLock<HashMap<String, String>>>,
    shutdown: Arc<Notify>,
    _http_client: Client<hyper_rustls::HttpsConnector<HttpConnector>, BoxBody>,
}

impl ProxyServer {
    pub async fn start(listen_addr: String, enable_http2: bool) -> Result<Self, String> {
        let addr: SocketAddr = listen_addr
            .parse()
            .map_err(|e| format!("Invalid listen addr: {}", e))?;

        let listener = TcpListener::bind(addr)
            .await
            .map_err(|e| format!("Failed to bind: {}", e))?;

        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        info!("Proxy server listening on {}", addr);

        // Create HTTP client for forwarding requests
        let https_connector = HttpsConnectorBuilder::new()
            .with_webpki_roots()
            .https_or_http()
            .enable_http1()
            .enable_http2()
            .build();
        let http_client = Client::builder(TokioExecutor::new()).build(https_connector);
        let tls_connector =
            build_tls_connector().map_err(|e| format!("Failed to initialize TLS: {}", e))?;

        let contexts = Arc::new(RwLock::new(HashMap::new()));
        let contexts_by_username = Arc::new(RwLock::new(HashMap::new()));
        let shutdown = Arc::new(Notify::new());

        let server_contexts = contexts.clone();
        let server_contexts_by_username = contexts_by_username.clone();
        let server_shutdown = shutdown.clone();
        let server_http_client = http_client.clone();
        let server_tls_connector = tls_connector.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        match result {
                            Ok((stream, addr)) => {
                                debug!("Accepted connection from {}", addr);

                                let contexts = server_contexts.clone();
                                let contexts_by_username = server_contexts_by_username.clone();
                                let http_client = server_http_client.clone();
                                let tls_connector = server_tls_connector.clone();

                                tokio::spawn(async move {
                                    if let Err(e) = handle_connection(
                                        stream,
                                        addr,
                                        contexts,
                                        contexts_by_username,
                                        enable_http2,
                                        http_client,
                                        tls_connector,
                                    )
                                    .await
                                    {
                                        error!("Connection error: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                error!("Failed to accept connection: {}", e);
                            }
                        }
                    }
                    _ = server_shutdown.notified() => {
                        info!("Proxy server shutting down");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            port,
            contexts,
            contexts_by_username,
            shutdown,
            _http_client: http_client,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn create_context(&self, web_contents_id: u32, route: Option<Route>) -> ProxyContext {
        let (username, password) = generate_credentials(web_contents_id);
        let context_id = format!("ctx-{}-{}", web_contents_id, rand::random::<u64>());

        let internal_ctx = InternalContext {
            username: username.clone(),
            password: password.clone(),
            web_contents_id,
            route: route.clone(),
        };

        self.contexts
            .write()
            .insert(context_id.clone(), internal_ctx);
        self.contexts_by_username
            .write()
            .insert(username.clone(), context_id.clone());

        info!(
            "Created context {} for WebContents {}",
            context_id, web_contents_id
        );

        ProxyContext {
            id: context_id,
            username,
            password,
            web_contents_id,
            route,
        }
    }

    pub fn release_context(&self, context_id: &str) {
        if let Some(ctx) = self.contexts.write().remove(context_id) {
            self.contexts_by_username.write().remove(&ctx.username);
            info!("Released context {}", context_id);
        }
    }

    pub fn stop(&self) {
        self.shutdown.notify_waiters();
    }
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    contexts: Arc<RwLock<HashMap<String, InternalContext>>>,
    contexts_by_username: Arc<RwLock<HashMap<String, String>>>,
    enable_http2: bool,
    http_client: Client<hyper_rustls::HttpsConnector<HttpConnector>, BoxBody>,
    tls_connector: TlsConnector,
) -> Result<(), ProxyError> {
    let (buffered_stream, client_prefers_http2) = if enable_http2 {
        sniff_http2_preface(stream).await?
    } else {
        (BufferedStream::new(stream, Vec::new()), false)
    };
    let io = TokioIo::new(buffered_stream);

    let service = service_fn(move |req| {
        handle_request(
            req,
            addr,
            contexts.clone(),
            contexts_by_username.clone(),
            http_client.clone(),
            tls_connector.clone(),
        )
    });

    if enable_http2 && client_prefers_http2 {
        http2::Builder::new(TokioExecutor::new())
            .serve_connection(io, service)
            .await?;
    } else {
        http1::Builder::new()
            .serve_connection(io, service)
            .with_upgrades()
            .await?;
    }

    Ok(())
}

async fn sniff_http2_preface(stream: TcpStream) -> Result<(BufferedStream, bool), ProxyError> {
    let mut buffer: Vec<u8> = Vec::new();
    let mut temp = [0u8; HTTP2_PREFACE.len()];

    loop {
        if buffer.len() >= HTTP2_PREFACE.len() {
            break;
        }

        stream
            .readable()
            .await
            .map_err(|e| Box::new(e) as ProxyError)?;
        let needed = HTTP2_PREFACE.len() - buffer.len();

        match stream.try_read(&mut temp[..needed]) {
            Ok(0) => break,
            Ok(n) => {
                buffer.extend_from_slice(&temp[..n]);
                if !HTTP2_PREFACE.starts_with(&buffer) {
                    return Ok((BufferedStream::new(stream, buffer), false));
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => continue,
            Err(e) => return Err(Box::new(e)),
        }
    }

    let is_http2 = buffer.len() >= HTTP2_PREFACE.len()
        && buffer[..HTTP2_PREFACE.len()] == *HTTP2_PREFACE;
    Ok((BufferedStream::new(stream, buffer), is_http2))
}

pub(crate) fn determine_host_override(original: &Uri, rewritten: &Uri) -> Option<String> {
    let original_host = original.host()?;
    if !is_loopback_hostname(original_host) {
        return None;
    }

    let rewritten_host = rewritten.host().unwrap_or_default();
    if !rewritten_host.starts_with("port-") || !rewritten_host.contains("-morphvm-") {
        return None;
    }

    original
        .authority()
        .map(|auth| auth.to_string())
        .or_else(|| Some(original_host.to_string()))
}

async fn handle_request(
    req: Request<Incoming>,
    addr: SocketAddr,
    contexts: Arc<RwLock<HashMap<String, InternalContext>>>,
    contexts_by_username: Arc<RwLock<HashMap<String, String>>>,
    http_client: Client<hyper_rustls::HttpsConnector<HttpConnector>, BoxBody>,
    tls_connector: TlsConnector,
) -> Result<Response<BoxBody>, ProxyError> {
    debug!("Request: {} {} from {}", req.method(), req.uri(), addr);

    // Authenticate
    let context = match authenticate_request(&req, &contexts, &contexts_by_username) {
        Some(ctx) => ctx,
        None => {
            return Ok(proxy_auth_required_response());
        }
    };

    // Handle based on method and upgrade
    match req.method() {
        &Method::CONNECT => handle_connect(req, context).await,
        _ if is_upgrade_request(&req) => handle_upgrade(req, context, tls_connector).await,
        _ => handle_http(req, context, http_client).await,
    }
}

fn authenticate_request(
    req: &Request<Incoming>,
    contexts: &Arc<RwLock<HashMap<String, InternalContext>>>,
    contexts_by_username: &Arc<RwLock<HashMap<String, String>>>,
) -> Option<InternalContext> {
    let auth_header = req.headers().get("proxy-authorization")?;
    let auth_str = auth_header.to_str().ok()?;

    let encoded = auth_str.strip_prefix("Basic ")?;
    let decoded =
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    let username = decoded_str.split(':').next()?;

    let context_id = contexts_by_username.read().get(username)?.clone();
    let context = contexts.read().get(&context_id)?.clone();

    if validate_basic_auth(req.headers(), &context.username, &context.password) {
        Some(context)
    } else {
        None
    }
}

impl Clone for InternalContext {
    fn clone(&self) -> Self {
        Self {
            username: self.username.clone(),
            password: self.password.clone(),
            web_contents_id: self.web_contents_id,
            route: self.route.clone(),
        }
    }
}

fn is_upgrade_request(req: &Request<Incoming>) -> bool {
    req.headers()
        .get("connection")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase().contains("upgrade"))
        .unwrap_or(false)
        && req.headers().contains_key("upgrade")
}

fn proxy_auth_required_response() -> Response<BoxBody> {
    Response::builder()
        .status(StatusCode::PROXY_AUTHENTICATION_REQUIRED)
        .header("proxy-authenticate", "Basic realm=\"Cmux Preview Proxy\"")
        .body(boxed_body(Full::new(Bytes::from(
            "Proxy Authentication Required",
        ))))
        .unwrap()
}

async fn handle_http(
    req: Request<Incoming>,
    context: InternalContext,
    http_client: Client<hyper_rustls::HttpsConnector<HttpConnector>, BoxBody>,
) -> Result<Response<BoxBody>, ProxyError> {
    let uri = req.uri().clone();
    let rewritten_uri = rewrite_url_if_needed(&uri, context.route.as_ref())?;
    let host_override = determine_host_override(&uri, &rewritten_uri);
    let upstream_authority = rewritten_uri
        .authority()
        .map(|auth| auth.as_str().to_string());
    let target_is_morph = context
        .route
        .as_ref()
        .and_then(|route| route.morph_domain_suffix.as_ref())
        .is_some();

    info!(
        "HTTP {} {} -> {} (WebContents {})",
        req.method(),
        uri,
        rewritten_uri,
        context.web_contents_id
    );

    // Convert request
    let (parts, incoming) = req.into_parts();
    let mut new_parts = parts.clone();
    new_parts.uri = rewritten_uri.clone();

    // Remove proxy headers
    new_parts.headers.remove("proxy-authorization");

    if let Some(authority) = upstream_authority.as_ref() {
        if let Ok(value) = HeaderValue::from_str(authority) {
            new_parts.headers.insert(header::HOST, value);
        }
    } else {
        new_parts.headers.remove(header::HOST);
    }

    if let Some(host) = host_override.as_ref() {
        if target_is_morph {
            let value = HeaderValue::from_str(host).map_err(|e| Box::new(e) as ProxyError)?;
            new_parts.headers.insert(header::HOST, value);
            debug!(
                original_host = ?uri.host(),
                override_host = host,
                upstream_host = ?rewritten_uri.host(),
                "overriding host header for direct upstream request"
            );
        } else if let Ok(value) = HeaderValue::from_str(host) {
            new_parts.headers.insert(CMUX_HOST_OVERRIDE_HEADER, value);
        }
    } else {
        new_parts.headers.remove(CMUX_HOST_OVERRIDE_HEADER);
    }

    let body = boxed_body(incoming);
    let upstream_req = Request::from_parts(new_parts, body);

    // Forward to upstream
    match http_client.request(upstream_req).await {
        Ok(upstream_resp) => {
            // Convert response
            let (parts, incoming) = upstream_resp.into_parts();
            let body = boxed_body(incoming);
            Ok(Response::from_parts(parts, body))
        }
        Err(e) => {
            warn!("HTTP upstream error: {}", e);
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(boxed_body(Full::new(Bytes::from(format!(
                    "Bad Gateway: {}",
                    e
                )))))
                .unwrap())
        }
    }
}

async fn handle_connect(
    mut req: Request<Incoming>,
    context: InternalContext,
) -> Result<Response<BoxBody>, ProxyError> {
    let target = req.uri().to_string();
    info!(
        "CONNECT {} (WebContents {})",
        target, context.web_contents_id
    );

    // Parse host:port
    let parts: Vec<&str> = target.split(':').collect();
    if parts.len() != 2 {
        return Ok(Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(empty_body())
            .unwrap());
    }

    let host = parts[0];
    let port: u16 = parts[1].parse().map_err(|_| "Invalid port")?;

    // Connect to target
    let mut upstream = TcpStream::connect((host, port)).await?;

    // Return 200 Connection Established
    tokio::spawn(async move {
        match hyper::upgrade::on(&mut req).await {
            Ok(client_upgraded) => {
                if let Err(e) =
                    tokio::io::copy_bidirectional(&mut TokioIo::new(client_upgraded), &mut upstream)
                        .await
                {
                    warn!("CONNECT tunnel error: {}", e);
                }
            }
            Err(e) => {
                error!("CONNECT upgrade error: {}", e);
            }
        }
    });

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(empty_body())
        .unwrap())
}

async fn handle_upgrade(
    mut req: Request<Incoming>,
    context: InternalContext,
    tls_connector: TlsConnector,
) -> Result<Response<BoxBody>, ProxyError> {
    let uri = req.uri().clone();
    let rewritten_uri = rewrite_url_if_needed(&uri, context.route.as_ref())?;
    let host_override = determine_host_override(&uri, &rewritten_uri);

    info!(
        "WebSocket upgrade {} -> {} (WebContents {})",
        uri, rewritten_uri, context.web_contents_id
    );

    let target_host = rewritten_uri.host().ok_or("No host in rewritten URI")?;
    let target_port = rewritten_uri.port_u16().unwrap_or_else(|| {
        if rewritten_uri.scheme_str() == Some("wss") || rewritten_uri.scheme_str() == Some("https")
        {
            443
        } else {
            80
        }
    });
    let use_tls = matches!(rewritten_uri.scheme_str(), Some("wss") | Some("https"));
    let target_is_morph = context
        .route
        .as_ref()
        .and_then(|route| route.morph_domain_suffix.as_ref())
        .is_some();

    // Build WebSocket upgrade request
    let mut upstream_req = Vec::new();
    let path = rewritten_uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/");

    upstream_req.extend_from_slice(format!("GET {} HTTP/1.1\r\n", path).as_bytes());
    let default_host_header = format_host_header(target_host, target_port, use_tls);
    let effective_host_header = if target_is_morph {
        host_override.clone().unwrap_or(default_host_header.clone())
    } else {
        default_host_header.clone()
    };
    if target_is_morph && host_override.is_some() {
        debug!(
            original_host = ?uri.host(),
            override_host = ?host_override,
            upstream_host = target_host,
            "overriding host header for direct websocket upstream"
        );
    }
    upstream_req.extend_from_slice(format!("Host: {}\r\n", effective_host_header).as_bytes());
    if !target_is_morph {
        if let Some(host) = host_override.as_ref() {
            upstream_req.extend_from_slice(
                format!("{CMUX_HOST_OVERRIDE_HEADER}: {}\r\n", host).as_bytes(),
            );
        }
    }

    let host_override_header_lower = CMUX_HOST_OVERRIDE_HEADER.to_ascii_lowercase();
    // Copy upgrade headers
    for (name, value) in req.headers() {
        let name_str = name.as_str().to_lowercase();
        if name_str == "proxy-authorization"
            || name_str == "host"
            || name_str == host_override_header_lower
        {
            continue;
        }
        upstream_req.extend_from_slice(name.as_str().as_bytes());
        upstream_req.extend_from_slice(b": ");
        upstream_req.extend_from_slice(value.as_bytes());
        upstream_req.extend_from_slice(b"\r\n");
    }

    upstream_req.extend_from_slice(b"\r\n");

    // Return 101 and spawn tunnel
    let host_string = target_host.to_string();
    tokio::spawn(async move {
        match hyper::upgrade::on(&mut req).await {
            Ok(client_upgraded) => {
                if let Err(e) = proxy_websocket_stream(
                    client_upgraded,
                    upstream_req,
                    host_string,
                    target_port,
                    use_tls,
                    tls_connector,
                )
                .await
                {
                    warn!("WebSocket tunnel error: {}", e);
                }
            }
            Err(e) => {
                error!("WebSocket upgrade error: {}", e);
            }
        }
    });

    Ok(Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("upgrade", "websocket")
        .header("connection", "upgrade")
        .body(empty_body())
        .unwrap())
}

async fn proxy_websocket_stream(
    client_stream: Upgraded,
    upstream_request: Vec<u8>,
    host: String,
    port: u16,
    use_tls: bool,
    tls_connector: TlsConnector,
) -> Result<(), ProxyError> {
    let mut upstream = connect_upstream_stream(&host, port, use_tls, &tls_connector).await?;

    upstream.write_all(&upstream_request).await?;
    let pending = consume_websocket_handshake(&mut upstream).await?;

    let mut client = TokioIo::new(client_stream);
    if !pending.is_empty() {
        if let Err(e) = client.write_all(&pending).await {
            return Err(Box::new(e));
        }
    }

    if let Err(e) = tokio::io::copy_bidirectional(&mut client, &mut upstream).await {
        return Err(Box::new(e));
    }

    Ok(())
}

async fn connect_upstream_stream(
    host: &str,
    port: u16,
    use_tls: bool,
    tls_connector: &TlsConnector,
) -> Result<MaybeTlsStream, ProxyError> {
    let stream = TcpStream::connect((host, port)).await?;
    if use_tls {
        let server_name = ServerName::try_from(host)
            .map_err(|e| Box::new(e) as ProxyError)?
            .to_owned();
        let tls_stream = tls_connector.connect(server_name, stream).await?;
        Ok(MaybeTlsStream::Tls(tls_stream))
    } else {
        Ok(MaybeTlsStream::Plain(stream))
    }
}

async fn consume_websocket_handshake(stream: &mut MaybeTlsStream) -> io::Result<Vec<u8>> {
    let mut buffer = Vec::with_capacity(1024);
    let mut temp = [0u8; 1024];

    loop {
        let read = stream.read(&mut temp).await?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Upstream closed during WebSocket handshake",
            ));
        }

        buffer.extend_from_slice(&temp[..read]);
        if let Some(end) = find_header_end(&buffer) {
            validate_websocket_status(&buffer[..end])?;
            let remainder = if buffer.len() > end {
                buffer[end..].to_vec()
            } else {
                Vec::new()
            };
            return Ok(remainder);
        }

        if buffer.len() > 8192 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "WebSocket handshake response too large",
            ));
        }
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|idx| idx + 4)
}

fn validate_websocket_status(header: &[u8]) -> io::Result<()> {
    let text = std::str::from_utf8(header).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid UTF-8 in handshake response",
        )
    })?;

    let status_line = text.lines().next().unwrap_or("HTTP/1.1 000 Unknown");

    if !status_line.contains("101") {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Upstream refused upgrade: {status_line}"),
        ));
    }

    Ok(())
}

fn format_host_header(host: &str, port: u16, use_tls: bool) -> String {
    let default_port = if use_tls { 443 } else { 80 };
    if port == default_port {
        host.to_string()
    } else {
        format!("{host}:{port}")
    }
}

enum MaybeTlsStream {
    Plain(TcpStream),
    Tls(TlsStream<TcpStream>),
}

impl AsyncRead for MaybeTlsStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTlsStream::Plain(stream) => Pin::new(stream).poll_read(cx, buf),
            MaybeTlsStream::Tls(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for MaybeTlsStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            MaybeTlsStream::Plain(stream) => Pin::new(stream).poll_write(cx, data),
            MaybeTlsStream::Tls(stream) => Pin::new(stream).poll_write(cx, data),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTlsStream::Plain(stream) => Pin::new(stream).poll_flush(cx),
            MaybeTlsStream::Tls(stream) => Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            MaybeTlsStream::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            MaybeTlsStream::Tls(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

fn build_tls_connector() -> Result<TlsConnector, String> {
    let _ = aws_lc_rs::default_provider().install_default();

    let root_store = RootCertStore::from_iter(TLS_SERVER_ROOTS.iter().cloned());

    let mut config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    config.alpn_protocols.push(b"h2".to_vec());
    config.alpn_protocols.push(b"http/1.1".to_vec());

    Ok(TlsConnector::from(Arc::new(config)))
}

fn boxed_body<B>(body: B) -> BoxBody
where
    B: http_body::Body<Data = Bytes> + Send + Sync + 'static,
    B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    body.map_err(|e| e.into()).boxed()
}

fn empty_body() -> BoxBody {
    boxed_body(Empty::new())
}
