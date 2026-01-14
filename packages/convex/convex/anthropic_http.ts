import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { env } from "../_shared/convex-env";
import {
  BEDROCK_BASE_URL,
  toBedrockModelId,
  convertBedrockStreamToSSE,
} from "./bedrock_utils";

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

export const CLOUDFLARE_ANTHROPIC_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Check if the key is a valid Anthropic API key format.
 * Anthropic keys start with "sk-ant-" (regular) or "sk-ant-oat" (OAuth).
 */
function isAnthropicApiKey(key: string | null): boolean {
  return key !== null && key.startsWith("sk-ant-");
}

/**
 * Check if user provided their own valid Anthropic API key (not the placeholder).
 */
function hasUserApiKey(key: string | null): boolean {
  return key !== null && key !== hardCodedApiKey && isAnthropicApiKey(key);
}

const TEMPORARY_DISABLE_AUTH = true;

/**
 * HTTP action to proxy Anthropic API requests.
 * Routes to:
 * 1. Anthropic direct (via Cloudflare) - when user provides their own API key
 * 2. AWS Bedrock (direct) - when using platform credits (placeholder key)
 */
export const anthropicProxy = httpAction(async (_ctx, req) => {
  // Try to extract token payload for tracking
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[anthropic-proxy]",
  });

  if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
    console.error("[anthropic-proxy] Auth error: Missing or invalid token");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const xApiKey = req.headers.get("x-api-key");
    const useUserApiKey = hasUserApiKey(xApiKey);
    const body = await req.json();
    const requestedModel = body.model;

    if (useUserApiKey) {
      // User provided their own Anthropic API key - proxy directly to Anthropic
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        // Skip hop-by-hop headers and internal headers
        if (
          !["host", "x-cmux-token", "content-length"].includes(key.toLowerCase())
        ) {
          headers[key] = value;
        }
      });

      const response = await fetch(
        `${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }
      );

      // Return response directly to user (including any errors)
      return handleResponse(response, body.stream);
    }

    // AWS Bedrock path: using platform credits (placeholder key)
    {
      const bedrockToken = env.AWS_BEARER_TOKEN_BEDROCK;
      if (!bedrockToken) {
        console.error(
          "[anthropic-proxy] AWS_BEARER_TOKEN_BEDROCK environment variable is not set"
        );
        return jsonResponse(
          { error: "Bedrock proxy not configured" },
          503
        );
      }

      const bedrockModelId = toBedrockModelId(requestedModel);
      const streamSuffix = body.stream ? "-with-response-stream" : "";
      const bedrockUrl = `${BEDROCK_BASE_URL}/model/${bedrockModelId}/invoke${streamSuffix}`;

      // Build the Bedrock request body
      // Bedrock uses the same format as Anthropic API but with anthropic_version
      // Remove model (it's in URL) and stream (determined by endpoint suffix)
      const { model: _model, stream: _stream, ...bodyWithoutModelAndStream } = body;
      const bedrockBody = {
        ...bodyWithoutModelAndStream,
        anthropic_version: "bedrock-2023-05-31",
      };

      const response = await fetch(bedrockUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bedrockToken}`,
        },
        body: JSON.stringify(bedrockBody),
      });

      // Pass isBedrock=true to convert streaming format
      return handleResponse(response, body.stream, true);
    }
  } catch (error) {
    console.error("[anthropic-proxy] Error:", error);
    return jsonResponse({ error: "Failed to proxy request" }, 500);
  }
});

/**
 * Handle API response for both streaming and non-streaming.
 * For Bedrock streaming, converts AWS event stream format to Anthropic SSE format.
 */
async function handleResponse(
  response: Response,
  isStreaming: boolean,
  isBedrock = false
): Promise<Response> {
  if (isStreaming && response.ok) {
    const stream = response.body;
    if (!stream) {
      return jsonResponse({ error: "No response body" }, 500);
    }

    // Bedrock uses AWS event stream binary format, need to convert to SSE
    if (isBedrock) {
      const transformedStream = convertBedrockStreamToSSE(stream);
      return new Response(transformedStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-Bedrock (Anthropic direct) - pass through as-is
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const data = await response.json();

  if (!response.ok) {
    console.error("[anthropic-proxy] API error:", data);
    return jsonResponse(data, response.status);
  }

  return jsonResponse(data);
}

/**
 * Proxy count_tokens to Anthropic directly.
 * Note: This endpoint requires ANTHROPIC_API_KEY to be configured.
 * Bedrock doesn't have an equivalent count_tokens endpoint.
 */
export const anthropicCountTokens = httpAction(async (_ctx, req) => {
  const anthropicApiKey = env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    // Bedrock doesn't have count_tokens API - return unavailable
    return jsonResponse(
      {
        error: "Token counting is not available in Bedrock-only mode. Configure ANTHROPIC_API_KEY to enable this feature.",
        type: "service_unavailable",
      },
      503
    );
  }

  try {
    const body = await req.json();
    const response = await fetch(
      `${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages/count_tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      }
    );
    const data = await response.json();
    return jsonResponse(data, response.status);
  } catch (error) {
    console.error("[anthropic-proxy] count_tokens error:", error);
    return jsonResponse(
      { error: "Failed to count tokens", type: "internal_error" },
      500
    );
  }
});

/**
 * Stub handler for event logging - just accept and ignore.
 */
export const anthropicEventLogging = httpAction(async () => {
  return jsonResponse({ success: true });
});
