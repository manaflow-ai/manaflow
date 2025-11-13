import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import http2, {
  type ClientHttp2Session,
  type ClientHttp2Stream,
  type IncomingHttpHeaders as Http2IncomingHttpHeaders,
  type OutgoingHttpHeaders as Http2OutgoingHttpHeaders,
  type ServerHttp2Stream,
} from "node:http2";
import https from "node:https";
import net, { type Server as NetServer, type Socket } from "node:net";
import tls, { type TLSSocket } from "node:tls";
import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import type { Session, WebContents } from "electron";
import { isLoopbackHostname } from "@cmux/shared";
import type { Logger } from "./chrome-camouflage";

type ProxyServer = {
  listener: NetServer;
  http1: http.Server;
  http2: http2.Http2Server;
};

const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const DEFAULT_PROXY_LOGGING_ENABLED = false;
const HTTP2_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const CMUX_DOMAINS = [
  "cmux.app",
  "cmux.sh",
  "cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "autobuild.app",
] as const;

interface ProxyRoute {
  morphId: string;
  scope: string;
  domainSuffix: (typeof CMUX_DOMAINS)[number];
}

interface ProxyContext {
  username: string;
  password: string;
  route: ProxyRoute | null;
  session: Session;
  webContentsId: number;
  persistKey?: string;
}

interface ProxyTarget {
  url: URL;
  secure: boolean;
  connectPort: number;
}

interface ConfigureOptions {
  webContents: WebContents;
  initialUrl: string;
  persistKey?: string;
  logger: Logger;
}

let proxyServer: ProxyServer | null = null;
let proxyPort: number | null = null;
let proxyLogger: Logger | null = null;
let startingProxy: Promise<number> | null = null;
let proxyLoggingEnabled = DEFAULT_PROXY_LOGGING_ENABLED;
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 256,
});
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 256,
});
const http2Sessions = new Map<string, ClientHttp2Session>();

export function setPreviewProxyLoggingEnabled(enabled: boolean): void {
  proxyLoggingEnabled = Boolean(enabled);
}

const contextsByUsername = new Map<string, ProxyContext>();
const contextsByWebContentsId = new Map<number, ProxyContext>();

function proxyLog(event: string, data?: Record<string, unknown>): void {
  if (!proxyLoggingEnabled) {
    return;
  }
  try {
    proxyLogger?.log("Preview proxy", { event, ...(data ?? {}) });
  } catch (error) {
    console.error("Failed to log preview proxy", error);
  }
}

function proxyWarn(event: string, data?: Record<string, unknown>): void {
  if (!proxyLoggingEnabled) {
    return;
  }
  try {
    proxyLogger?.warn("Preview proxy", { event, ...(data ?? {}) });
  } catch (error) {
    console.error("Failed to log preview proxy", error);
  }
}

export function isTaskRunPreviewPersistKey(
  key: string | undefined
): key is string {
  return typeof key === "string" && key.startsWith(TASK_RUN_PREVIEW_PREFIX);
}

export function getPreviewPartitionForPersistKey(
  key: string | undefined
): string | null {
  if (!isTaskRunPreviewPersistKey(key)) {
    return null;
  }
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `persist:cmux-preview-${hash}`;
}

export function getProxyCredentialsForWebContents(
  id: number
): { username: string; password: string } | null {
  const context = contextsByWebContentsId.get(id);
  if (!context) return null;
  return { username: context.username, password: context.password };
}

export function releasePreviewProxy(webContentsId: number): void {
  const context = contextsByWebContentsId.get(webContentsId);
  if (!context) return;
  contextsByWebContentsId.delete(webContentsId);
  contextsByUsername.delete(context.username);
  proxyLog("reset-session-proxy", {
    webContentsId,
    persistKey: context.persistKey,
  });
  void context.session.setProxy({ mode: "direct" }).catch((err) => {
    console.error("Failed to reset preview proxy", err);
  });
}

