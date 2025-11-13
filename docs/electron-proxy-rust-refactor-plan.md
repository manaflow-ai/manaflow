# Electron WebContentsView Proxy - Rust NAPI Refactor Plan

## Overview

Refactor the Electron WebContentsView proxy server from Node.js to Rust using NAPI-RS, with HTTP/2 support for both the local proxy server in Electron and communication with the global `cmux-proxy` server.

## Current Architecture

### Node.js Implementation
- **File**: `apps/client/electron/main/task-run-preview-proxy.ts`
- **Protocol**: HTTP/1.1
- **Server**: Node.js `http.createServer()`
- **Features**:
  - HTTP proxy with Basic auth
  - CONNECT method for HTTPS tunneling
  - WebSocket upgrade support
  - Per-WebContents routing via random credentials
  - Localhost → cmux domain rewriting
- **Port**: 39385+ (auto-increment if busy)
- **Bind**: 127.0.0.1

### Rust cmux-proxy (Global)
- **Location**: `crates/cmux-proxy`
- **Protocol**: HTTP/1.1 (hyper 0.14)
- **Features**:
  - Header-based routing (`X-Cmux-Port-Internal`, `X-Cmux-Workspace-Internal`)
  - HTTP proxy, CONNECT, WebSocket upgrade
  - Workspace IP mapping (127.18.x.x)
- **Port**: 39379

## Goals

1. **Replace Node.js proxy with Rust NAPI module** for better performance and security
2. **Add HTTP/2 support** for both:
   - Local Electron proxy server (HTTP/2 for browser clients)
   - Communication between Electron proxy ↔ global cmux-proxy (HTTP/2)
3. **Maintain compatibility** with existing WebContents proxy features
4. **Improve security** with memory-safe Rust implementation

## Architecture Design

### NAPI Module Structure

```
crates/
└── cmux-proxy-electron/
    ├── Cargo.toml
    ├── build.rs (optional)
    ├── src/
    │   ├── lib.rs              # NAPI entry point
    │   ├── proxy_server.rs     # HTTP/2 proxy server
    │   ├── client.rs           # HTTP/2 client to cmux-proxy
    │   ├── auth.rs             # Basic auth handling
    │   ├── routing.rs          # WebContents routing logic
    │   └── types.rs            # Shared types & conversions
    └── index.js                # Generated JS bindings
```

### New Rust Crate: `cmux-proxy-electron`

**Dependencies**:
```toml
[package]
name = "cmux-proxy-electron"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["async", "tokio_rt"] }
napi-derive = "2"
tokio = { version = "1", features = ["full"] }

# HTTP/2 support
hyper = { version = "1", features = ["http2", "server", "client"] }
hyper-util = { version = "0.1", features = ["tokio", "server-auto", "client-legacy"] }
h2 = "0.4"  # For advanced HTTP/2 features
http-body-util = "0.1"

# TLS for HTTPS
rustls = "0.23"
tokio-rustls = "0.26"
rustls-native-certs = "0.7"

# WebSocket (can still use over HTTP/2 via Extended CONNECT)
tokio-tungstenite = "0.21"

# Utilities
bytes = "1"
tracing = "0.1"
thiserror = "1"

[build-dependencies]
napi-build = "2"
```

### API Surface (TypeScript ↔ Rust)

**TypeScript Interface** (in `apps/client/electron/main/`):
```typescript
// Generated from NAPI
interface ProxyServer {
  start(config: ProxyConfig): Promise<ProxyServerHandle>;
}

interface ProxyConfig {
  listenAddr: string;          // "127.0.0.1:39385"
  upstreamProxyUrl: string;    // "http://127.0.0.1:39379" (will use HTTP/2)
  enableHttp2: boolean;        // true
}

interface ProxyServerHandle {
  port: number;
  
  // Create isolated context for WebContents
  createContext(config: ContextConfig): Promise<ProxyContext>;
  
  // Stop the server
  stop(): Promise<void>;
}

interface ContextConfig {
  webContentsId: number;
  persistKey?: string;
  route: {
    morphId: string;
    scope: string;
    domainSuffix: string;
  } | null;
}

interface ProxyContext {
  id: string;                  // Unique context ID
  username: string;
  password: string;
  webContentsId: number;
  
  // Cleanup
  release(): Promise<void>;
}
```

## HTTP/2 Integration Plan

### 1. Local Electron Proxy (HTTP/2 Server)

**Why HTTP/2?**
- Better multiplexing for concurrent requests from WebContents
- Header compression reduces overhead
- Server push capability (future enhancement)
- Browser-native support

