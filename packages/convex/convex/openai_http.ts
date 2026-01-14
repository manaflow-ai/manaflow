import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { env } from "../_shared/convex-env";

/**
 * Cloudflare AI Gateway configuration.
 */
const CLOUDFLARE_ACCOUNT_ID = "0c1675e0def6de1ab3a50a4e17dc5656";
const CLOUDFLARE_GATEWAY_ID = "cmux-ai-proxy";

const hardCodedApiKey = "sk-openai-proxy-placeholder";

/**
 * Cloudflare AI Gateway base URL for OpenAI.
 */
export const CLOUDFLARE_OPENAI_BASE_URL =
  `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/openai`;


const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Check if the key is a valid OpenAI API key format.
 * OpenAI keys start with "sk-" but not "sk-ant-" (which is Anthropic).
 */
function isOpenAIApiKey(key: string | null): boolean {
  return key !== null && key.startsWith("sk-") && !key.startsWith("sk-ant-");
}

/**
 * Check if user provided their own valid OpenAI API key (not the placeholder).
 */
function hasUserApiKey(key: string | null): boolean {
  return key !== null && key !== hardCodedApiKey && isOpenAIApiKey(key);
}

const TEMPORARY_DISABLE_AUTH = true;

/**
 * HTTP action to proxy OpenAI API requests.
 * Routes through Cloudflare AI Gateway for logging/caching.
 *
 * Uses platform OPENAI_API_KEY when user provides placeholder key.
 */
export const openaiProxy = httpAction(async (_ctx, req) => {
  // Try to extract token payload for tracking
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[openai-proxy]",
  });

  if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
    console.error("[openai-proxy] Auth error: Missing or invalid token");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const authHeader = req.headers.get("authorization");
    const providedKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const useUserApiKey = hasUserApiKey(providedKey);

    // Determine which API key to use
    const apiKey = useUserApiKey
      ? providedKey!
      : env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[openai-proxy] No OpenAI API key configured");
      return jsonResponse({ error: "OpenAI API key not configured" }, 500);
    }

    // Get the path after /api/openai
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/openai/, "");
    const queryString = url.search;

    const cloudflareUrl = `${CLOUDFLARE_OPENAI_BASE_URL}${path}${queryString}`;

    console.log(`[openai-proxy] ${req.method} ${path}`);

    // Build headers for upstream request - minimal set only
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    // NOTE: Not forwarding other headers to avoid any interference

    const body = await req.text();

    const response = await fetch(cloudflareUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    return handleResponse(response, body.includes('"stream":true'));
  } catch (error) {
    console.error("[openai-proxy] Error:", error);
    return jsonResponse({ error: "Failed to proxy request" }, 500);
  }
});

/**
 * Handle API response for both streaming and non-streaming.
 */
async function handleResponse(
  response: Response,
  isStreaming: boolean
): Promise<Response> {
  if (isStreaming && response.ok) {
    const stream = response.body;
    if (!stream) {
      return jsonResponse({ error: "No response body" }, 500);
    }

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
    console.error("[openai-proxy] API error:", data);
    return jsonResponse(data, response.status);
  }

  return jsonResponse(data);
}
