import { Effect } from "effect";
import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { EnvService, HttpClientService, LiveServices } from "./effect/services";
import { httpError, jsonResponse, runHttpEffect } from "./effect/http";
import { withObservability } from "./effect/observability";

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

export const openaiProxyEffect = (req: Request) =>
  Effect.gen(function* () {
    const env = yield* EnvService;
    const httpClient = yield* HttpClientService;
    const workerAuth = yield* Effect.tryPromise({
      try: () =>
        getWorkerAuth(req, {
          loggerPrefix: "[openai-proxy]",
        }),
      catch: (error) =>
        error instanceof Error ? error : new Error("Failed to read worker auth"),
    });

    if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
      console.error("[openai-proxy] Auth error: Missing or invalid token");
      return yield* Effect.fail(httpError(401, { error: "Unauthorized" }));
    }

    const authHeader = req.headers.get("authorization");
    const providedKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;
    const useUserApiKey = hasUserApiKey(providedKey);

    const apiKey = useUserApiKey ? providedKey ?? null : env.OPENAI_API_KEY ?? null;

    if (!apiKey) {
      console.error("[openai-proxy] No OpenAI API key configured");
      return yield* Effect.fail(
        httpError(500, { error: "OpenAI API key not configured" })
      );
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/openai/, "");
    const queryString = url.search;
    const cloudflareUrl = `${CLOUDFLARE_OPENAI_BASE_URL}${path}${queryString}`;

    yield* Effect.annotateCurrentSpan({
      path,
      method: req.method,
      useUserApiKey,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const body = yield* Effect.tryPromise({
      try: () => req.text(),
      catch: (error) => {
        console.error("[openai-proxy] Failed to read request body:", error);
        return httpError(400, { error: "Invalid request body" });
      },
    });

    const response = yield* httpClient.fetch(cloudflareUrl, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    return yield* Effect.tryPromise({
      try: () => handleResponse(response, body.includes('"stream":true')),
      catch: (error) => {
        console.error("[openai-proxy] Error handling response:", error);
        return httpError(500, { error: "Failed to proxy request" });
      },
    });
  }).pipe(
    withObservability("openai.proxy", {
      endpoint: "openai.proxy",
      method: req.method,
    })
  );

/**
 * HTTP action to proxy OpenAI API requests.
 * Routes through Cloudflare AI Gateway for logging/caching.
 *
 * Uses platform OPENAI_API_KEY when user provides placeholder key.
 */
export const openaiProxy = httpAction(async (_ctx, req) => {
  return runHttpEffect(
    openaiProxyEffect(req).pipe(Effect.provide(LiveServices))
  );
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
