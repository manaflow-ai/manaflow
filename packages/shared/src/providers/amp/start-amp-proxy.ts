import { createServer as createHttpServer } from "node:http";
import { readFile as fspReadFile } from "node:fs/promises";
import type { Id } from "@cmux/convex/dataModel";
import type { WorkerToServerEvents } from "../../worker-schemas";
import {
  DEFAULT_AMP_PROXY_PORT,
  DEFAULT_AMP_PROXY_URL,
} from "./constants";

export type AmpProxyOptions = {
  ampUrl?: string;
  ampUpstreamUrl?: string;
  port?: number;
  workerId?: string;
  emitToMainServer?: <K extends keyof WorkerToServerEvents>(
    event: K,
    ...args: Parameters<WorkerToServerEvents[K]>
  ) => void;
};

const parsePort = (value?: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
};

const portFromUrl = (value?: string | null): number | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const portString = url.port;
    if (!portString) return undefined;
    return parsePort(portString);
  } catch {
    return undefined;
  }
};

const normalizeUrlPort = (rawUrl: string, port: number): string => {
  try {
    const url = new URL(rawUrl);
    if (!url.port || parsePort(url.port) !== port) {
      url.port = String(port);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return `http://localhost:${port}`;
  }
};

const ensureNoTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

async function getRealAmpApiKey(): Promise<string | null> {
  try {
    const home = process.env.HOME || "/root";
    const secretsPath = `${home}/.local/share/amp/secrets.json`;
    const raw = await fspReadFile(secretsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const key = (parsed["apiKey@https://ampcode.com/"] ||
      parsed["apiKey@https://ampcode.com"] ||
      "") as string;
    return key || null;
  } catch {
    return null;
  }
}

function extractTaskRunId(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;

  const token = auth.replace(/^[Bb]earer\s+/, "");
  // First, support explicit prefixes like taskRunId:<id>
  const m = token.match(/(?:taskRunId|taskrun|task|tr)[:=]([a-zA-Z0-9_-]+)/);

  if (m?.[1]) return m[1];
  // Otherwise, if the token itself looks like a plausible ID, accept it
  if (/^[a-zA-Z0-9_-]{16,64}$/.test(token)) {
    return token;
  }

  return null;
}

function ampResponseIndicatesCompletion(json: unknown): boolean {
  // Type guards and helpers
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  const getAtPath = (obj: unknown, path: string[]): unknown => {
    let cur: unknown = obj;
    for (const key of path) {
      if (!isRecord(cur)) return undefined;
      cur = cur[key];
    }
    return cur;
  };

  // Accept a JSON string or object
  let root: unknown = json;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      return false;
    }
  }

  if (!isRecord(root)) return false;

  // Some callers may wrap body as { requestBody: <actual> }
  const body: unknown =
    "requestBody" in root
      ? (root as Record<string, unknown>)["requestBody"]
      : root;

  // Helper to safely extract messages array from common shapes
  const extractMessages = (obj: unknown): unknown[] | null => {
    for (const path of [
      ["params", "thread", "messages"],
      ["thread", "messages"],
      ["messages"],
    ]) {
      const val = getAtPath(obj, path);
      if (Array.isArray(val)) return val as unknown[];
    }
    return null;
  };

  const messages = extractMessages(body);

  if (messages && messages.length > 0) {
    // Scan from latest to earliest, ignoring items without state
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const item = messages[i];
      if (!isRecord(item)) continue;
      const state = item["state"];
      if (!isRecord(state)) continue;
      const type = state["type"];
      const stopReason = state["stopReason"];
      if (type === "complete" && stopReason === "end_turn") {
        return true;
      }
    }
  }

  return false;
}

