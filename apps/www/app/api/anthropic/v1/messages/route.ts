import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, streamText } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyTaskRunToken, type TaskRunTokenPayload } from "@cmux/shared";
import { env } from "@/lib/utils/www-env";
import { NextRequest, NextResponse } from "next/server";
import { trackAnthropicProxyRequest } from "@/lib/analytics/track-anthropic-proxy";

const ANTHROPIC_API_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-ai-proxy/anthropic/v1/messages";
const TEMPORARY_DISABLE_AUTH = true;

const hardCodedApiKey = "sk_placeholder_cmux_anthropic_api_key";

const contentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
});

const requestSchema = z.object({
  model: z.string(),
  messages: z.array(messageSchema),
  system: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
  max_tokens: z.number().int().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  top_k: z.number().int().optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
});

type AnthropicContentBlock = z.infer<typeof contentBlockSchema>;
type AnthropicRequest = z.infer<typeof requestSchema>;

type BedrockMessage = {
  role: "user" | "assistant";
  content: string;
};

async function requireTaskRunToken(
  request: NextRequest
): Promise<TaskRunTokenPayload> {
  const token = request.headers.get("x-cmux-token");
  if (!token) {
    throw new Error("Missing CMUX token");
  }

  return verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
}

function normalizeAuthToken(rawToken: string): string {
  const trimmed = rawToken.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice("bearer ".length).trim();
  }
  return trimmed;
}

function getIsOAuthToken(token: string): boolean {
  return token.includes("sk-ant-oat");
}

function hasUserAnthropicKey(token: string): boolean {
  return token.startsWith("sk-ant-") && token !== hardCodedApiKey;
}

function resolveBedrockModelId(model: string): string | null {
  const trimmed = model.trim();
  const aliases: Record<string, string> = {
    "claude-sonnet-4-5": env.ANTHROPIC_MODEL_SONNET_45,
    "claude-sonnet-4-5-20250929": env.ANTHROPIC_MODEL_SONNET_45,
    "claude-opus-4-5": env.ANTHROPIC_MODEL_OPUS_45,
    "claude-opus-4-5-20251101": env.ANTHROPIC_MODEL_OPUS_45,
    "claude-haiku-4-5": env.ANTHROPIC_MODEL_HAIKU_45,
    "claude-haiku-4-5-20251001": env.ANTHROPIC_MODEL_HAIKU_45,
  };

  if (Object.prototype.hasOwnProperty.call(aliases, trimmed)) {
    return aliases[trimmed];
  }

  if (
    trimmed === env.ANTHROPIC_MODEL_SONNET_45 ||
    trimmed === env.ANTHROPIC_MODEL_OPUS_45 ||
    trimmed === env.ANTHROPIC_MODEL_HAIKU_45
  ) {
    return trimmed;
  }

  return null;
}

function extractTextFromContent(
  content: string | AnthropicContentBlock[]
): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) =>
      block.type === "text" && typeof block.text === "string" ? block.text : ""
    )
    .join("");
}

function extractSystemText(
  system?: AnthropicRequest["system"]
): string | undefined {
  if (typeof system === "undefined") {
    return undefined;
  }

  const text = extractTextFromContent(system);
  return text.trim().length > 0 ? text : undefined;
}

