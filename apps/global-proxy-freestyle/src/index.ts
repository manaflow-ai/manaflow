/**
 * Global Proxy for Freestyle Deployment
 *
 * Routing patterns:
 * - {vm_id}-{port}.proxy.cmux.sh -> {vm_id}.vm.freestyle.sh (Freestyle, simple)
 * - cmux-{morph_id}-{scope}-{port}.proxy.cmux.sh -> port-39379-morphvm-{morph_id}.http.cloud.morph.so
 * - cmuf-{vm_id}-base-{port}.proxy.cmux.sh -> {vm_id}.vm.freestyle.sh (Freestyle, legacy)
 * - port-{port}-{morph_id}.proxy.cmux.sh -> port-{port}-morphvm-{morph_id}.http.cloud.morph.so
 *
 * Supports both HTTP and WebSocket proxying.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";

const MORPH_DOMAIN_SUFFIX = ".http.cloud.morph.so";
const FREESTYLE_DOMAIN_SUFFIX = ".vm.freestyle.sh";

interface ParsedRoute {
  type: "cmux" | "cmuf" | "port" | "workspace" | "invalid" | "root";
  target?: string;
  targetHost?: string;
  error?: string;
  port?: number;
  skipServiceWorker?: boolean;
  addCors?: boolean;
}

function parseHost(host: string): { subdomain: string | null; domain: string } | null {
  const normalized = host.toLowerCase().replace(/:\d+$/, "");

  if (normalized === "proxy.cmux.sh") {
    return { subdomain: null, domain: "proxy.cmux.sh" };
  }
  if (normalized.endsWith(".proxy.cmux.sh")) {
    const prefix = normalized.slice(0, -".proxy.cmux.sh".length);
    return { subdomain: prefix || null, domain: "proxy.cmux.sh" };
  }

  if (normalized === "cmux.sh") {
    return { subdomain: null, domain: "cmux.sh" };
  }
  if (normalized.endsWith(".cmux.sh")) {
    const prefix = normalized.slice(0, -".cmux.sh".length);
    return { subdomain: prefix || null, domain: "cmux.sh" };
  }

  return null;
}

function parseRoute(subdomain: string): ParsedRoute {
  // port-{port}-{morph_id} pattern
  if (subdomain.startsWith("port-")) {
    const rest = subdomain.slice("port-".length);
    const segments = rest.split("-");
    if (segments.length < 2) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const port = parseInt(segments[0], 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const morphId = segments.slice(1).join("-");
    if (!morphId) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const targetHost = `port-${port}-morphvm-${morphId}${MORPH_DOMAIN_SUFFIX}`;
    const target = `https://${targetHost}`;
    return {
      type: "port",
      target,
      targetHost,
      port,
      skipServiceWorker: port === 39378,
    };
  }

  // cmux-{morph_id}-{scope}-{port} pattern
  if (subdomain.startsWith("cmux-")) {
    const rest = subdomain.slice("cmux-".length);
    const segments = rest.split("-");
    if (segments.length < 2) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const morphId = segments[0];
    if (!morphId) {
      return { type: "invalid", error: "Missing morph id in cmux proxy subdomain" };
    }

    const portSegment = segments[segments.length - 1];
    const port = parseInt(portSegment, 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid port in cmux proxy subdomain" };
    }

    const targetHost = `port-39379-morphvm-${morphId}${MORPH_DOMAIN_SUFFIX}`;
    const target = `https://${targetHost}`;
    return {
      type: "cmux",
      target,
      targetHost,
      port,
      skipServiceWorker: true,
      addCors: port !== 39378,
    };
  }

  // cmuf-{vm_id}-base-{port} pattern (Freestyle VMs)
  if (subdomain.startsWith("cmuf-")) {
    const rest = subdomain.slice("cmuf-".length);
    const segments = rest.split("-");
    if (segments.length < 3) {
      return { type: "invalid", error: "Invalid cmuf proxy subdomain" };
    }

    const vmId = segments[0];
    if (!vmId) {
      return { type: "invalid", error: "Missing vm id in cmuf proxy subdomain" };
    }

    const portSegment = segments[segments.length - 1];
    const port = parseInt(portSegment, 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid port in cmuf proxy subdomain" };
    }

    const targetHost = `${vmId}${FREESTYLE_DOMAIN_SUFFIX}`;
    const target = `https://${targetHost}`;
    return {
      type: "cmuf",
      target,
      targetHost,
      port,
      skipServiceWorker: true,
      addCors: true,
    };
  }

  // Simple Freestyle pattern: {vm_id}-{port}
  // VM IDs are 5-character lowercase alphanumeric strings
  const parts = subdomain.split("-");
  if (parts.length === 2) {
    const [vmId, portSegment] = parts;
    const port = parseInt(portSegment, 10);
    if (vmId && /^[a-z0-9]{5}$/.test(vmId) && !isNaN(port)) {
      const targetHost = `${vmId}${FREESTYLE_DOMAIN_SUFFIX}`;
      const target = `https://${targetHost}`;
      return {
        type: "cmuf",
        target,
        targetHost,
        port,
        skipServiceWorker: true,
        addCors: true,
      };
    }
  }

  // workspace pattern: {workspace}-{port}-{vm_slug}
  if (parts.length >= 3) {
    const portSegment = parts[parts.length - 2];
    const vmSlug = parts[parts.length - 1];
    const workspaceParts = parts.slice(0, -2);

    if (workspaceParts.length > 0 && vmSlug) {
      const port = parseInt(portSegment, 10);
      if (!isNaN(port)) {
        const targetHost = `${vmSlug}${FREESTYLE_DOMAIN_SUFFIX}`;
        const target = `https://${targetHost}`;
        return {
          type: "workspace",
          target,
          targetHost,
          port,
        };
      }
    }
  }

  return { type: "invalid", error: "Invalid cmux subdomain" };
}

function addCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-expose-headers", "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-max-age", "86400");
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // Health check
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "healthy",
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Get host from X-Forwarded-Host or Host header
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";

  // Debug headers endpoint
  if (url.pathname === "/debug-headers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      headers: req.headers,
      httpVersion: req.httpVersion,
    }, null, 2));
    return;
  }

  // Version endpoint
  if (url.pathname === "/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      version: "0.1.0",
      runtime: "freestyle",
      features: ["http", "websocket"],
    }));
    return;
  }

  const parsed = parseHost(host);
  if (!parsed) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Not a cmux domain");
    return;
  }

  if (!parsed.subdomain) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("cmux proxy!");
    return;
  }

  const route = parseRoute(parsed.subdomain);

  if (route.type === "invalid") {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end(route.error || "Invalid route");
    return;
  }

  if (!route.target) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("No target for route");
    return;
  }

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    if (route.addCors) {
      addCorsHeaders(res);
    }
    res.writeHead(204);
    res.end();
    return;
  }

  // Proxy the request
  const targetUrl = new URL(url.pathname + url.search, route.target);

  const proxyHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value && key !== "host" && key !== "x-forwarded-host") {
      proxyHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
    }
  }
  proxyHeaders["host"] = new URL(route.target).host;
  proxyHeaders["x-cmux-proxied"] = "true";
  if (route.port) {
    proxyHeaders["x-cmux-port-internal"] = route.port.toString();
  }

  try {
    let body: Buffer | undefined;
    const hasBody = req.method && ["POST", "PUT", "PATCH"].includes(req.method);
    if (hasBody) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    }

    const response = await fetch(targetUrl.toString(), {
      method: req.method || "GET",
      headers: proxyHeaders,
      body: body ? new Uint8Array(body) : undefined,
    });

    if (route.addCors) {
      addCorsHeaders(res);
    }

    const skipHeaders = new Set([
      "content-security-policy",
      "content-security-policy-report-only",
      "x-frame-options",
      "frame-options",
      "transfer-encoding",
    ]);

    response.headers.forEach((value, key) => {
      if (!skipHeaders.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    res.writeHead(response.status, response.statusText);

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error("Proxy error:", error);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Upstream fetch failed");
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Request handler error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
    res.end("Internal server error");
  });
});

// WebSocket server for handling upgrades
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket connections (for /ws-test echo)
wss.on("connection", (ws) => {
  console.log("[WS] Echo client connected");
  ws.on("message", (message) => {
    ws.send(message);
  });
  ws.on("close", () => {
    console.log("[WS] Echo client disconnected");
  });
});

// WebSocket upgrade handler
server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const url = new URL(req.url || "/", `http://${host}`);

  console.log(`[WS] Upgrade request: ${host}${req.url}`);

  // Test endpoint: /ws-test - simple echo WebSocket
  const parsed = parseHost(host);
  if (url.pathname === "/ws-test" && (!parsed?.subdomain)) {
    console.log("[WS] Handling /ws-test echo endpoint");
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }

  if (!parsed || !parsed.subdomain) {
    console.log("[WS] Invalid host or no subdomain");
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const route = parseRoute(parsed.subdomain);
  if (route.type === "invalid" || !route.targetHost) {
    console.log("[WS] Invalid route:", route.error);
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  console.log(`[WS] Proxying to wss://${route.targetHost}${url.pathname}`);

  // Proxy WebSocket to upstream
  const targetWsUrl = `wss://${route.targetHost}${url.pathname}${url.search}`;
  const upstreamWs = new WebSocket(targetWsUrl, {
    headers: {
      "x-cmux-proxied": "true",
      "x-cmux-port-internal": route.port?.toString() || "",
    },
  });

  upstreamWs.on("open", () => {
    console.log("[WS] Upstream connected");
    // Complete the upgrade with the client
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      console.log("[WS] Client upgraded, piping data");

      // Pipe messages bidirectionally
      clientWs.on("message", (data) => {
        if (upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(data);
        }
      });

      upstreamWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      clientWs.on("close", () => {
        console.log("[WS] Client closed");
        upstreamWs.close();
      });

      upstreamWs.on("close", () => {
        console.log("[WS] Upstream closed");
        clientWs.close();
      });

      clientWs.on("error", (err) => {
        console.error("[WS] Client error:", err.message);
        upstreamWs.close();
      });

      upstreamWs.on("error", (err) => {
        console.error("[WS] Upstream error:", err.message);
        clientWs.close();
      });
    });
  });

  upstreamWs.on("error", (err) => {
    console.error("[WS] Failed to connect to upstream:", err.message);
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
  });
});

server.listen(3000, () => {
  console.log("Global proxy running on port 3000");
});
