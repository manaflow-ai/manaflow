import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Effect, pipe } from "effect";
import {
  validateWebhook,
  parseWebhookPayload,
  WebhookValidationError,
  runEffect,
} from "./sendblue";

// ============= Webhook Handler (Effect-based) =============

export const sendblueWebhook = httpAction(async (ctx, request) => {
  // Get webhook secret from environment
  const webhookSecret = process.env.SENDBLUE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Missing SENDBLUE_WEBHOOK_SECRET environment variable");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const program = pipe(
    // Log incoming webhook
    Effect.logInfo("Received Sendblue webhook"),

    // Validate webhook signature
    Effect.flatMap(() => validateWebhook(request.headers, webhookSecret)),

    // Parse request body
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => request.json(),
        catch: () => new WebhookValidationError("Failed to parse request body"),
      })
    ),

    // Parse and validate payload
    Effect.flatMap((body) => parseWebhookPayload(body)),

    // Process the webhook
    Effect.flatMap((payload) =>
      pipe(
        // Log the raw webhook
        Effect.tryPromise({
          try: () =>
            ctx.runMutation(internal.sms_queries.logWebhook, {
              eventType: payload.is_outbound ? "outbound" : "receive",
              payload: JSON.stringify(payload),
            }),
          catch: () => new WebhookValidationError("Failed to log webhook"),
        }),

        // Store the message
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () =>
              ctx.runMutation(internal.sms_queries.processWebhookMessage, {
                content: payload.content || "",
                fromNumber: payload.from_number || "",
                toNumber: payload.to_number || "",
                isOutbound: payload.is_outbound || false,
                status: payload.status || "received",
                service: payload.service ?? undefined,
                messageHandle: payload.message_handle ?? undefined,
                dateSent: payload.date_sent ?? undefined,
                errorCode: payload.error_code ?? undefined,
                errorMessage: payload.error_message ?? undefined,
                mediaUrl: payload.media_url || undefined,
                // Group chat fields
                groupId: payload.group_id || undefined,
                participants: payload.participants ?? undefined,
              }),
            catch: () => new WebhookValidationError("Failed to process message"),
          })
        ),

        // Schedule inbound message processing (debounced)
          Effect.flatMap((messageId) =>
            pipe(
              Effect.if(
              !payload.is_outbound && !!payload.from_number,
                {
                  onTrue: () =>
                    Effect.tryPromise({
                      try: () =>
                        ctx.runMutation(internal.sms_queries.scheduleInboundProcessing, {
                          fromNumber: payload.from_number,
                          content: payload.content || "",
                          messageId,
                          messageHandle: payload.message_handle ?? undefined,
                          mediaUrl: payload.media_url || undefined,
                          groupId: payload.group_id || undefined,
                          participants: payload.participants ?? undefined,
                        }),
                      catch: () =>
                        new WebhookValidationError("Failed to schedule inbound processing"),
                  }),
                onFalse: () => Effect.void,
              }
            ),
            Effect.map(() => messageId)
          )
        ),

        Effect.map((messageId) => ({
          success: true,
          messageId: String(messageId),
        }))
      )
    ),

    // Log success
    Effect.tap((result) =>
      Effect.logInfo("Webhook processed successfully", result)
    )
  );

  try {
    const result = await runEffect(program);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook processing error:", error);

    // Return 401 for validation errors, 500 for others
    const isValidationError =
      error instanceof WebhookValidationError ||
      (error &&
        typeof error === "object" &&
        "_tag" in error &&
        error._tag === "WebhookValidationError");

    return new Response(
      JSON.stringify({
        error: isValidationError ? "Unauthorized" : "Failed to process webhook",
      }),
      {
        status: isValidationError ? 401 : 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

// ============= Health Check =============

export const sendblueHealth = httpAction(async () => {
  return new Response(
    JSON.stringify({ status: "ok", timestamp: Date.now() }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
