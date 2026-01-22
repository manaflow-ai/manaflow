import { Effect } from "effect";
import { httpAction } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { EnvService, HttpClientService, LiveServices } from "./effect/services";
import { httpError, jsonResponse, runHttpEffect } from "./effect/http";
import { withObservability } from "./effect/observability";
import {
  BEDROCK_BASE_URL,
  toBedrockModelId,
  convertBedrockStreamToSSE,
} from "./bedrock_utils";
import { capturePosthogEvent, drainPosthogEvents } from "../_shared/posthog";

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

export const CLOUDFLARE_ANTHROPIC_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic";

type RoleCounts = Record<string, number>;
type BlockCounts = Record<string, number>;

type SystemSummary = {
  type: "string" | "array" | "none" | "unknown";
  textChars: number;
  blockCount: number;
  blockTypes: BlockCounts;
};

type MessageSummary = {
  count: number;
  roles: RoleCounts;
  contentBlocks: number;
  textChars: number;
  toolUseCount: number;
  toolResultCount: number;
  blockTypes: BlockCounts;
};

type ToolSummary = {
  count: number;
  namePreview: string[];
};

type AnthropicPayloadSummary = {
  model?: string;
  maxTokens?: number;
  stream?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  system: SystemSummary;
  messages: MessageSummary;
  tools: ToolSummary;
  toolChoiceType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function incrementCount(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function summarizeSystem(value: unknown): SystemSummary {
  const summary: SystemSummary = {
    type: "none",
    textChars: 0,
    blockCount: 0,
    blockTypes: {},
  };

  if (typeof value === "string") {
    summary.type = "string";
    summary.textChars = value.length;
    return summary;
  }

  if (Array.isArray(value)) {
    summary.type = "array";
    summary.blockCount = value.length;
    for (const block of value) {
      if (isRecord(block)) {
        const blockType =
          typeof block.type === "string" ? block.type : "unknown";
        incrementCount(summary.blockTypes, blockType);
        if (blockType === "text" && typeof block.text === "string") {
          summary.textChars += block.text.length;
        }
      } else {
        incrementCount(summary.blockTypes, "unknown");
      }
    }
    return summary;
  }

  if (value === undefined) {
    return summary;
  }

  summary.type = "unknown";
  return summary;
}

function summarizeMessages(value: unknown): MessageSummary {
  const summary: MessageSummary = {
    count: 0,
    roles: {},
    contentBlocks: 0,
    textChars: 0,
    toolUseCount: 0,
    toolResultCount: 0,
    blockTypes: {},
  };

  if (!Array.isArray(value)) {
    return summary;
  }

  summary.count = value.length;
  for (const message of value) {
    if (!isRecord(message)) {
      incrementCount(summary.roles, "unknown");
      continue;
    }

    const role = typeof message.role === "string" ? message.role : "unknown";
    incrementCount(summary.roles, role);

    const content = message.content;
    if (typeof content === "string") {
      summary.contentBlocks += 1;
      summary.textChars += content.length;
      incrementCount(summary.blockTypes, "text");
      continue;
    }

    if (Array.isArray(content)) {
      summary.contentBlocks += content.length;
      for (const block of content) {
        if (!isRecord(block)) {
          incrementCount(summary.blockTypes, "unknown");
          continue;
        }
        const blockType =
          typeof block.type === "string" ? block.type : "unknown";
        incrementCount(summary.blockTypes, blockType);

        if (blockType === "text" && typeof block.text === "string") {
          summary.textChars += block.text.length;
        } else if (blockType === "tool_use") {
          summary.toolUseCount += 1;
        } else if (blockType === "tool_result") {
          summary.toolResultCount += 1;
        }
      }
    }
  }

  return summary;
}

function summarizeTools(value: unknown): ToolSummary {
  if (!Array.isArray(value)) {
    return { count: 0, namePreview: [] };
  }

  const names: string[] = [];
  for (const tool of value) {
    if (isRecord(tool) && typeof tool.name === "string") {
      if (names.length < 3) {
        names.push(tool.name);
      }
    }
  }

  return {
    count: value.length,
    namePreview: names,
  };
}

function summarizeAnthropicPayload(body: unknown): AnthropicPayloadSummary {
  if (!isRecord(body)) {
    return {
      system: summarizeSystem(undefined),
      messages: summarizeMessages(undefined),
      tools: { count: 0, namePreview: [] },
    };
  }

  const summary: AnthropicPayloadSummary = {
    model: typeof body.model === "string" ? body.model : undefined,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    stream: typeof body.stream === "boolean" ? body.stream : undefined,
    temperature:
      typeof body.temperature === "number" ? body.temperature : undefined,
    topP: typeof body.top_p === "number" ? body.top_p : undefined,
    topK: typeof body.top_k === "number" ? body.top_k : undefined,
    system: summarizeSystem(body.system),
    messages: summarizeMessages(body.messages),
    tools: summarizeTools(body.tools),
    toolChoiceType: isRecord(body.tool_choice)
      ? typeof body.tool_choice.type === "string"
        ? body.tool_choice.type
        : "object"
      : typeof body.tool_choice === "string"
        ? body.tool_choice
        : undefined,
  };

  return summary;
}

// Source identifies which product/feature is making the API call
type AnthropicProxySource = "cmux" | "preview-new";

type AnthropicProxyEvent = {
  // Core identifiers
  teamId: string;
  userId: string;
  taskRunId: string;

  // Source/product identifier
  source: AnthropicProxySource;

  // Request metadata
  model: string;
  stream: boolean;
  isOAuthToken: boolean;

  // Response metadata
  responseStatus: number;
  latencyMs: number;

  // Token usage (only available for non-streaming responses)
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;

  // Error info (if applicable)
  errorType?: string;
};

// Map source to span name for PostHog AI analytics
function getSpanName(source: AnthropicProxySource): string {
  switch (source) {
    case "cmux":
      return "claude-code-cmux";
    case "preview-new":
      return "claude-code-preview-new";
  }
}

/**
 * Track Anthropic proxy request in PostHog.
 * Uses PostHog's $ai_generation event for LLM analytics.
 */
function trackAnthropicProxyRequest(event: AnthropicProxyEvent): void {
  capturePosthogEvent({
    distinctId: event.userId,
    event: "$ai_generation",
    properties: {
      // PostHog AI properties
      $ai_model: event.model,
      $ai_provider: "anthropic",
      $ai_input_tokens: event.inputTokens,
      $ai_output_tokens: event.outputTokens,
      $ai_latency: event.latencyMs / 1000, // PostHog expects seconds
      $ai_http_status: event.responseStatus,
      $ai_is_error: event.responseStatus >= 400,
      $ai_error: event.errorType,
      $ai_stream: event.stream,
      $ai_trace_id: event.taskRunId,
      $ai_span_name: getSpanName(event.source),
      $ai_cache_read_input_tokens: event.cacheReadInputTokens,
      $ai_cache_creation_input_tokens: event.cacheCreationInputTokens,

      // Custom cmux properties
      cmux_source: event.source,
      cmux_team_id: event.teamId,
      cmux_task_run_id: event.taskRunId,
      cmux_is_oauth_token: event.isOAuthToken,

      // Associate user properties with this distinctId
      $set: {
        team_id: event.teamId,
      },
    },
  });
}

function getSource(req: Request): AnthropicProxySource {
  const sourceHeader = req.headers.get("x-cmux-source");
  if (sourceHeader === "preview-new") {
    return "preview-new";
  }
  return "cmux";
}

function getIsOAuthToken(token: string | null): boolean {
  return token !== null && token.includes("sk-ant-oat");
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

export const anthropicProxyEffect = (req: Request) =>
  Effect.gen(function* () {
    const startTime = Date.now();
    const httpClient = yield* HttpClientService;
    const env = yield* EnvService;

    // Capture tracking context early
    const xApiKey = req.headers.get("x-api-key");
    const source = getSource(req);
    const isOAuthToken = getIsOAuthToken(xApiKey);

    const workerAuth = yield* Effect.tryPromise({
      try: () =>
        getWorkerAuth(req, {
          loggerPrefix: "[anthropic-proxy]",
        }),
      catch: (error) =>
        error instanceof Error ? error : new Error("Failed to read worker auth"),
    });

    // Helper to track events and drain
    const trackEvent = (
      model: string,
      stream: boolean,
      responseStatus: number,
      options?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
        errorType?: string;
      }
    ) =>
      Effect.tryPromise({
        try: async () => {
          trackAnthropicProxyRequest({
            teamId: workerAuth?.payload.teamId ?? "unknown",
            userId: workerAuth?.payload.userId ?? "unknown",
            taskRunId: workerAuth?.payload.taskRunId ?? "unknown",
            source,
            model,
            stream,
            isOAuthToken,
            responseStatus,
            latencyMs: Date.now() - startTime,
            ...options,
          });
          await drainPosthogEvents();
        },
        catch: (error) => {
          console.error("[anthropic-proxy] PostHog tracking error:", error);
          return error instanceof Error ? error : new Error("Tracking failed");
        },
      });

    if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
      console.error("[anthropic-proxy] Auth error: Missing or invalid token");
      yield* trackEvent("unknown", false, 401, { errorType: "unauthorized" });
      return yield* Effect.fail(httpError(401, { error: "Unauthorized" }));
    }

    const body = yield* Effect.tryPromise({
      try: () => req.json(),
      catch: (error) => {
        console.error("[anthropic-proxy] Invalid JSON body:", error);
        return httpError(400, { error: "Invalid JSON body" });
      },
    });

    const useUserApiKey = hasUserApiKey(xApiKey);
    const requestedModel =
      isRecord(body) && typeof body.model === "string" ? body.model : "unknown";
    const payloadSummary = summarizeAnthropicPayload(body);
    const isStreaming = Boolean(payloadSummary.stream);

    yield* Effect.annotateCurrentSpan({
      requestedModel,
      useUserApiKey,
    });

    if (useUserApiKey) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        if (
          !["host", "x-cmux-token", "content-length"].includes(key.toLowerCase())
        ) {
          headers[key] = value;
        }
      });

      const response = yield* httpClient.fetch(
        `${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }
      );

      // Track with token usage for non-streaming responses
      if (!isStreaming) {
        const responseData = yield* Effect.tryPromise({
          try: () => response.clone().json().catch(() => null),
          catch: () => null,
        });
        const data = responseData as Record<string, unknown> | null;
        const usage = data?.usage as Record<string, number> | undefined;
        const errorData = data?.error as Record<string, string> | undefined;
        yield* trackEvent(requestedModel, false, response.status, {
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
          cacheCreationInputTokens: usage?.cache_creation_input_tokens,
          cacheReadInputTokens: usage?.cache_read_input_tokens,
          errorType: response.ok ? undefined : errorData?.type,
        });
      } else {
        yield* trackEvent(requestedModel, true, response.status);
      }

      return yield* Effect.tryPromise({
        try: () => handleResponse(response, isStreaming),
        catch: (error) => {
          console.error("[anthropic-proxy] Error handling response:", error);
          return httpError(500, { error: "Failed to proxy request" });
        },
      });
    }

    const bedrockToken = env.AWS_BEARER_TOKEN_BEDROCK;
    if (!bedrockToken) {
      console.error(
        "[anthropic-proxy] AWS_BEARER_TOKEN_BEDROCK environment variable is not set"
      );
      yield* trackEvent(requestedModel, isStreaming, 503, {
        errorType: "bedrock_not_configured",
      });
      return yield* Effect.fail(
        httpError(503, { error: "Bedrock proxy not configured" })
      );
    }

    const bedrockModelId = toBedrockModelId(requestedModel);
    const streamSuffix = isStreaming ? "-with-response-stream" : "";
    const bedrockUrl = `${BEDROCK_BASE_URL}/model/${bedrockModelId}/invoke${streamSuffix}`;

    yield* Effect.succeed(undefined).pipe(
      Effect.annotateLogs({
        bedrockModelId,
        stream: isStreaming ? "true" : "false",
        messageCount: String(payloadSummary.messages.count),
        toolUseCount: String(payloadSummary.messages.toolUseCount),
        toolResultCount: String(payloadSummary.messages.toolResultCount),
        toolsCount: String(payloadSummary.tools.count),
      })
    );
    yield* Effect.logInfo("[anthropic-proxy] Bedrock request summary");

    const bodyRecord = isRecord(body) ? body : {};
    const { model: _model, stream: _stream, ...bodyWithoutModelAndStream } = bodyRecord;
    const bedrockBody = {
      ...bodyWithoutModelAndStream,
      anthropic_version: "bedrock-2023-05-31",
    };

    const response = yield* httpClient.fetch(bedrockUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bedrockToken}`,
      },
      body: JSON.stringify(bedrockBody),
    });

    // Track with token usage for non-streaming responses
    if (!isStreaming) {
      const responseData = yield* Effect.tryPromise({
        try: () => response.clone().json().catch(() => null),
        catch: () => null,
      });
      const data = responseData as Record<string, unknown> | null;
      const usage = data?.usage as Record<string, number> | undefined;
      const errorData = data?.error as Record<string, string> | undefined;
      yield* trackEvent(requestedModel, false, response.status, {
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        cacheCreationInputTokens: usage?.cache_creation_input_tokens,
        cacheReadInputTokens: usage?.cache_read_input_tokens,
        errorType: response.ok ? undefined : errorData?.type,
      });
    } else {
      yield* trackEvent(requestedModel, true, response.status);
    }

    return yield* Effect.tryPromise({
      try: () => handleResponse(response, isStreaming, true),
      catch: (error) => {
        console.error("[anthropic-proxy] Error handling response:", error);
        return httpError(500, { error: "Failed to proxy request" });
      },
    });
  }).pipe(
    withObservability("anthropic.proxy", {
      endpoint: "anthropic.proxy",
      method: req.method,
    }),
    // Safety net: ensure PostHog events are drained even on unexpected errors
    Effect.ensuring(
      Effect.promise(() => drainPosthogEvents().catch(() => {}))
    )
  );

