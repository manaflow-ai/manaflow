import { Effect } from "effect";
import { jwtVerify } from "jose";
import { z } from "zod";
import { EnvService, LiveServices } from "./effect/services";
import {
  httpError,
  jsonResponse,
  parseJsonBody,
  requireJsonContentType,
  runHttpEffect,
} from "./effect/http";
import { withObservability } from "./effect/observability";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) {
    return null;
  }
  const trimmed = header.trim();
  const lower = trimmed.toLowerCase();
  const prefix = "bearer ";
  if (!lower.startsWith(prefix)) {
    return null;
  }
  const token = trimmed.slice(prefix.length).trim();
  if (token.length === 0) {
    return null;
  }
  return token;
}

const makeIdSchema = <TableName extends TableNames>() =>
  z.string().min(1).transform((value) => value as Id<TableName>);

const conversationIdSchema = makeIdSchema<"conversations">();
const messageIdSchema = makeIdSchema<"conversationMessages">();
const sandboxIdSchema = makeIdSchema<"acpSandboxes">();

// Content block schema
const contentBlockSchema = z.object({
  type: z.enum(["text", "image", "resource_link"]),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  uri: z.string().optional(),
  name: z.string().optional(),
});

// Tool call schema
const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  result: z.string().optional(),
});

// Callback payload schemas
const messageChunkPayload = z.object({
  type: z.literal("message_chunk"),
  conversationId: conversationIdSchema,
  messageId: messageIdSchema.optional(),
  createdAt: z.number().optional(),
  eventSeq: z.number().optional(),
  content: contentBlockSchema,
});

const reasoningChunkPayload = z.object({
  type: z.literal("reasoning_chunk"),
  conversationId: conversationIdSchema,
  messageId: messageIdSchema.optional(),
  createdAt: z.number().optional(),
  eventSeq: z.number().optional(),
  text: z.string(),
});

const messageCompletePayload = z.object({
  type: z.literal("message_complete"),
  conversationId: conversationIdSchema,
  messageId: messageIdSchema,
  stopReason: z.enum([
    "end_turn",
    "max_tokens",
    "max_turn_requests",
    "refusal",
    "cancelled",
  ]),
});

const toolCallPayload = z.object({
  type: z.literal("tool_call"),
  conversationId: conversationIdSchema,
  messageId: messageIdSchema,
  toolCall: toolCallSchema,
});

const errorPayload = z.object({
  type: z.literal("error"),
  conversationId: conversationIdSchema,
  code: z.string(),
  detail: z.string().optional(),
});

const rawEventPayload = z.object({
  type: z.literal("raw_event_batch"),
  conversationId: conversationIdSchema,
  events: z.array(
    z.object({
      seq: z.number(),
      raw: z.string(),
      createdAt: z.number(),
    })
  ),
});

const sandboxReadyPayload = z.object({
  type: z.literal("sandbox_ready"),
  sandboxId: sandboxIdSchema,
  sandboxUrl: z.string(),
});

// Error reported by sandbox when conversation ID is not available (e.g., from API proxy)
const sandboxErrorPayload = z.object({
  type: z.literal("sandbox_error"),
  sandboxId: sandboxIdSchema,
  code: z.string(),
  detail: z.string().optional(),
});

const acpCallbackPayload = z.discriminatedUnion("type", [
  messageChunkPayload,
  reasoningChunkPayload,
  messageCompletePayload,
  toolCallPayload,
  errorPayload,
  rawEventPayload,
  sandboxReadyPayload,
  sandboxErrorPayload,
]);

type AcpCallbackPayload = z.infer<typeof acpCallbackPayload>;

const sandboxJwtPayload = z.object({
  sandboxId: sandboxIdSchema,
  teamId: z.string(),
});

type SandboxJwtPayload = z.infer<typeof sandboxJwtPayload>;

function verifySandboxJwt(
  token: string
): Effect.Effect<SandboxJwtPayload | null, never, EnvService> {
  return Effect.gen(function* () {
    const env = yield* EnvService;
    const secret = env.ACP_CALLBACK_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
    if (!secret) {
      console.error("[acp.callback] ACP_CALLBACK_SECRET not configured");
      return null;
    }

    const payload = yield* Effect.tryPromise({
      try: () => jwtVerify(token, new TextEncoder().encode(secret)),
      catch: (error) =>
        error instanceof Error ? error : new Error("JWT verification failed"),
    }).pipe(
      Effect.catchAll((error) => {
        console.error("[acp.callback] JWT verification failed:", error);
        return Effect.succeed(null);
      })
    );

    if (!payload) {
      return null;
    }

    const parsed = sandboxJwtPayload.safeParse(payload.payload);
    if (!parsed.success) {
      console.error("[acp.callback] JWT payload invalid", parsed.error);
      return null;
    }
    return parsed.data;
  });
}

