/**
 * Preview proxy for Electron WebContents
 * High-performance Rust implementation with HTTP/2 support
 */

import type { WebContents } from "electron";
import type { Logger } from "./chrome-camouflage";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { existsSync } from "node:fs";
import {
  deriveProxyRoute,
  type ProxyRoute,
} from "./rust-preview-proxy-route";

// Determine the correct path to the native module
// Uses the same multi-path search strategy as apps/server/src/native/git.ts
function getNativeCorePath(): string {
  const dirCandidates = [
    // Environment variable override
    process.env.CMUX_NATIVE_CORE_DIR,
    
    // Production: extraResources/native/core
    process.resourcesPath
      ? path.join(process.resourcesPath, "native", "core")
      : undefined,
    
    // Development: various relative paths from different execution contexts
    path.resolve(__dirname, "../../../server/native/core"),
    path.resolve(__dirname, "../../../../apps/server/native/core"),
    path.resolve(__dirname, "../../../../../apps/server/native/core"),
    path.resolve(process.cwd(), "apps/server/native/core"),
    path.resolve(process.cwd(), "../server/native/core"),
    path.resolve(process.cwd(), "../../apps/server/native/core"),
    path.resolve(process.cwd(), "server/native/core"),
  ];

  for (const candidate of dirCandidates) {
    if (!candidate) continue;
    
    const indexPath = path.join(candidate, "index.js");
    if (existsSync(indexPath)) {
      console.log(`[cmux-rust-proxy] Found native module at: ${candidate}`);
      return candidate;
    }
  }

  // Module not found - provide detailed error
  console.error(`[cmux-rust-proxy] ERROR: Cannot find native module!`);
  console.error(`[cmux-rust-proxy] __dirname: ${__dirname}`);
  console.error(`[cmux-rust-proxy] process.cwd(): ${process.cwd()}`);
  console.error(`[cmux-rust-proxy] process.resourcesPath: ${process.resourcesPath}`);
  console.error(`[cmux-rust-proxy] Tried ${dirCandidates.length} paths`);

  throw new Error(`Cannot find @cmux/native-core module`);
}

// Load the native module with error handling
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
let ProxyServer: any;
try {
  const nativeCorePath = getNativeCorePath();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nativeModule = require(path.join(nativeCorePath, "index.js"));
  ProxyServer = nativeModule.ProxyServer;
  
  if (!ProxyServer) {
    throw new Error("ProxyServer not exported from native module");
  }
  
  console.log(`[cmux-rust-proxy] ✓ Native module loaded successfully`);
  console.log(`[cmux-rust-proxy] Available methods: ${Object.getOwnPropertyNames(ProxyServer).join(', ')}`);
} catch (error) {
  console.error(`[cmux-rust-proxy] FATAL: Failed to load native module!`);
  console.error(error);
  throw error;
}

const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const DEFAULT_PROXY_LOGGING_ENABLED = false;
interface ConfigureOptions {
  webContents: WebContents;
  initialUrl: string;
  persistKey?: string;
  logger: Logger;
}

interface ProxyContextInfo {
  id: string;
  username: string;
  password: string;
  webContentsId: number;
}

let proxyServer: {
  port(): number;
  createContext(webContentsId: number, route?: ProxyRoute): ProxyContextInfo;
  releaseContext(contextId: string): void;
  stop(): void;
} | null = null;
let proxyLogger: Logger | null = null;
let proxyLoggingEnabled = DEFAULT_PROXY_LOGGING_ENABLED;
let startingProxy: Promise<number> | null = null;

const contextsByWebContentsId = new Map<number, ProxyContextInfo>();

function proxyLog(event: string, data?: Record<string, unknown>): void {
  if (!proxyLoggingEnabled) {
    return;
  }
  try {
    proxyLogger?.log("Rust preview proxy", { event, ...(data ?? {}) });
  } catch (error) {
    console.error("Failed to log preview proxy", error);
  }
}

export function setPreviewProxyLoggingEnabled(enabled: boolean): void {
  proxyLoggingEnabled = Boolean(enabled);
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
  return {
    username: context.username,
    password: context.password,
  };
}

export function releasePreviewProxy(webContentsId: number): void {
  const context = contextsByWebContentsId.get(webContentsId);
  if (!context) return;

  contextsByWebContentsId.delete(webContentsId);

  if (proxyServer) {
    try {
      proxyServer.releaseContext(context.id);
      proxyLog("released-context", {
        webContentsId,
        contextId: context.id,
      });
    } catch (error) {
      console.error("Failed to release proxy context", error);
    }
  }
}

export async function configurePreviewProxyForView(
  options: ConfigureOptions
): Promise<() => void> {
  const { webContents, initialUrl, persistKey, logger } = options;
  const route = deriveProxyRoute(initialUrl, {
    morphDomainSuffix: null, // Route through global cmux proxy first
  });

  if (!route) {
    logger.warn("Preview proxy skipped; unable to parse cmux host", {
      url: initialUrl,
      persistKey,
    });
    return () => {};
  }
  logger.log("Preview proxy route resolved", {
    persistKey,
    initialUrl,
    route,
  });

  const port = await ensureProxyServer(logger);

  if (!proxyServer) {
    throw new Error("Proxy server failed to start");
  }

  const proxyRoute: ProxyRoute = {
    morphId: route.morphId,
    scope: route.scope,
    domainSuffix: route.domainSuffix,
    morphDomainSuffix: route.morphDomainSuffix,
  };

  const context = proxyServer.createContext(webContents.id, proxyRoute);
  contextsByWebContentsId.set(webContents.id, context);

  try {
    await webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: "<-loopback>",
    });
  } catch (error) {
    contextsByWebContentsId.delete(webContents.id);
    proxyServer.releaseContext(context.id);
    logger.warn("Failed to configure preview proxy", { error });
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;

    releasePreviewProxy(webContents.id);

    logger.log("Released proxy context", {
      webContentsId: webContents.id,
      persistKey,
    });
  };

  webContents.once("destroyed", cleanup);

  logger.log("Configured proxy context", {
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
  if (proxyServer) {
    return proxyServer.port();
  }
  if (startingProxy) {
    return startingProxy;
  }
  startingProxy = startProxyServer(logger);
  try {
    const port = await startingProxy;
    return port;
  } finally {
    startingProxy = null;
  }
}

async function startProxyServer(logger: Logger): Promise<number> {
  const startPort = 39385;
  const maxAttempts = 50;

  proxyLogger = logger;

  try {
    proxyServer = await ProxyServer.startWithAutoPort(
      "127.0.0.1",
      startPort,
      maxAttempts,
      true // Enable HTTP/2
    );

    if (!proxyServer) {
      throw new Error("Failed to start proxy server");
    }

    const port = proxyServer.port();
    console.log(`[cmux-rust-proxy] listening on port ${port} with HTTP/2`);
    logger.log("Rust preview proxy listening", { port, http2: true });
    proxyLog("listening", { port, http2: true });

    return port;
  } catch (error) {
    logger.error("Failed to start Rust preview proxy", { error });
    throw error;
  }
}