export async function configurePreviewProxyForView(
  options: ConfigureOptions
): Promise<() => void> {
  const { webContents, initialUrl, persistKey, logger } = options;
  const route = deriveRoute(initialUrl);
  if (!route) {
    logger.warn("Preview proxy skipped; unable to parse cmux host", {
      url: initialUrl,
      persistKey,
    });
    return () => {};
  }

  const port = await ensureProxyServer(logger);
  const username = `wc-${webContents.id}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");

  const context: ProxyContext = {
    username,
    password,
    route,
    session: webContents.session,
    webContentsId: webContents.id,
    persistKey,
  };

  contextsByUsername.set(username, context);
  contextsByWebContentsId.set(webContents.id, context);

  try {
    await webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: "<-loopback>",
    });
  } catch (error) {
    contextsByUsername.delete(username);
    contextsByWebContentsId.delete(webContents.id);
    logger.warn("Failed to configure preview proxy", { error });
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    releasePreviewProxy(webContents.id);
    proxyLog("released-context", {
      webContentsId: webContents.id,
      persistKey,
    });
  };

  webContents.once("destroyed", cleanup);
  proxyLog("configured-context", {
    webContentsId: webContents.id,
    persistKey,
    route,
  });
  return cleanup;
}

export function startPreviewProxy(logger: Logger): Promise<number> {
  return ensureProxyServer(logger);
}

async function ensureProxyServer(logger: Logger): Promise<number> {
  if (proxyPort && proxyServer) {
    return proxyPort;
  }
  if (startingProxy) {
    return startingProxy;
  }
  startingProxy = startProxyServer(logger);
  try {
    const port = await startingProxy;
    proxyPort = port;
    return port;
  } finally {
    startingProxy = null;
  }
}

async function startProxyServer(logger: Logger): Promise<number> {
  const startPort = 39385;
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidatePort = startPort + i;
    const server = createProxyServer(logger);
    try {
      await listen(server.listener, candidatePort);
      proxyServer = server;
      proxyLogger = logger;
      console.log(`[cmux-preview-proxy] listening on port ${candidatePort}`);
      logger.log("Preview proxy listening", { port: candidatePort });
      proxyLog("listening", { port: candidatePort });
      return candidatePort;
    } catch (error) {
      closeProxyServer(server);
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unable to bind preview proxy port");
}

function createProxyServer(logger: Logger): ProxyServer {
  const http1Server = http.createServer();
  attachHttp1Handlers(http1Server);
  const http2Server = http2.createServer();
  attachHttp2Handlers(http2Server);
  const listener = net.createServer((socket) => {
    try {
      multiplexConnection(socket, http1Server, http2Server);
    } catch (error) {
      proxyLogger?.warn("Proxy connection multiplexing failed", { error });
      socket.destroy();
    }
  });
  listener.on("error", (error) => {
    logger.warn("Preview proxy listener error", { error });
  });
  return {
    listener,
    http1: http1Server,
    http2: http2Server,
  };
}

function closeProxyServer(server: ProxyServer | null): void {
  if (!server) {
    return;
  }
  try {
    server.listener.removeAllListeners();
    server.listener.close();
  } catch (error) {
    console.error("Failed to close preview proxy listener", error);
  }
  try {
    server.http1.removeAllListeners();
    server.http1.close();
  } catch (error) {
    console.error("Failed to close preview proxy http1 server", error);
  }
  try {
    server.http2.removeAllListeners();
    server.http2.close();
  } catch (error) {
    console.error("Failed to close preview proxy http2 server", error);
  }
}

function listen(server: NetServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, "127.0.0.1");
  });
}

function multiplexConnection(
  socket: Socket,
  http1Server: http.Server,
  http2Server: http2.Http2Server
) {
  socket.setNoDelay(true);
  socket.setTimeout(10_000, () => {
    socket.destroy();
  });
  const bufferedChunks: Buffer[] = [];
  let buffered = Buffer.alloc(0);
  let decided = false;

  const cleanup = () => {
    socket.removeListener("data", handleChunk);
  };

  const routeSocket = (protocol: "http1" | "h2") => {
    if (decided) {
      return;
    }
    decided = true;
    cleanup();
    for (let i = bufferedChunks.length - 1; i >= 0; i -= 1) {
      socket.unshift(bufferedChunks[i]);
    }
    bufferedChunks.length = 0;
    buffered = Buffer.alloc(0);
    socket.setTimeout(0);
    socket.resume();
    if (protocol === "h2") {
      http2Server.emit("connection", socket);
    } else {
      http1Server.emit("connection", socket);
    }
  };

  const handleChunk = (chunk: Buffer) => {
    bufferedChunks.push(chunk);
    buffered =
      buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    const protocol = detectProtocol(buffered);
    if (protocol) {
      routeSocket(protocol);
    }
  };

  socket.on("data", handleChunk);
  socket.once("close", cleanup);
  socket.once("error", cleanup);
}

function detectProtocol(buffer: Buffer): "http1" | "h2" | null {
  const length = Math.min(buffer.length, HTTP2_PREFACE.length);
  for (let i = 0; i < length; i += 1) {
    if (buffer[i] !== HTTP2_PREFACE[i]) {
      return "http1";
    }
  }
  if (buffer.length >= HTTP2_PREFACE.length) {
    return "h2";
  }
  return null;
}

function attachHttp1Handlers(server: http.Server) {
  server.on("request", handleHttpRequest);
  server.on("connect", handleConnect);
  server.on("upgrade", handleUpgrade);
  server.on("clientError", (error, socket) => {
    proxyLogger?.warn("Proxy client error", { error });
    socket.end();
  });
}

function attachHttp2Handlers(server: http2.Http2Server) {
  server.on("stream", handleHttp2Stream);
  server.on("sessionError", (error) => {
    proxyLogger?.warn("Proxy HTTP/2 session error", { error });
  });
}

function handleHttp2Stream(
  stream: ServerHttp2Stream,
  headers: Http2IncomingHttpHeaders
) {
  const context = authenticateRequest(headers as IncomingHttpHeaders);
  if (!context) {
    respondHttp2AuthRequired(stream);
    return;
  }

  const method = String(headers[":method"] ?? "GET").toUpperCase();
  if (method === "CONNECT") {
    handleHttp2Connect(stream, headers, context);
    return;
  }

  const target = parseHttp2RequestTarget(headers);
  if (!target) {
    proxyWarn("http2-target-parse-failed", {
      authority: headers[":authority"],
      path: headers[":path"],
    });
    respondHttp2BadRequest(stream);
    return;
  }

  const rewritten = rewriteTarget(target, context);
  proxyLog("http2-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port ?? null,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  forwardHttp2Request(stream, headers, rewritten, context);
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequired(res);
    return;
  }

  const target = parseProxyRequestTarget(req);
  if (!target) {
    proxyWarn("http-target-parse-failed", {
      url: req.url,
      host: req.headers.host,
    });
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  const rewritten = rewriteTarget(target, context);
  proxyLog("http-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  forwardHttpRequest(req, res, rewritten, context);
}

function handleConnect(req: IncomingMessage, socket: Socket, head: Buffer) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequiredSocket(socket);
    return;
  }

  const target = parseConnectTarget(req.url ?? "");
  if (!target) {
    proxyWarn("connect-target-parse-failed", {
      url: req.url,
    });
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.end();
    return;
  }

  const targetUrl = new URL(`https://${target.hostname}`);
  targetUrl.port = String(target.port);
  const rewritten = rewriteTarget(targetUrl, context);

  proxyLog("connect-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  const upstream = net.connect(rewritten.connectPort, rewritten.url.hostname, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", (error) => {
    proxyLogger?.warn("CONNECT upstream error", { error });
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
  });

  socket.on("error", () => {
    upstream.destroy();
  });
}