function parsePayload(
  body: unknown
): Effect.Effect<AcpCallbackPayload, ReturnType<typeof httpError>> {
  return Effect.try({
    try: () => acpCallbackPayload.parse(body),
    catch: (error) => {
      console.error("[acp.callback] Invalid payload:", error);
      return httpError(400, { code: 400, message: "Invalid payload" });
    },
  });
}

function annotateForPayload(
  payload: AcpCallbackPayload,
  jwtPayload: SandboxJwtPayload
): Effect.Effect<void> {
  const attributes: Record<string, string> = {
    payloadType: payload.type,
  };
  if ("conversationId" in payload) {
    attributes.conversationId = payload.conversationId;
  }
  if ("messageId" in payload && payload.messageId) {
    attributes.messageId = payload.messageId;
  }
  if (payload.type === "sandbox_ready") {
    attributes.sandboxId = payload.sandboxId;
  } else if (payload.type === "raw_event_batch") {
    attributes.sandboxId = jwtPayload.sandboxId;
  }
  const logEffect = Effect.succeed(undefined).pipe(
    Effect.annotateLogs(attributes)
  );
  return Effect.annotateCurrentSpan(attributes).pipe(
    Effect.zipRight(logEffect)
  );
}

export const acpCallbackEffect = (
  ctx: Pick<ActionCtx, "runMutation">,
  req: Request
) =>
  Effect.gen(function* () {
    const token = getBearerToken(req);
    if (!token) {
      console.warn("[acp.callback] Missing bearer token");
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Unauthorized" })
      );
    }

    const jwtPayload = yield* verifySandboxJwt(token);

    if (!jwtPayload) {
      console.warn("[acp.callback] Invalid JWT");
      return yield* Effect.fail(
        httpError(401, { code: 401, message: "Invalid token" })
      );
    }

    yield* requireJsonContentType(req);
    const parsedBody = yield* parseJsonBody(req);
    const payload = yield* parsePayload(parsedBody);

    yield* annotateForPayload(payload, jwtPayload);

    const runMutation = <T>(fn: () => Promise<T>) =>
      Effect.tryPromise({
        try: fn,
        catch: (error) => {
          console.error("[acp.callback] Error processing callback:", error);
          return httpError(500, {
            code: 500,
            message: "Internal error processing callback",
          });
        },
      });

    switch (payload.type) {
      case "message_chunk": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.appendMessageChunk, {
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            createdAt: payload.createdAt,
            eventSeq: payload.eventSeq,
            content: payload.content,
          })
        );
        break;
      }

      case "reasoning_chunk": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.appendReasoningChunk, {
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            createdAt: payload.createdAt,
            eventSeq: payload.eventSeq,
            text: payload.text,
          })
        );
        break;
      }

      case "message_complete": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.completeMessage, {
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            stopReason: payload.stopReason,
          })
        );
        break;
      }

      case "tool_call": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.recordToolCall, {
            conversationId: payload.conversationId,
            messageId: payload.messageId,
            toolCall: payload.toolCall,
          })
        );
        break;
      }

      case "error": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.recordError, {
            conversationId: payload.conversationId,
            code: payload.code,
            detail: payload.detail,
          })
        );
        break;
      }

      case "raw_event_batch": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.appendRawEvents, {
            conversationId: payload.conversationId,
            sandboxId: jwtPayload.sandboxId,
            teamId: jwtPayload.teamId,
            rawEvents: payload.events,
          })
        );
        break;
      }

      case "sandbox_ready": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.sandboxReady, {
            sandboxId: payload.sandboxId,
            sandboxUrl: payload.sandboxUrl,
          })
        );
        break;
      }

      case "sandbox_error": {
        yield* runMutation(() =>
          ctx.runMutation(internal.acp_callbacks.recordSandboxError, {
            sandboxId: payload.sandboxId,
            teamId: jwtPayload.teamId,
            code: payload.code,
            detail: payload.detail,
          })
        );
        break;
      }
    }

    return jsonResponse({ success: true });
  }).pipe(
    withObservability("acp.callback", {
      endpoint: "acp.callback",
      method: req.method,
    })
  );

/**
 * ACP callback endpoint for sandbox updates.
 *
 * Sandboxes POST to this endpoint with:
 * - Authorization: Bearer <sandbox_jwt>
 * - Body: AcpCallbackPayload
 */
export const acpCallback = httpAction(async (ctx, req) => {
  return runHttpEffect(
    acpCallbackEffect(ctx, req).pipe(Effect.provide(LiveServices))
  );
});
