import { verifyTaskRunToken, type TaskRunTokenPayload } from "@cmux/shared";
import { CMUX_ANTHROPIC_PROXY_PLACEHOLDER_API_KEY } from "@cmux/shared/utils/anthropic";
import { env } from "@/lib/utils/www-env";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  trackAnthropicProxyRequest,
  type AnthropicProxySource,
} from "@/lib/analytics/track-anthropic-proxy";

const CLOUDFLARE_ANTHROPIC_API_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic/v1/messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTimeoutMsFromEnv(envVar: string, defaultMs: number): number {
  const raw = process.env[envVar];
  if (!raw) {
    return defaultMs;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultMs;
  }
  return parsed;
}

function formatAbortReason(signal: AbortSignal): string | null {
  if (!signal.aborted) {
    return null;
  }
  const reason = signal.reason;
  if (typeof reason === "string") {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason === null || typeof reason === "undefined") {
    return null;
  }
  try {
    return JSON.stringify(reason);
  } catch (error) {
    console.error("[anthropic proxy] Failed to stringify abort reason", error);
    return "unstringifiable abort reason";
  }
}

/**
 * Strip unsupported fields from cache_control objects in the request body.
 * Some clients (e.g. Claude Code) send cache_control with a "scope" field
 * that the Anthropic API rejects. The API only accepts { "type": "ephemeral" }.
 */
function sanitizeCacheControl(body: Record<string, unknown>): void {
  function walk(node: unknown): void {
    if (!isRecord(node)) return;

    if (isRecord(node.cache_control)) {
      delete (node.cache_control as Record<string, unknown>).scope;
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
      }
    }
  }

  walk(body);
}

// Toggle between Cloudflare AI Gateway and Convex Anthropic Bedrock endpoint
// Set to true to use Cloudflare AI Gateway, false to use Convex Anthropic Bedrock
const USE_CLOUDFLARE_AI_GATEWAY = false;

const TEMPORARY_DISABLE_AUTH = true;

const hardCodedApiKey = CMUX_ANTHROPIC_PROXY_PLACEHOLDER_API_KEY;

function getAnthropicApiUrl(): string {
  if (USE_CLOUDFLARE_AI_GATEWAY) {
    return CLOUDFLARE_ANTHROPIC_API_URL;
  }
  // Use Convex Anthropic Bedrock endpoint
  // HTTP routes are served from .convex.site, not .convex.cloud
  const rawConvexUrl = env.NEXT_PUBLIC_CONVEX_URL;
  const convexSiteUrl = rawConvexUrl.includes(".convex.cloud")
    ? rawConvexUrl.replace(".convex.cloud", ".convex.site")
    : rawConvexUrl;
  return `${convexSiteUrl}/api/anthropic/v1/messages`;
}

async function requireTaskRunToken(
  request: NextRequest
): Promise<TaskRunTokenPayload> {
  const token = request.headers.get("x-cmux-token");
  if (!token) {
    throw new Error("Missing CMUX token");
  }

  return verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
}

function getIsOAuthToken(token: string) {
  return token.includes("sk-ant-oat");
}