function handleHttp2Connect(
  stream: ServerHttp2Stream,
  headers: Http2IncomingHttpHeaders,
  context: ProxyContext
) {
  const target = parseHttp2ConnectTarget(headers);
  if (!target) {
    proxyWarn("http2-connect-target-parse-failed", {
      authority: headers[":authority"],
    });
    respondHttp2BadRequest(stream);
    return;
  }

  const targetUrl = new URL(`https://${target.hostname}`);
  targetUrl.port = String(target.port);
  const rewritten = rewriteTarget(targetUrl, context);
  proxyLog("http2-connect-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });

  let responded = false;
  const upstream = net.connect(
    rewritten.connectPort,
    rewritten.url.hostname,
    () => {
      if (stream.closed) {
        upstream.destroy();
        return;
      }
      try {
        stream.respond({ ":status": 200 });
        responded = true;
      } catch (_error) {
        upstream.destroy();
        stream.close();
        return;
      }
      stream.pipe(upstream);
      upstream.pipe(stream);
    }
  );

  const failConnect = () => {
    if (stream.closed) {
      return;
    }
    if (!responded) {
      try {
        stream.respond({ ":status": 502 });
      } catch {
        stream.close();
        return;
      }
    }
    stream.end("Bad Gateway");
  };

  upstream.on("error", (error) => {
    proxyLogger?.warn("HTTP/2 CONNECT upstream error", { error });
    failConnect();
  });

  stream.on("aborted", () => {
    upstream.destroy();
  });
  stream.on("close", () => {
    upstream.destroy();
  });
  stream.on("error", () => {
    upstream.destroy();
  });
}

function handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequiredSocket(socket);
    return;
  }

  const target = parseProxyRequestTarget(req);
  if (!target) {
    proxyWarn("upgrade-target-parse-failed", {
      url: req.url,
      host: req.headers.host,
    });
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.end();
    return;
  }

  const rewritten = rewriteTarget(target, context);
  proxyLog("upgrade-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  forwardUpgradeRequest(req, socket, head, rewritten);
}

