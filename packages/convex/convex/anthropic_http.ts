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
    const httpClient = yield* HttpClientService;
    const env = yield* EnvService;
    const workerAuth = yield* Effect.tryPromise({
      try: () =>
        getWorkerAuth(req, {
          loggerPrefix: "[anthropic-proxy]",
        }),
      catch: (error) =>
        error instanceof Error ? error : new Error("Failed to read worker auth"),
    });

    if (!TEMPORARY_DISABLE_AUTH && !workerAuth) {
      console.error("[anthropic-proxy] Auth error: Missing or invalid token");
      return yield* Effect.fail(httpError(401, { error: "Unauthorized" }));
    }

    const body = yield* Effect.tryPromise({
      try: () => req.json(),
      catch: (error) => {
        console.error("[anthropic-proxy] Invalid JSON body:", error);
        return httpError(400, { error: "Invalid JSON body" });
      },
    });

    const xApiKey = req.headers.get("x-api-key");
    const useUserApiKey = hasUserApiKey(xApiKey);
    const requestedModel =
      isRecord(body) && typeof body.model === "string" ? body.model : "unknown";
    const payloadSummary = summarizeAnthropicPayload(body);

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

      return yield* Effect.tryPromise({
        try: () => handleResponse(response, Boolean(payloadSummary.stream)),
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
      return yield* Effect.fail(
        httpError(503, { error: "Bedrock proxy not configured" })
      );
    }

    const bedrockModelId = toBedrockModelId(requestedModel);
    const streamSuffix = payloadSummary.stream ? "-with-response-stream" : "";
    const bedrockUrl = `${BEDROCK_BASE_URL}/model/${bedrockModelId}/invoke${streamSuffix}`;

    yield* Effect.succeed(undefined).pipe(
      Effect.annotateLogs({
        bedrockModelId,
        stream: payloadSummary.stream ? "true" : "false",
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

    return yield* Effect.tryPromise({
      try: () => handleResponse(response, Boolean(payloadSummary.stream), true),
      catch: (error) => {
        console.error("[anthropic-proxy] Error handling response:", error);
        return httpError(500, { error: "Failed to proxy request" });
      },
    });
  }).pipe(
    withObservability("anthropic.proxy", {
      endpoint: "anthropic.proxy",
      method: req.method,
    })
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
