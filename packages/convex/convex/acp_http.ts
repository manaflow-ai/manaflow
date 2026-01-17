import { jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

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

async function parseJsonRequest(req: Request): Promise<unknown | Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }
  try {
    return await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
}

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
  conversationId: z.string(),
  messageId: z.string().optional(),
  createdAt: z.number().optional(),
  eventSeq: z.number().optional(),
  content: contentBlockSchema,
});

const reasoningChunkPayload = z.object({
  type: z.literal("reasoning_chunk"),
  conversationId: z.string(),
  messageId: z.string().optional(),
  createdAt: z.number().optional(),
  eventSeq: z.number().optional(),
  text: z.string(),
});

const messageCompletePayload = z.object({
  type: z.literal("message_complete"),
  conversationId: z.string(),
  messageId: z.string(),
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
  conversationId: z.string(),
  messageId: z.string(),
  toolCall: toolCallSchema,
});

const errorPayload = z.object({
  type: z.literal("error"),
  conversationId: z.string(),
  code: z.string(),
  detail: z.string().optional(),
});

const rawEventPayload = z.object({
  type: z.literal("raw_event_batch"),
  conversationId: z.string(),
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
  sandboxId: z.string(),
  sandboxUrl: z.string(),
});

const acpCallbackPayload = z.discriminatedUnion("type", [
  messageChunkPayload,
  reasoningChunkPayload,
  messageCompletePayload,
  toolCallPayload,
  errorPayload,
  rawEventPayload,
  sandboxReadyPayload,
]);

type AcpCallbackPayload = z.infer<typeof acpCallbackPayload>;

// JWT payload type
interface SandboxJwtPayload {
  sandboxId: string;
  teamId: string;
}

/**
 * Verify sandbox callback JWT.
 */
async function verifySandboxJwt(
  token: string
): Promise<SandboxJwtPayload | null> {
  const secret = env.ACP_CALLBACK_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
  if (!secret) {
    console.error("[acp.callback] ACP_CALLBACK_SECRET not configured");
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret)
    );
    return payload as unknown as SandboxJwtPayload;
  } catch (error) {
    console.error("[acp.callback] JWT verification failed:", error);
    return null;
  }
}

/**
 * ACP callback endpoint for sandbox updates.
 *
 * Sandboxes POST to this endpoint with:
 * - Authorization: Bearer <sandbox_jwt>
 * - Body: AcpCallbackPayload
 */
export const acpCallback = httpAction(async (ctx, req) => {
  // Verify auth
  const token = getBearerToken(req);
  if (!token) {
    console.warn("[acp.callback] Missing bearer token");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const jwtPayload = await verifySandboxJwt(token);
  if (!jwtPayload) {
    console.warn("[acp.callback] Invalid JWT");
    return jsonResponse({ code: 401, message: "Invalid token" }, 401);
  }

  // Parse request body
  const parsed = await parseJsonRequest(req);
  if (parsed instanceof Response) {
    return parsed;
  }

  // Validate payload
  let payload: AcpCallbackPayload;
  try {
    payload = acpCallbackPayload.parse(parsed);
  } catch (error) {
    console.error("[acp.callback] Invalid payload:", error);
    return jsonResponse({ code: 400, message: "Invalid payload" }, 400);
  }

  // Dispatch based on payload type
  try {
    switch (payload.type) {
      case "message_chunk": {
        await ctx.runMutation(internal.acp_callbacks.appendMessageChunk, {
          conversationId: payload.conversationId as Id<"conversations">,
          messageId: payload.messageId as Id<"conversationMessages"> | undefined,
          createdAt: payload.createdAt,
          eventSeq: payload.eventSeq,
          content: payload.content,
        });
        break;
      }

      case "reasoning_chunk": {
        await ctx.runMutation(internal.acp_callbacks.appendReasoningChunk, {
          conversationId: payload.conversationId as Id<"conversations">,
          messageId: payload.messageId as Id<"conversationMessages"> | undefined,
          createdAt: payload.createdAt,
          eventSeq: payload.eventSeq,
          text: payload.text,
        });
        break;
      }

      case "message_complete": {
        await ctx.runMutation(internal.acp_callbacks.completeMessage, {
          conversationId: payload.conversationId as Id<"conversations">,
          messageId: payload.messageId as Id<"conversationMessages">,
          stopReason: payload.stopReason,
        });
        break;
      }

      case "tool_call": {
        await ctx.runMutation(internal.acp_callbacks.recordToolCall, {
          conversationId: payload.conversationId as Id<"conversations">,
          messageId: payload.messageId as Id<"conversationMessages">,
          toolCall: payload.toolCall,
        });
        break;
      }

      case "error": {
        await ctx.runMutation(internal.acp_callbacks.recordError, {
          conversationId: payload.conversationId as Id<"conversations">,
          code: payload.code,
          detail: payload.detail,
        });
        break;
      }

      case "raw_event_batch": {
        await ctx.runMutation(internal.acp_callbacks.appendRawEvents, {
          conversationId: payload.conversationId as Id<"conversations">,
          sandboxId: jwtPayload.sandboxId as Id<"acpSandboxes">,
          teamId: jwtPayload.teamId,
          rawEvents: payload.events,
        });
        break;
      }

      case "sandbox_ready": {
        await ctx.runMutation(internal.acp_callbacks.sandboxReady, {
          sandboxId: payload.sandboxId as Id<"acpSandboxes">,
          sandboxUrl: payload.sandboxUrl,
        });
        break;
      }
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("[acp.callback] Error processing callback:", error);
    return jsonResponse(
      { code: 500, message: "Internal error processing callback" },
      500
    );
  }
});