function authenticateRequest(
  headers: IncomingHttpHeaders
): ProxyContext | null {
  const raw = headers["proxy-authorization"];
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  const context = contextsByUsername.get(username);
  if (!context || context.password !== password) {
    return null;
  }
  return context;
}

function respondProxyAuthRequired(res: ServerResponse) {
  res.writeHead(407, {
    "Proxy-Authenticate": 'Basic realm="Cmux Preview Proxy"',
  });
  res.end("Proxy Authentication Required");
}

function respondProxyAuthRequiredSocket(socket: Socket) {
  socket.write(
    'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Cmux Preview Proxy"\r\n\r\n'
  );
  socket.end();
}

function respondHttp2AuthRequired(stream: ServerHttp2Stream) {
  if (stream.closed) {
    return;
  }
  stream.respond({
    ":status": 407,
    "proxy-authenticate": 'Basic realm="Cmux Preview Proxy"',
  });
  stream.end("Proxy Authentication Required");
}

function respondHttp2BadRequest(stream: ServerHttp2Stream) {
  if (stream.closed) {
    return;
  }
  stream.respond({ ":status": 400 });
  stream.end("Bad Request");
}

function parseProxyRequestTarget(req: IncomingMessage): URL | null {
  try {
    if (req.url && /^[a-z]+:\/\//i.test(req.url)) {
      const normalized = req.url.replace(/^ws(s)?:\/\//i, (_match, secure) =>
        secure ? "https://" : "http://"
      );
      return new URL(normalized);
    }
    const host = req.headers.host;
    if (!host || !req.url) {
      return null;
    }
    return new URL(`http://${host}${req.url}`);
  } catch (error) {
    console.error("Failed to parse proxy request target", error);
    return null;
  }
}

function parseHttp2RequestTarget(
  headers: Http2IncomingHttpHeaders
): URL | null {
  try {
    const rawPath = getHeaderValue(headers, ":path");
    if (rawPath && /^[a-z]+:\/\//i.test(rawPath)) {
      return new URL(rawPath);
    }
    const scheme = getHeaderValue(headers, ":scheme") ?? "https";
    const authority = getHeaderValue(headers, ":authority");
    const path = rawPath ?? "/";
    if (!authority) {
      return null;
    }
    return new URL(`${scheme}://${authority}${path}`);
  } catch (error) {
    console.error("Failed to parse HTTP/2 proxy request target", error);
    return null;
  }
}

function parseConnectTarget(
  input: string
): { hostname: string; port: number } | null {
  if (!input) return null;
  const [host, portString] = input.split(":");
  const port = Number.parseInt(portString ?? "", 10);
  if (!host || Number.isNaN(port)) {
    return null;
  }
  return { hostname: host, port };
}

function parseHttp2ConnectTarget(
  headers: Http2IncomingHttpHeaders
): { hostname: string; port: number } | null {
  const authority = getHeaderValue(headers, ":authority");
  if (!authority) {
    return null;
  }
  const [hostname, portString] = authority.split(":");
  const port = Number.parseInt(portString ?? "", 10);
  if (!hostname || Number.isNaN(port)) {
    return null;
  }
  return { hostname, port };
}