/**
 * HTTP action to proxy Anthropic API requests.
 * Routes to:
 * 1. Anthropic direct (via Cloudflare) - when user provides their own API key
 * 2. AWS Bedrock (direct) - when using platform credits (placeholder key)
 */
export const anthropicProxy = httpAction(async (_ctx, req) => {
  return runHttpEffect(
    anthropicProxyEffect(req).pipe(Effect.provide(LiveServices))
  );
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
export const anthropicCountTokensEffect = (req: Request) =>
  Effect.gen(function* () {
    const env = yield* EnvService;
    const httpClient = yield* HttpClientService;
    const anthropicApiKey = env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return yield* Effect.fail(
        httpError(503, {
          error:
            "Token counting is not available in Bedrock-only mode. Configure ANTHROPIC_API_KEY to enable this feature.",
          type: "service_unavailable",
        })
      );
    }

    const body = yield* Effect.tryPromise({
      try: () => req.json(),
      catch: (error) => {
        console.error("[anthropic-proxy] count_tokens invalid JSON:", error);
        return httpError(400, { error: "Invalid JSON body" });
      },
    });

    const response = yield* httpClient.fetch(
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

    return yield* Effect.tryPromise({
      try: async () => {
        const data = await response.json();
        return jsonResponse(data, response.status);
      },
      catch: (error) => {
        console.error("[anthropic-proxy] count_tokens error:", error);
        return httpError(500, {
          error: "Failed to count tokens",
          type: "internal_error",
        });
      },
    });
  }).pipe(
    withObservability("anthropic.count_tokens", {
      endpoint: "anthropic.count_tokens",
      method: req.method,
    })
  );

/**
 * Proxy count_tokens to Anthropic directly.
 * Note: This endpoint requires ANTHROPIC_API_KEY to be configured.
 * Bedrock doesn't have an equivalent count_tokens endpoint.
 */
export const anthropicCountTokens = httpAction(async (_ctx, req) => {
  return runHttpEffect(
    anthropicCountTokensEffect(req).pipe(Effect.provide(LiveServices))
  );
});

/**
 * Stub handler for event logging - just accept and ignore.
 */
export const anthropicEventLoggingEffect = Effect.succeed(
  jsonResponse({ success: true })
).pipe(
  withObservability("anthropic.event_logging", {
    endpoint: "anthropic.event_logging",
  })
);

/**
 * Stub handler for event logging - just accept and ignore.
 */
export const anthropicEventLogging = httpAction(async () => {
  return runHttpEffect(
    anthropicEventLoggingEffect.pipe(Effect.provide(LiveServices))
  );
});