export function startAmpProxy(options: AmpProxyOptions = {}) {
  const explicitPort =
    typeof options.port === "number" && Number.isFinite(options.port)
      ? options.port
      : undefined;

  const port =
    explicitPort ??
    portFromUrl(options.ampUrl) ??
    parsePort(process.env.AMP_PROXY_PORT) ??
    portFromUrl(process.env.AMP_URL) ??
    DEFAULT_AMP_PROXY_PORT;

  const ampUrl = normalizeUrlPort(
    options.ampUrl ?? process.env.AMP_URL ?? DEFAULT_AMP_PROXY_URL,
    port,
  );

  const upstreamHost = ensureNoTrailingSlash(
    options.ampUpstreamUrl ??
      process.env.AMP_UPSTREAM_URL ??
      "https://ampcode.com",
  );

  const emit = options.emitToMainServer || (() => {});
  const workerId = options.workerId;

  console.info(
    `[AMP proxy] Starting local proxy on ${ampUrl}, forwarding to ${upstreamHost}`,
  );

  (async () => {
    const ampProxy = createHttpServer(async (req, res) => {
      const start = Date.now();
      const targetUrl = `${upstreamHost}${req.url || "/"}`;

      const chunks: Buffer[] = [];
      req.on("data", (chunk) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      );

      req.on("end", async () => {
        const reqBuffer = Buffer.concat(chunks);
        const contentType = (req.headers["content-type"] || "") as string;

        // Clone headers for upstream, removing hop-by-hop headers
        const upstreamHeaders = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value == null) continue;
          if (key.toLowerCase() === "host") continue;
          if (key.toLowerCase() === "content-length") continue;
          if (Array.isArray(value)) {
            upstreamHeaders.set(key, value.join(", "));
          } else {
            upstreamHeaders.set(key, String(value));
          }
        }

        const taskRunId = extractTaskRunId(upstreamHeaders);

        // Replace Authorization with real AMP key
        const realKey = await getRealAmpApiKey();
        if (realKey) {
          upstreamHeaders.set("authorization", `Bearer ${realKey}`);
          upstreamHeaders.set("x-amp-api-key", realKey);
          upstreamHeaders.set("amp-api-key", realKey);
          upstreamHeaders.set("x-api-key", realKey);
        }

        let bodyForFetch = undefined;
        let loggedRequestBody: unknown = undefined;
        if (req.method && req.method !== "GET" && req.method !== "HEAD") {
          if (
            typeof contentType === "string" &&
            contentType.includes("application/json")
          ) {
            const text = reqBuffer.toString("utf8");
            bodyForFetch = text;
            try {
              loggedRequestBody = JSON.parse(text);
            } catch {
              loggedRequestBody = text;
            }
          } else {
            bodyForFetch = reqBuffer;
            loggedRequestBody =
              contentType && String(contentType).includes("multipart/form-data")
                ? "[multipart/form-data]"
                : reqBuffer.length > 0
                  ? reqBuffer.toString("utf8")
                  : "";
          }
        }

        let proxyResponse: Response;
        try {
          proxyResponse = await fetch(targetUrl, {
            method: req.method,
            headers: upstreamHeaders,
            body: bodyForFetch,
            redirect: "manual",
          });
        } catch (error) {
          res.statusCode = 502;
          res.statusMessage = "Bad Gateway";
          res.end("AMP proxy failed to reach upstream");
          console.error(
            `[AMP proxy] Upstream request failed`,
            error instanceof Error ? error : String(error),
          );
          return;
        }

        const responseHeaders = new Headers(proxyResponse.headers);
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        const completed = ampResponseIndicatesCompletion(loggedRequestBody);

        if (completed && taskRunId && workerId) {
          const elapsedMs = Date.now() - start;
          emit("worker:task-complete", {
            workerId,
            taskRunId: taskRunId as Id<"taskRuns">,
            agentModel: "amp",
            elapsedMs,
          });
        }

        res.statusCode = proxyResponse.status;
        res.statusMessage = proxyResponse.statusText;
        responseHeaders.forEach((v, k) => res.setHeader(k, v));

        const responseContentType =
          proxyResponse.headers.get("content-type") || "";

        let responseBodyForClient: string | Uint8Array | null = null;
        try {
          if (
            typeof responseContentType === "string" &&
            (responseContentType.includes("application/json") ||
              responseContentType.startsWith("text/"))
          ) {
            responseBodyForClient = await proxyResponse.text();
          } else {
            const ab = await proxyResponse.arrayBuffer();
            responseBodyForClient = new Uint8Array(ab);
          }
        } catch {
          responseBodyForClient = null;
        }

        if (typeof responseBodyForClient === "string") {
          res.end(responseBodyForClient);
        } else if (responseBodyForClient) {
          res.end(Buffer.from(responseBodyForClient));
        } else {
          res.end();
        }
      });
    });
    ampProxy.on("error", (error) => {
      console.error(
        `[AMP proxy] Failed to start on port ${port}`,
        error instanceof Error ? error : String(error),
      );
    });

    ampProxy.listen(port, () => {
      console.info(`[AMP proxy] Listening on port ${port}`);
    });
  })();

  return;
}