function toBedrockMessages(
  messages: AnthropicRequest["messages"]
): BedrockMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: extractTextFromContent(message.content),
  }));
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "tool-calls":
      return "tool_use";
    case "stop":
      return "end_turn";
    case "content-filter":
      return "stop_sequence";
    default:
      return "end_turn";
  }
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
    const searchParams = request.nextUrl.searchParams;
    const beta = searchParams.get("beta");
    const xApiKeyHeader = request.headers.get("x-api-key");
    const authorizationHeader = request.headers.get("authorization");
    const rawToken = (xApiKeyHeader ?? authorizationHeader ?? "").trim();
    const normalizedToken = normalizeAuthToken(rawToken);
    const isOAuthToken = getIsOAuthToken(normalizedToken);
    const hasUserKey = hasUserAnthropicKey(normalizedToken);

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      console.error("[anthropic proxy] Invalid request body", parsed.error);
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    if (hasUserKey) {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      };

      if (xApiKeyHeader) {
        headers["x-api-key"] = xApiKeyHeader;
      }
      if (authorizationHeader) {
        headers.authorization = authorizationHeader;
      }
      if (beta === "true") {
        headers["anthropic-beta"] = "messages-2023-12-15";
      }

      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      console.log(
        "[anthropic proxy] Anthropic response status:",
        response.status
      );

      if (payload.stream && response.ok) {
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          model: payload.model ?? "unknown",
          stream: true,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
        });

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

      const data = await response.json();

      if (!response.ok) {
        console.error("[anthropic proxy] Anthropic error:", data);
        void trackAnthropicProxyRequest({
          teamId: tokenPayload?.teamId ?? "unknown",
          userId: tokenPayload?.userId ?? "unknown",
          taskRunId: tokenPayload?.taskRunId ?? "unknown",
          model: payload.model ?? "unknown",
          stream: false,
          isOAuthToken,
          responseStatus: response.status,
          latencyMs: Date.now() - startTime,
          errorType: data?.error?.type ?? "anthropic_error",
        });
        return NextResponse.json(data, { status: response.status });
      }

      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        model: data.model ?? payload.model ?? "unknown",
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
    }

    const bedrockModelId = resolveBedrockModelId(payload.model);
    if (!bedrockModelId) {
      return NextResponse.json(
        { error: `Unsupported model: ${payload.model}` },
        { status: 400 }
      );
    }

    const bedrock = createAmazonBedrock({
      region: env.AWS_REGION,
      apiKey: env.AWS_BEARER_TOKEN_BEDROCK,
    });
    const model = bedrock(bedrockModelId);
    const system = extractSystemText(payload.system);
    const messages = toBedrockMessages(payload.messages);

    if (payload.stream) {
      void trackAnthropicProxyRequest({
        teamId: tokenPayload?.teamId ?? "unknown",
        userId: tokenPayload?.userId ?? "unknown",
        taskRunId: tokenPayload?.taskRunId ?? "unknown",
        model: payload.model ?? "unknown",
        stream: true,
        isOAuthToken: false,
        responseStatus: 200,
        latencyMs: Date.now() - startTime,
      });

      const bedrockStream = streamText({
        model,
        system,
        messages,
        maxOutputTokens: payload.max_tokens,
        temperature: payload.temperature,
        topP: payload.top_p,
        topK: payload.top_k,
        stopSequences: payload.stop_sequences,
      });

      const encoder = new TextEncoder();
      const messageId = `msg_bedrock_${randomUUID()}`;
      const responseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const sendEvent = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };

          sendEvent("message_start", {
            type: "message_start",
            message: {
              id: messageId,
              type: "message",
              role: "assistant",
              model: payload.model,
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 0,
                output_tokens: 0,
              },
            },
          });

          sendEvent("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          });

          try {
            for await (const chunk of bedrockStream.textStream) {
              sendEvent("content_block_delta", {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: chunk },
              });
            }

            sendEvent("content_block_stop", {
              type: "content_block_stop",
              index: 0,
            });

            const usage = await bedrockStream.usage;
            const finishReason = await bedrockStream.finishReason;

            sendEvent("message_delta", {
              type: "message_delta",
              delta: {
                stop_reason: mapStopReason(finishReason),
                stop_sequence: null,
              },
              usage: {
                output_tokens: usage.outputTokens ?? 0,
              },
            });

            sendEvent("message_stop", { type: "message_stop" });
            controller.close();
          } catch (error) {
            console.error("[anthropic proxy] Bedrock stream error:", error);
            controller.error(error);
          }
        },
      });

      return new Response(responseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const bedrockResult = await generateText({
      model,
      system,
      messages,
      maxOutputTokens: payload.max_tokens,
      temperature: payload.temperature,
      topP: payload.top_p,
      topK: payload.top_k,
      stopSequences: payload.stop_sequences,
    });

    const bedrockResponse = {
      id: `msg_bedrock_${randomUUID()}`,
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: bedrockResult.text }],
      model: payload.model,
      stop_reason: mapStopReason(bedrockResult.finishReason),
      stop_sequence: null,
      usage: {
        input_tokens: bedrockResult.usage.inputTokens ?? 0,
        output_tokens: bedrockResult.usage.outputTokens ?? 0,
      },
    };

    void trackAnthropicProxyRequest({
      teamId: tokenPayload?.teamId ?? "unknown",
      userId: tokenPayload?.userId ?? "unknown",
      taskRunId: tokenPayload?.taskRunId ?? "unknown",
      model: payload.model ?? "unknown",
      stream: false,
      isOAuthToken: false,
      responseStatus: 200,
      latencyMs: Date.now() - startTime,
      inputTokens: bedrockResult.usage.inputTokens,
      outputTokens: bedrockResult.usage.outputTokens,
    });

    return NextResponse.json(bedrockResponse);
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