**Implementation**:
```rust
// Using hyper 1.x with HTTP/2 support
use hyper::server::conn::http2;
use hyper_util::rt::TokioIo;

async fn start_http2_server(addr: SocketAddr) -> Result<ProxyServer> {
    let listener = TcpListener::bind(addr).await?;
    
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await?;
            let io = TokioIo::new(stream);
            
            let svc = service_fn(move |req| {
                handle_request(req)
            });
            
            // HTTP/2 connection
            tokio::spawn(async move {
                if let Err(e) = http2::Builder::new(TokioExecutor)
                    .serve_connection(io, svc)
                    .await
                {
                    eprintln!("HTTP/2 error: {}", e);
                }
            });
        }
    });
    
    Ok(ProxyServer { port: addr.port() })
}
```

### 2. Electron → cmux-proxy Communication (HTTP/2 Client)

**Why HTTP/2?**
- Persistent single connection for all upstream requests
- Reduced latency with connection reuse
- Better resource utilization

**Implementation**:
```rust
use hyper::client::conn::http2;

struct UpstreamClient {
    sender: h2::client::SendRequest<Bytes>,
}

impl UpstreamClient {
    async fn new(upstream_url: &str) -> Result<Self> {
        // Parse URL
        let uri: Uri = upstream_url.parse()?;
        let host = uri.host().unwrap();
        let port = uri.port_u16().unwrap_or(80);
        
        // Connect
        let stream = TcpStream::connect((host, port)).await?;
        let io = TokioIo::new(stream);
        
        // HTTP/2 handshake
        let (sender, conn) = h2::client::handshake(io).await?;
        
        // Spawn connection task
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                eprintln!("HTTP/2 conn error: {}", e);
            }
        });
        
        Ok(Self { sender })
    }
    
    async fn proxy_request(&mut self, req: Request<Body>) -> Result<Response<Body>> {
        // Forward request over HTTP/2
        let (response, _) = self.sender.send_request(req, false)?;
        let resp = response.await?;
        Ok(resp)
    }
}
```

### 3. Protocol Negotiation

**ALPN (Application-Layer Protocol Negotiation)**:
- For HTTPS upstream connections, use ALPN to negotiate HTTP/2
- Fallback to HTTP/1.1 if upstream doesn't support HTTP/2

```rust
use rustls::ClientConfig;
use tokio_rustls::TlsConnector;

fn create_tls_config() -> ClientConfig {
    let mut config = ClientConfig::builder()
        .with_safe_defaults()
        .with_native_roots()
        .with_no_client_auth();
    
    // Enable ALPN for HTTP/2
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    
    config
}
```

## Implementation Phases

### Phase 1: Setup & Foundation ✅
**Goal**: Create NAPI project structure

**Tasks**:
1. Create `crates/cmux-proxy-electron/` crate
2. Setup NAPI build configuration
3. Add to workspace
4. Create basic NAPI exports (hello world)
5. Integrate into Electron build system

**Files**:
- `crates/cmux-proxy-electron/Cargo.toml`
- `crates/cmux-proxy-electron/src/lib.rs`
- Update `package.json` with NAPI build scripts

### Phase 2: HTTP/1.1 Parity
**Goal**: Match existing Node.js functionality

**Tasks**:
1. Implement HTTP/1.1 proxy server (hyper)
2. Basic auth validation
3. Per-WebContents context management
4. HTTP request forwarding
5. CONNECT method (HTTPS tunneling)
6. WebSocket upgrade handling
7. Localhost → cmux domain rewriting

**Test**: Replace Node.js proxy, verify all existing tests pass

### Phase 3: HTTP/2 Server
**Goal**: Add HTTP/2 support for local server

**Tasks**:
1. Upgrade to hyper 1.x
2. Implement HTTP/2 server builder
3. Handle HTTP/2 streams
4. Test with Chrome DevTools (verify h2 in Network tab)
5. Backward compatibility with HTTP/1.1 clients

**Test**: Verify WebContents can use HTTP/2

### Phase 4: HTTP/2 Upstream Client
**Goal**: Use HTTP/2 for Electron → cmux-proxy

**Tasks**:
1. Implement HTTP/2 client with connection pooling
2. Request multiplexing over single connection
3. Error handling & reconnection logic
4. Performance benchmarking vs HTTP/1.1

**Test**: Verify requests to cmux-proxy use HTTP/2

### Phase 5: cmux-proxy HTTP/2 Support
**Goal**: Upgrade global cmux-proxy to HTTP/2

**Tasks**:
1. Update `crates/cmux-proxy` to hyper 1.x
2. Add HTTP/2 server support
3. Maintain HTTP/1.1 compatibility
4. Update tests

**Test**: Verify all proxy tests pass with HTTP/2

### Phase 6: Integration & Polish
**Goal**: Production-ready

**Tasks**:
1. Error handling & logging via tracing
2. Performance monitoring
3. Memory leak testing
4. Documentation
5. Migration guide for Electron code
6. Deprecate Node.js proxy