function getSource(request: NextRequest): AnthropicProxySource {
  const sourceHeader = request.headers.get("x-cmux-source");
  if (sourceHeader === "preview-new") {
    return "preview-new";
  }
  return "cmux";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const vercelId = request.headers.get("x-vercel-id");
  const startTime = Date.now();
  const source = getSource(request);

  const hardTimeoutMs = parseTimeoutMsFromEnv(
    "CMUX_ANTHROPIC_PROXY_HARD_TIMEOUT_MS",
    60_000,
  );
  const upstreamAbortController = new AbortController();
  const upstreamSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(hardTimeoutMs),
    upstreamAbortController.signal,
  ]);

  let clientAbortAtMs: number | null = null;
  const onRequestAbort = () => {
    clientAbortAtMs = Date.now() - startTime;
    upstreamAbortController.abort(new Error("Client disconnected"));
  };
  if (request.signal.aborted) {
    clientAbortAtMs = 0;
    upstreamAbortController.abort(new Error("Client disconnected"));
  } else {
    request.signal.addEventListener("abort", onRequestAbort, { once: true });
  }

  let tokenPayload: TaskRunTokenPayload | null = null;
  let responseStatus: number | null = null;
  let model: string = "unknown";
  let streamRequested = false;
  let isOAuthToken = false;
  let didReturnStreaming = false;
  let finalMetricsLogged = false;

  const logFinalMetrics = (
    phase: "end" | "error",
    extra?: Record<string, unknown>,
  ) => {
    if (finalMetricsLogged) {
      return;
    }
    finalMetricsLogged = true;
    const durationMs = Date.now() - startTime;
    console.info("[anthropic proxy][metrics]", {
      requestId,
      vercelId,
      phase,
      durationMs,
      clientAbortAtMs,
      requestAborted: request.signal.aborted,
      hardTimeoutMs,
      hardTimeoutTriggered:
        upstreamSignal.aborted &&
        !request.signal.aborted &&
        !upstreamAbortController.signal.aborted,
      abortReason: formatAbortReason(upstreamSignal),
      upstream: USE_CLOUDFLARE_AI_GATEWAY ? "cloudflare" : "convex",
      source,
      model,
      streamRequested,
      isOAuthToken,
      responseStatus,
      ...extra,
    });
  };

  // Try to extract token payload for tracking (even if auth is disabled)
  try {
    tokenPayload = await requireTaskRunToken(request);
  } catch {
    // Token extraction failed - will use defaults for tracking
  }

  if (!TEMPORARY_DISABLE_AUTH && !tokenPayload) {
    responseStatus = 401;
    console.error("[anthropic proxy] Auth error: Missing or invalid token");
    logFinalMetrics("error", { errorType: "auth_error" });
    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      void trackAnthropicProxyRequest({
        teamId: "unknown",
        userId: "unknown",
        taskRunId: "unknown",
        source,
        model: "unknown",
        stream: false,
        isOAuthToken: false,
        responseStatus: 401,
        latencyMs: Date.now() - startTime,
        errorType: "auth_error",
      });
    }
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "x-cmux-request-id": requestId } },
    );
  }

  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const beta = searchParams.get("beta");

    const xApiKeyHeader = request.headers.get("x-api-key");
    const authorizationHeader = request.headers.get("authorization");
    isOAuthToken = getIsOAuthToken(
      xApiKeyHeader || authorizationHeader || ""
    );
    const useOriginalApiKey =
      !isOAuthToken &&
      xApiKeyHeader !== hardCodedApiKey &&
      authorizationHeader !== hardCodedApiKey;
    const parsedBody: unknown = await request.json();
    if (!isRecord(parsedBody)) {
      responseStatus = 400;
      logFinalMetrics("error", { errorType: "invalid_body" });
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400, headers: { "x-cmux-request-id": requestId } },
      );
    }
    const body = parsedBody;
    streamRequested = body.stream === true;
    if (typeof body.model === "string") {
      model = body.model;
    }
    sanitizeCacheControl(body);

    // Build headers
    // When using Convex endpoint with platform credits, send the placeholder key
    // so Convex routes to Bedrock instead of Cloudflare/Anthropic
    const apiKeyForRequest = USE_CLOUDFLARE_AI_GATEWAY
      ? env.ANTHROPIC_API_KEY
      : hardCodedApiKey;

    const headers: Record<string, string> =
      useOriginalApiKey && !TEMPORARY_DISABLE_AUTH
        ? (() => {
            const filtered = new Headers(request.headers);
            return Object.fromEntries(filtered);
          })()
        : {
            "Content-Type": "application/json",
            "x-api-key": apiKeyForRequest,
            "anthropic-version": "2023-06-01",
          };

    // Forward cmux headers to Convex so it can extract auth for tracking
    if (!USE_CLOUDFLARE_AI_GATEWAY) {
      const cmuxToken = request.headers.get("x-cmux-token");
      const cmuxSource = request.headers.get("x-cmux-source");
      if (cmuxToken) {
        headers["x-cmux-token"] = cmuxToken;
      }
      if (cmuxSource) {
        headers["x-cmux-source"] = cmuxSource;
      }
    }

    // Add beta header if beta param is present
    if (!useOriginalApiKey) {
      if (beta === "true") {
        headers["anthropic-beta"] = "messages-2023-12-15";
      }
    }

    const response = await fetch(getAnthropicApiUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // Abort upstream work when the client disconnects.
      signal: upstreamSignal,
    });
    responseStatus = response.status;

    console.log(
      "[anthropic proxy] Anthropic response status:",
      response.status
    );

    // Handle streaming responses
    if (streamRequested && response.ok) {
      // Only track in www when using Cloudflare directly (not forwarding to Convex)
      // Convex proxy handles tracking for the Convex path to avoid double counting
      if (USE_CLOUDFLARE_AI_GATEWAY) {
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          source,
          model,
          stream: true,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
        });
      }

      didReturnStreaming = true;
      let bytesForwarded = 0;
      let streamFinalLogged = false;
      const logStreamFinal = (phase: "end" | "cancel" | "error") => {
        if (streamFinalLogged) {
          return;
        }
        streamFinalLogged = true;
        const durationMs = Date.now() - startTime;
        console.info("[anthropic proxy][metrics]", {
          requestId,
          vercelId,
          phase,
          durationMs,
          clientAbortAtMs,
          requestAborted: request.signal.aborted,
          hardTimeoutMs,
          hardTimeoutTriggered:
            upstreamSignal.aborted &&
            !request.signal.aborted &&
            !upstreamAbortController.signal.aborted,
          abortReason: formatAbortReason(upstreamSignal),
          upstream: USE_CLOUDFLARE_AI_GATEWAY ? "cloudflare" : "convex",
          source,
          model,
          streamRequested,
          isOAuthToken,
          responseStatus,
          bytesForwarded,
        });
      };

      const upstreamBody = response.body;
      if (!upstreamBody) {
        logStreamFinal("error");
        return NextResponse.json(
          { error: "Upstream response body missing" },
          { status: 502, headers: { "x-cmux-request-id": requestId } },
        );
      }

      const reader = upstreamBody.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              logStreamFinal("end");
              return;
            }
            if (value) {
              bytesForwarded += value.byteLength;
              controller.enqueue(value);
            }
          } catch (error) {
            console.error("[anthropic proxy] Stream forwarding error:", error);
            controller.error(error);
            logStreamFinal("error");
          }
        },
        cancel(reason) {
          upstreamAbortController.abort(new Error("Downstream canceled"));
          try {
            void reader.cancel(reason);
          } catch (error) {
            console.error("[anthropic proxy] Failed to cancel upstream reader", {
              error,
            });
          } finally {
            logStreamFinal("cancel");
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-cmux-request-id": requestId,
        },
      });
    }

    // Handle non-streaming responses
    const data = await response.json();

    if (!response.ok) {
      console.error("[anthropic proxy] Anthropic error:", data);
      logFinalMetrics("error", { errorType: "upstream_error" });
      // Only track in www when using Cloudflare directly (not forwarding to Convex)
      // Convex proxy handles tracking for the Convex path to avoid double counting
      if (USE_CLOUDFLARE_AI_GATEWAY) {
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          source,
          model,
          stream: false,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
          errorType: data?.error?.type ?? "anthropic_error",
        });
      }
      return NextResponse.json(data, {
        status: response.status,
        headers: { "x-cmux-request-id": requestId },
      });
    }

    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      const responseModel =
        typeof data?.model === "string" ? data.model : model;
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        source,
        model: responseModel,
        stream: false,
        isOAuthToken,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
        cacheCreationInputTokens: data.usage?.cache_creation_input_tokens,
        cacheReadInputTokens: data.usage?.cache_read_input_tokens,
      });
    }

    logFinalMetrics("end");
    return NextResponse.json(data, {
      headers: { "x-cmux-request-id": requestId },
    });
  } catch (error) {
    console.error("[anthropic proxy] Error:", error);
    // Only track in www when using Cloudflare directly (not forwarding to Convex)
    // Convex proxy handles tracking for the Convex path to avoid double counting
    if (USE_CLOUDFLARE_AI_GATEWAY) {
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        source,
        model: "unknown",
        stream: false,
        isOAuthToken: false,
        responseStatus: 500,
        latencyMs: Date.now() - startTime,
        errorType: "proxy_error",
      });
    }
    responseStatus ??= 500;
    logFinalMetrics("error", { errorType: "proxy_error" });
    return NextResponse.json(
      { error: "Failed to proxy request to Anthropic" },
      { status: 500, headers: { "x-cmux-request-id": requestId } }
    );
  } finally {
    request.signal.removeEventListener("abort", onRequestAbort);
    if (!didReturnStreaming) {
      logFinalMetrics("end");
    }
  }
}