function rewriteTarget(url: URL, context: ProxyContext): ProxyTarget {
  const rewritten = new URL(url.toString());
  let secure = rewritten.protocol === "https:";

  if (context.route && isLoopbackHostname(rewritten.hostname)) {
    const requestedPort = determineRequestedPort(url);
    rewritten.protocol = "https:";
    rewritten.hostname = buildCmuxHost(context.route, requestedPort);
    rewritten.port = "";
    secure = true;
  }

  const connectPort = Number.parseInt(rewritten.port, 10);
  const resolvedPort = Number.isNaN(connectPort)
    ? secure
      ? 443
      : 80
    : connectPort;

  return {
    url: rewritten,
    secure,
    connectPort: resolvedPort,
  };
}

function determineRequestedPort(url: URL): number {
  if (url.port) {
    const parsed = Number.parseInt(url.port, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (url.protocol === "https:" || url.protocol === "wss:") {
    return 443;
  }
  return 80;
}

function buildCmuxHost(route: ProxyRoute, port: number): string {
  const safePort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 80;
  return `cmux-${route.morphId}-${route.scope}-${safePort}.${route.domainSuffix}`;
}

function forwardHttpRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  context: ProxyContext
) {
  const requestHeaders = buildHttp1ForwardHeaders(
    clientReq.headers,
    target.url.host
  );

  const cancelUpstream = sendUpstreamRequest(
    target,
    clientReq.method ?? "GET",
    requestHeaders,
    clientReq,
    (statusCode, statusMessage, headers, upstream) => {
      if (statusMessage) {
        clientRes.writeHead(statusCode, statusMessage, headers);
      } else {
        clientRes.writeHead(statusCode, headers);
      }
      upstream.pipe(clientRes);
    },
    (error) => {
      proxyWarn("http-upstream-error", {
        error,
        persistKey: context.persistKey,
        username: context.username,
        host: target.url.hostname,
      });
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
      }
      clientRes.end("Bad Gateway");
    }
  );

  const abort = () => {
    cancelUpstream();
  };
  clientReq.on("aborted", abort);
  clientReq.on("error", abort);
  clientRes.on("close", abort);
}

function forwardHttp2Request(
  stream: ServerHttp2Stream,
  headers: Http2IncomingHttpHeaders,
  target: ProxyTarget,
  context: ProxyContext
) {
  const method = String(headers[":method"] ?? "GET");
  const requestHeaders = buildHttp2ForwardHeaders(headers, target.url.host);
  let responded = false;

  const sendBadGateway = () => {
    if (stream.closed) {
      return;
    }
    if (!responded) {
      try {
        stream.respond({ ":status": 502 });
        responded = true;
      } catch {
        stream.close();
        return;
      }
    }
    stream.end("Bad Gateway");
  };

  const cancelUpstream = sendUpstreamRequest(
    target,
    method,
    requestHeaders,
    stream,
    (statusCode, _statusMessage, responseHeaders, upstream) => {
      if (stream.closed) {
        upstream.destroy();
        return;
      }
      const http2Headers: Http2OutgoingHttpHeaders = {
        ":status": statusCode,
      };
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (typeof value === "undefined") continue;
        if (Array.isArray(value)) {
          http2Headers[key.toLowerCase()] = value;
        } else {
          http2Headers[key.toLowerCase()] = value;
        }
      }
      try {
        stream.respond(http2Headers);
        responded = true;
      } catch (error) {
        proxyWarn("http2-response-write-failed", {
          error,
          host: target.url.hostname,
        });
        stream.close();
        upstream.destroy();
        return;
      }
      upstream.pipe(stream);
    },
    (error) => {
      proxyWarn("http2-upstream-error", {
        error,
        persistKey: context.persistKey,
        username: context.username,
        host: target.url.hostname,
      });
      sendBadGateway();
    }
  );

  const abort = () => {
    cancelUpstream();
  };
  stream.on("aborted", abort);
  stream.on("close", abort);
  stream.on("error", abort);
}