## Migration Path

### Step 1: Parallel Running
Run both Node.js and Rust proxies side-by-side:
```typescript
// Feature flag
const USE_RUST_PROXY = process.env.CMUX_USE_RUST_PROXY === 'true';

if (USE_RUST_PROXY) {
  const { ProxyServer } = require('@cmux/proxy-electron');
  // Use Rust implementation
} else {
  // Use existing Node.js implementation
}
```

### Step 2: Gradual Rollout
1. Alpha: Internal testing
2. Beta: Opt-in for users
3. GA: Default for all users
4. Remove Node.js implementation

### Step 3: Remove Old Code
- Delete `task-run-preview-proxy.ts`
- Update imports in `web-contents-view.ts`
- Update documentation

## Testing Strategy

### Unit Tests (Rust)
```rust
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn test_basic_auth() {
        // Test auth logic
    }
    
    #[tokio::test]
    async fn test_http2_request() {
        // Test HTTP/2 request handling
    }
}
```

### Integration Tests
- Test with real WebContents
- Verify all routes work (HTTP, HTTPS, WS)
- Performance benchmarks
- Memory leak detection

### Compatibility Tests
- Ensure existing preview functionality works
- Test with various web apps (React, Vue, Vite, etc.)
- DevTools compatibility

## Performance Goals

### Metrics to Track
1. **Request latency**: < 1ms overhead vs direct connection
2. **Memory usage**: < 10MB per proxy server
3. **Throughput**: > 10k req/s for HTTP/2
4. **Connection reuse**: 1 HTTP/2 conn to cmux-proxy

### Benchmarking
```rust
// Use criterion for benchmarks
cargo bench --bench proxy_performance
```

## WebSocket Implementation Details

### Why NOT Parse WebSocket Frames?

**Reasons**:
1. **Performance**: Frame parsing adds overhead (masking, fragmentation)
2. **Simplicity**: Proxy doesn't need to understand application protocol
3. **Compatibility**: Works with any WebSocket library (tungstenite, ws, Socket.IO)
4. **Extensions**: Supports all WebSocket extensions (compression, etc.) transparently

### Current Behavior (Node.js)

The existing Node proxy already does byte passthrough:
```typescript
// After upgrade, just pipe streams
upstream.pipe(socket);
socket.pipe(upstream);
```

### Rust Implementation

```rust
// Same approach - just copy bytes
async fn tunnel_websocket(
    mut client: impl AsyncRead + AsyncWrite + Unpin,
    mut upstream: impl AsyncRead + AsyncWrite + Unpin,
) -> Result<()> {
    // Bidirectional copy - no frame inspection
    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}
```

### Browser Compatibility

| Browser | HTTP/1.1 WS | HTTP/2 Extended CONNECT |
|---------|-------------|------------------------|
| Chrome 95+ | ✅ | ✅ |
| Firefox 88+ | ✅ | ✅ |
| Safari 15+ | ✅ | ⚠️ (experimental) |
| Edge 95+ | ✅ | ✅ |

**Decision**: Support both modes, auto-detect based on request

## Security Considerations

1. **Memory safety**: Rust eliminates buffer overflows
2. **Auth credentials**: Secure random generation
3. **TLS validation**: Use native cert store
4. **Input validation**: Strict header parsing
5. **Resource limits**: Connection limits, timeout enforcement
6. **WebSocket hijacking**: Auth required before upgrade/tunnel

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| NAPI complexity | High | Start simple, incremental features |
| Breaking changes | High | Feature flag, parallel running |
| Performance regression | Medium | Benchmark early, optimize |
| HTTP/2 bugs | Medium | Extensive testing, fallback to HTTP/1.1 |
| Build complexity | Low | Clear documentation, CI/CD |

## Success Criteria

✅ Rust proxy has feature parity with Node.js
✅ HTTP/2 working for both server and client
✅ No performance regression
✅ All existing tests pass
✅ Memory usage improved
✅ Documentation complete

## Timeline Estimate

- **Phase 1**: ✅ COMPLETE (1 day)
- **Phase 2**: ✅ COMPLETE (1 day)
- **Phase 3**: ✅ COMPLETE (included in Phase 2)
- **Phase 4**: ⏳ IN PROGRESS (1 week estimated)
- **Phase 5**: 🔄 TODO (1 week estimated)
- **Phase 6**: 🔄 TODO (1-2 weeks estimated)

**Original estimate**: 7-10 weeks (aggressive), 12-14 weeks (conservative)
**Actual (so far)**: 2 days for Phases 1-3

## Next Steps

1. Review and approve this plan
2. Create GitHub issues for each phase
3. Setup feature branch
4. Begin Phase 1 implementation
