import { verifyTaskRunToken, type TaskRunTokenPayload } from "@cmux/shared";
import { env } from "@/lib/utils/www-env";
import { NextRequest, NextResponse } from "next/server";
import { trackAnthropicProxyRequest } from "@/lib/analytics/track-anthropic-proxy";

const ANTHROPIC_API_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic/v1/messages";
const TEMPORARY_DISABLE_AUTH = true;

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

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

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let tokenPayload: TaskRunTokenPayload | null = null;

  // Try to extract token payload for tracking (even if auth is disabled)
  try {
    tokenPayload = await requireTaskRunToken(request);
  } catch {
    // Token extraction failed - will use defaults for tracking
  }

  if (!TEMPORARY_DISABLE_AUTH && !tokenPayload) {
    console.error("[anthropic proxy] Auth error: Missing or invalid token");
    void trackAnthropicProxyRequest({
      teamId: "unknown",
      userId: "unknown",
      taskRunId: "unknown",
      model: "unknown",
      stream: false,
      isOAuthToken: false,
      responseStatus: 401,
      latencyMs: Date.now() - startTime,
      errorType: "auth_error",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const beta = searchParams.get("beta");

    const xApiKeyHeader = request.headers.get("x-api-key");
    const authorizationHeader = request.headers.get("authorization");
    const isOAuthToken = getIsOAuthToken(
      xApiKeyHeader || authorizationHeader || ""
    );
    // Check if user provided their own API key (not the hardcoded placeholder)
    const hasUserProvidedApiKey =
      !isOAuthToken &&
      xApiKeyHeader !== null &&
      xApiKeyHeader !== hardCodedApiKey &&
      xApiKeyHeader.startsWith("sk-ant-");
    const body = await request.json();

    // Build headers
    // IMPORTANT: Always use user's API key if they provided one.
    // Never fall back to platform's ANTHROPIC_API_KEY for Claude Code tasks.
    let headers: Record<string, string>;
    if (hasUserProvidedApiKey) {
      // User provided their own API key - pass it through to Anthropic
      // This allows tracking while user pays for their own usage
      headers = {
        "Content-Type": "application/json",
        "x-api-key": xApiKeyHeader,
        "anthropic-version": "2023-06-01",
      };
    } else {
      // No user-provided API key - use platform's key (for non-Claude-Code requests)
      // Claude Code tasks should use Bedrock instead when no user key is provided
      headers = {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      };
    }

    // Add beta header if needed
    if (beta === "true") {
      headers["anthropic-beta"] = "messages-2023-12-15";
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    console.log(
      "[anthropic proxy] Anthropic response status:",
      response.status
    );

    // Handle streaming responses
    if (body.stream && response.ok) {
      // Track streaming request (token counts not available for streaming)
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        model: body.model ?? "unknown",
        stream: true,
        isOAuthToken,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
      });

      // Create a TransformStream to pass through the SSE data
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                break;
              }
              controller.enqueue(value);
            }
          } catch (error) {
            console.error("[anthropic proxy] Stream error:", error);
            controller.error(error);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Handle non-streaming responses
    const data = await response.json();

    if (!response.ok) {
      console.error("[anthropic proxy] Anthropic error:", data);
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        model: body.model ?? "unknown",
        stream: false,
        isOAuthToken,
        responseStatus: response.status,
        latencyMs: Date.now() - startTime,
        errorType: data?.error?.type ?? "anthropic_error",
      });
      return NextResponse.json(data, { status: response.status });
    }

    // Track successful non-streaming request with token usage
    void trackAnthropicProxyRequest({
      teamId: tokenPayload?.teamId ?? "unknown",
      userId: tokenPayload?.userId ?? "unknown",
      taskRunId: tokenPayload?.taskRunId ?? "unknown",
      model: data.model ?? body.model ?? "unknown",
      stream: false,
      isOAuthToken,
      responseStatus: response.status,
      latencyMs: Date.now() - startTime,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      cacheCreationInputTokens: data.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: data.usage?.cache_read_input_tokens,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[anthropic proxy] Error:", error);
    void trackAnthropicProxyRequest({
      teamId: tokenPayload?.teamId ?? "unknown",
      userId: tokenPayload?.userId ?? "unknown",
      taskRunId: tokenPayload?.taskRunId ?? "unknown",
      model: "unknown",
      stream: false,
      isOAuthToken: false,
      responseStatus: 500,
      latencyMs: Date.now() - startTime,
      errorType: "proxy_error",
    });
    return NextResponse.json(
      { error: "Failed to proxy request to Anthropic" },
      { status: 500 }
    );
  }
}