function forwardUpgradeRequest(
  clientReq: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: ProxyTarget
) {
  const { url, secure, connectPort } = target;
  const upstream: Socket | TLSSocket = secure
    ? tls.connect({
        host: url.hostname,
        port: connectPort,
        servername: url.hostname,
      })
    : net.connect(connectPort, url.hostname);

  const handleConnected = () => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(clientReq.headers)) {
      if (!value) continue;
      if (key.toLowerCase() === "proxy-authorization") continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }
    headers.host = url.host;

    const lines = [
      `${clientReq.method ?? "GET"} ${url.pathname}${url.search} HTTP/1.1`,
    ];
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("\r\n");
    upstream.write(lines.join("\r\n"));
    if (head.length > 0) {
      upstream.write(head);
    }

    upstream.pipe(socket);
    socket.pipe(upstream);
  };

  if (secure && upstream instanceof tls.TLSSocket) {
    upstream.once("secureConnect", handleConnected);
  } else {
    upstream.once("connect", handleConnected);
  }

  upstream.on("error", (error) => {
    proxyWarn("upgrade-upstream-error", {
      error,
      host: url.hostname,
      port: connectPort,
    });
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
  });

  socket.on("error", () => {
    upstream.destroy();
  });
}

function buildHttp1ForwardHeaders(
  headers: IncomingHttpHeaders,
  host: string
): Record<string, string> {
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "proxy-authorization") continue;
    if (Array.isArray(value)) {
      requestHeaders[normalizedKey] = value.join(", ");
    } else {
      requestHeaders[normalizedKey] = value;
    }
  }
  requestHeaders.host = host;
  return requestHeaders;
}

function buildHttp2ForwardHeaders(
  headers: Http2IncomingHttpHeaders,
  host: string
): Record<string, string> {
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!value) continue;
    if (key.startsWith(":")) continue;
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "proxy-authorization") continue;
    if (Array.isArray(value)) {
      requestHeaders[normalizedKey] = value.join(", ");
    } else if (typeof value === "string") {
      requestHeaders[normalizedKey] = value;
    }
  }
  requestHeaders.host = host;
  return requestHeaders;
}

function sendUpstreamRequest(
  target: ProxyTarget,
  method: string,
  headers: Record<string, string>,
  body: NodeJS.ReadableStream | null,
  onResponse: (
    statusCode: number,
    statusMessage: string,
    headers: IncomingHttpHeaders,
    upstream: NodeJS.ReadableStream
  ) => void,
  onError: (error: Error) => void
): () => void {
  if (!target.secure) {
    return requestViaHttp1(target, method, headers, body, onResponse, onError);
  }
  try {
    return requestViaHttp2(target, method, headers, body, onResponse, onError);
  } catch (error) {
    proxyLogger?.warn("Falling back to HTTP/1 upstream", {
      error,
      host: target.url.hostname,
      port: target.connectPort,
    });
    return requestViaHttp1(
      target,
      method,
      headers,
      body,
      onResponse,
      onError
    );
  }
}

function requestViaHttp1(
  target: ProxyTarget,
  method: string,
  headers: Record<string, string>,
  body: NodeJS.ReadableStream | null,
  onResponse: (
    statusCode: number,
    statusMessage: string,
    headers: IncomingHttpHeaders,
    upstream: NodeJS.ReadableStream
  ) => void,
  onError: (error: Error) => void
): () => void {
  const httpModule = target.secure ? https : http;
  const agent = target.secure ? httpsKeepAliveAgent : httpKeepAliveAgent;
  const proxyReq = httpModule.request(
    {
      protocol: target.secure ? "https:" : "http:",
      hostname: target.url.hostname,
      port: target.connectPort,
      method,
      path: target.url.pathname + target.url.search,
      headers,
      agent,
    },
    (proxyRes) => {
      onResponse(
        proxyRes.statusCode ?? 500,
        proxyRes.statusMessage ?? "",
        proxyRes.headers,
        proxyRes
      );
    }
  );
  proxyReq.on("error", onError);
  if (body) {
    body.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    proxyReq.destroy();
  };
  proxyReq.on("close", () => {
    canceled = true;
  });
  return cancel;
}

