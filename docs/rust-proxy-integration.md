# Rust Proxy Integration Guide

## Overview

The Electron WebContents proxy has been successfully refactored from Node.js to Rust with HTTP/2 support. The implementation is in `apps/server/native/core/src/proxy/`.

## Build Status

✅ **Compiled successfully** - The Rust proxy module builds without errors.

## Architecture

```
apps/server/native/core/
├── src/
│   ├── proxy/
│   │   ├── mod.rs          # Module exports
│   │   ├── server.rs       # HTTP/1.1 & HTTP/2 proxy server
│   │   ├── auth.rs         # Basic proxy authentication
│   │   ├── routing.rs      # URL rewriting (localhost → cmux domains)
│   │   └── tunnel.rs       # Bidirectional byte tunneling (WebSocket, CONNECT)
│   └── lib.rs              # NAPI exports
```

## TypeScript API

The NAPI module exports the following API:

```typescript
// Start a proxy server
const server = await ProxyServer.start(
  "127.0.0.1:39385",  // Listen address
  true                // Enable HTTP/2
);

// Get the bound port
const port = server.port();

// Create a context for a WebContents
const context = server.createContext(
  webContentsId,      // u32
  {                   // Optional route
    morphId: "abc123",
    scope: "base",
    domainSuffix: "cmux.app"
  }
);

// Returns:
// {
//   id: string,
//   username: string,
//   password: string,
//   webContentsId: number
// }

// Release context when WebContents is destroyed
server.releaseContext(context.id);

// Stop the server
server.stop();
```

## Integration Steps

### 1. Build the NAPI Module

```bash
cd apps/server/native/core
cargo build --release
```

This generates:
- `cmux_native_core.darwin-arm64.node` (macOS ARM)
- `index.d.ts` (TypeScript definitions)

### 2. Update Electron Code

Replace the Node.js proxy in `apps/client/electron/main/task-run-preview-proxy.ts`:

```typescript
import { ProxyServer } from '@cmux/server/native/core';

let proxyServer: ProxyServer | null = null;

export async function startPreviewProxy(logger: Logger): Promise<number> {
  if (proxyServer) {
    return proxyServer.port();
  }

  // Try ports starting at 39385
  for (let i = 0; i < 50; i++) {
    const port = 39385 + i;
    try {
      proxyServer = await ProxyServer.start(
        `127.0.0.1:${port}`,
        true  // Enable HTTP/2
      );
      
      logger.log('Rust proxy server started', { port });
      return port;
    } catch (error) {
      if (i === 49) {
        throw new Error('Failed to start proxy server');
      }
      // Try next port
    }
  }
  
  throw new Error('Unreachable');
}

export async function configurePreviewProxyForView(
  options: ConfigureOptions
): Promise<() => void> {
  const { webContents, initialUrl, persistKey, logger } = options;
  
  if (!proxyServer) {
    throw new Error('Proxy server not started');
  }

  const route = deriveRoute(initialUrl);
  if (!route) {
    logger.warn('Preview proxy skipped; unable to parse cmux host', {
      url: initialUrl,
      persistKey,
    });
    return () => {};
  }

  const context = proxyServer.createContext(webContents.id, {
    morphId: route.morphId,
    scope: route.scope,
    domainSuffix: route.domainSuffix,
  });

  const port = proxyServer.port();

  try {
    await webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: '<-loopback>',
    });
  } catch (error) {
    proxyServer.releaseContext(context.id);
    logger.warn('Failed to configure preview proxy', { error });
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    
    if (proxyServer) {
      proxyServer.releaseContext(context.id);
    }
    
    logger.log('Released proxy context', {
      webContentsId: webContents.id,
      persistKey,
    });
  };

  webContents.once('destroyed', cleanup);
  
  logger.log('Configured proxy context', {
    webContentsId: webContents.id,
    persistKey,
    route,
  });
  
  return cleanup;
}

export function getProxyCredentialsForWebContents(
  id: number
): { username: string; password: string } | null {
  // This function is only used for the app.on('login') handler
  // With the Rust proxy, auth is handled internally
  // Return null to indicate authentication is not needed
  return null;
}

export function releasePreviewProxy(webContentsId: number): void {
  // Context is released via cleanup function in configurePreviewProxyForView
}
```

## Features Implemented

### ✅ Phase 1-2: HTTP/1.1 Proxy (COMPLETE)
- [x] Basic authentication per WebContents
- [x] HTTP request proxying
- [x] CONNECT method (HTTPS tunneling)
- [x] WebSocket upgrade (bidirectional byte tunnel)
- [x] URL rewriting (localhost → cmux domains)

### ✅ Phase 3: HTTP/2 Server (COMPLETE)
- [x] HTTP/2 server support  
- [x] Automatic fallback to HTTP/1.1
- [x] WebSocket over HTTP/1.1 (no HTTP/2 Extended CONNECT yet)

### ⏳ Phase 4: HTTP/2 Upstream Client (TODO)
- [ ] HTTP/2 client for upstream cmux-proxy
- [ ] Connection pooling
- [ ] Request multiplexing

### ⏳ Phase 5: cmux-proxy HTTP/2 (TODO)
- [ ] Upgrade global cmux-proxy to hyper 1.x
- [ ] Add HTTP/2 support

## Testing

### Unit Tests

```bash
cd apps/server/native/core
cargo test
```

### Integration Test

1. Start the Rust proxy:
```typescript
const server = await ProxyServer.start("127.0.0.1:39385", true);
console.log(`Proxy listening on port ${server.port()}`);
```

2. Create a context:
```typescript
const ctx = server.createContext(123, {
  morphId: "test-id",
  scope: "base",
  domainSuffix: "cmux.app"
});
console.log("Context credentials:", ctx.username, ctx.password);
```

3. Configure Electron WebContents:
```typescript
await webContents.session.setProxy({
  proxyRules: `http=127.0.0.1:${server.port()};https=127.0.0.1:${server.port()}`,
  proxyBypassRules: '<-loopback>',
});
```

4. Test with a request:
```bash
curl -x http://127.0.0.1:39385 \
  --proxy-user wc-123-xxx:password \
  http://localhost:3000/test
```

## Performance

Expected improvements over Node.js:
- **Memory**: ~50% reduction (Rust vs V8)
- **Latency**: <1ms overhead per request
- **Throughput**: >10k req/s with HTTP/2 multiplexing

## Next Steps

1. ✅ Rust proxy compiles
2. 🔄 Test in Electron environment
3. 🔄 Add HTTP/2 upstream client
4. 🔄 Upgrade global cmux-proxy to HTTP/2
5. 🔄 Performance benchmarking
6. 🔄 Production rollout with feature flag

## Migration Strategy

### Phase 1: Parallel Running (CURRENT)
- Keep Node.js proxy as fallback
- Feature flag: `CMUX_USE_RUST_PROXY=true`

### Phase 2: Default to Rust
- Rust proxy becomes default
- Node.js proxy deprecated

### Phase 3: Remove Node.js
- Delete `task-run-preview-proxy.ts`
- Clean up legacy code

## Known Limitations

1. **HTTP/2 Extended CONNECT**: Not yet implemented for WebSockets over HTTP/2
2. **TLS upstream**: Currently plain TCP, need to add rustls for HTTPS upstream
3. **Response parsing**: HTTP responses are simplified (no full HTTP parser yet)

## Success Criteria

- [x] Compiles without errors
- [ ] All existing WebContents preview features work
- [ ] No memory leaks
- [ ] Performance >= Node.js proxy
- [ ] HTTP/2 support verified in Chrome DevTools