function requestViaHttp2(
  target: ProxyTarget,
  method: string,
  headers: Record<string, string>,
  body: NodeJS.ReadableStream | null,
  onResponse: (
    statusCode: number,
    statusMessage: string,
    headers: IncomingHttpHeaders,
    upstream: NodeJS.ReadableStream
  ) => void,
  onError: (error: Error) => void
): () => void {
  const session = getOrCreateHttp2Session(target);
  const requestHeaders: Http2OutgoingHttpHeaders = {
    ":method": method,
    ":scheme": target.secure ? "https" : "http",
    ":path": (target.url.pathname + target.url.search) || "/",
    ":authority": target.url.host,
  };
  for (const [key, value] of Object.entries(headers)) {
    requestHeaders[key] = value;
  }
  let responded = false;
  let req: ClientHttp2Stream;
  try {
    req = session.request(requestHeaders);
  } catch (error) {
    session.close();
    throw error;
  }
  req.on("response", (responseHeaders) => {
    responded = true;
    const normalized = normalizeHttp2ResponseHeaders(responseHeaders);
    onResponse(
      Number(responseHeaders[":status"]) || 500,
      "",
      normalized,
      req
    );
  });
  req.on("error", (error) => {
    if (!responded) {
      onError(error);
    }
  });
  if (body) {
    body.pipe(req);
  } else {
    req.end();
  }
  let canceled = false;
  const cancel = () => {
    if (canceled) return;
    canceled = true;
    try {
      req.close();
    } catch {
      // ignore
    }
  };
  req.on("close", () => {
    canceled = true;
  });
  return cancel;
}

function normalizeHttp2ResponseHeaders(
  headers: Http2IncomingHttpHeaders
): IncomingHttpHeaders {
  const normalized: IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":")) continue;
    normalized[key] = value as string | string[] | undefined;
  }
  return normalized;
}

function getOrCreateHttp2Session(target: ProxyTarget): ClientHttp2Session {
  const key = `${target.url.hostname}:${target.connectPort}`;
  const existing = http2Sessions.get(key);
  if (existing && !existing.destroyed && !existing.closed) {
    return existing;
  }
  if (existing) {
    http2Sessions.delete(key);
    try {
      existing.close();
    } catch {
      // ignore
    }
  }
  const authority = `${target.secure ? "https" : "http"}://${
    target.url.hostname
  }:${target.connectPort}`;
  const session = http2.connect(authority, {
    servername: target.url.hostname,
  });
  const cleanup = () => {
    http2Sessions.delete(key);
  };
  session.setTimeout(60_000, () => {
    session.close();
  });
  session.on("close", cleanup);
  session.on("goaway", cleanup);
  session.on("error", (error) => {
    cleanup();
    proxyLogger?.warn("HTTP/2 upstream session error", {
      error,
      host: target.url.hostname,
      port: target.connectPort,
    });
  });
  http2Sessions.set(key, session);
  return session;
}

function getHeaderValue(
  headers: Http2IncomingHttpHeaders,
  key: string
): string | null {
  const value = headers[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0] ?? null;
  }
  return null;
}

function deriveRoute(url: string): ProxyRoute | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const morphMatch = hostname.match(
      /^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$/
    );
    if (morphMatch) {
      const morphId = morphMatch[2];
      if (morphId) {
        return {
          morphId,
          scope: "base",
          domainSuffix: "cmux.app",
        };
      }
    }
    for (const domain of CMUX_DOMAINS) {
      const suffix = `.${domain}`;
      if (!hostname.endsWith(suffix)) {
        continue;
      }
      const subdomain = hostname.slice(0, -suffix.length);
      if (!subdomain.startsWith("cmux-")) {
        continue;
      }
      const remainder = subdomain.slice("cmux-".length);
      const segments = remainder
        .split("-")
        .filter((segment) => segment.length > 0);
      if (segments.length < 3) {
        continue;
      }
      const portSegment = segments.pop();
      const scopeSegment = segments.pop();
      if (!portSegment || !scopeSegment) {
        continue;
      }
      if (!/^\d+$/.test(portSegment)) {
        continue;
      }
      const morphId = segments.join("-");
      if (!morphId) {
        continue;
      }
      return {
        morphId,
        scope: scopeSegment,
        domainSuffix: domain,
      };
    }
  } catch (error) {
    console.error("Failed to derive route", error);
    return null;
  }
  return null;
}
