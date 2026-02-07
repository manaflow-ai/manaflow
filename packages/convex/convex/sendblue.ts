import { Effect, pipe } from "effect";
import SendblueAPI from "sendblue";
import type { MessageResponse } from "sendblue/resources/messages";

// ============= Errors =============

export class SendblueError {
  readonly _tag = "SendblueError";
  constructor(
    readonly message: string,
    readonly code?: string,
    readonly cause?: unknown
  ) {}
}

export class WebhookValidationError {
  readonly _tag = "WebhookValidationError";
  constructor(readonly message: string) {}
}

export class ConfigError {
  readonly _tag = "ConfigError";
  constructor(readonly message: string) {}
}

// ============= Config =============

export type SendblueConfig = {
  apiKey: string;
  apiSecret: string;
  fromNumber: string;
  webhookSecret: string;
  siteUrl?: string;
};

export const getSendblueConfig = (): Effect.Effect<SendblueConfig, ConfigError> =>
  Effect.try({
    try: () => {
      const apiKey = process.env.SENDBLUE_API_KEY;
      const apiSecret = process.env.SENDBLUE_API_SECRET;
      const fromNumber = process.env.SENDBLUE_FROM_NUMBER;
      const webhookSecret = process.env.SENDBLUE_WEBHOOK_SECRET;

      if (!apiKey) throw new Error("Missing SENDBLUE_API_KEY");
      if (!apiSecret) throw new Error("Missing SENDBLUE_API_SECRET");
      if (!fromNumber) throw new Error("Missing SENDBLUE_FROM_NUMBER");
      if (!webhookSecret) throw new Error("Missing SENDBLUE_WEBHOOK_SECRET");

      return {
        apiKey,
        apiSecret,
        fromNumber,
        webhookSecret,
        siteUrl: process.env.CONVEX_SITE_URL,
      };
    },
    catch: (error) =>
      new ConfigError(
        error instanceof Error ? error.message : "Invalid environment configuration"
      ),
  });

// ============= Sendblue Service =============

type SendStyle =
  | "celebration"
  | "shooting_star"
  | "fireworks"
  | "lasers"
  | "love"
  | "confetti"
  | "balloons"
  | "spotlight"
  | "echo"
  | "invisible"
  | "gentle"
  | "loud"
  | "slam"
  | undefined;

export const makeSendblueService = (config: SendblueConfig) =>
  Effect.sync(() => {
    const client = new SendblueAPI({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
    });

    return {
      sendMessage: (params: {
        toNumber: string;
        content: string;
        sendStyle?: string;
        mediaUrl?: string;
      }): Effect.Effect<MessageResponse, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () =>
              client.messages.send({
                content: params.content,
                number: params.toNumber,
                from_number: config.fromNumber,
                send_style: params.sendStyle as SendStyle,
                media_url: params.mediaUrl,
              }),
            catch: (error) =>
              new SendblueError("Failed to send message", undefined, error),
          }),
          Effect.tap((response: MessageResponse) =>
            Effect.logInfo("Message sent", {
              to: params.toNumber,
              messageHandle: response.message_handle,
              status: response.status,
              hasMedia: !!params.mediaUrl,
            })
          )
        ),

      getMessageStatus: (params: { handle: string }): Effect.Effect<MessageResponse, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () => client.messages.getStatus({ handle: params.handle }),
            catch: (error) =>
              new SendblueError("Failed to get message status", undefined, error),
          }),
          Effect.tap((response: MessageResponse) =>
            Effect.logDebug("Message status fetched", {
              handle: params.handle,
              status: response.status,
              hasMedia: !!response.media_url,
            })
          )
        ),

      sendTypingIndicator: (params: { toNumber: string }): Effect.Effect<unknown, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () =>
              client.typingIndicators.send({
                number: params.toNumber,
              }),
            catch: (error) =>
              new SendblueError(
                "Failed to send typing indicator",
                undefined,
                error
              ),
          }),
          Effect.tap(() =>
            Effect.logDebug("Typing indicator sent", { to: params.toNumber })
          )
        ),

      sendGroupTypingIndicator: (params: { groupId: string }): Effect.Effect<unknown, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () =>
              client.typingIndicators.send({
                group_id: params.groupId,
              } as unknown as Parameters<typeof client.typingIndicators.send>[0]),
            catch: (error) =>
              new SendblueError(
                "Failed to send group typing indicator",
                undefined,
                error
              ),
          }),
          Effect.tap(() =>
            Effect.logDebug("Group typing indicator sent", { groupId: params.groupId })
          )
        ),

      lookupNumber: (params: { number: string }): Effect.Effect<unknown, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () =>
              client.lookups.lookupNumber({
                number: params.number,
              }),
            catch: (error) =>
              new SendblueError("Failed to lookup number", undefined, error),
          })
        ),

      sendGroupMessage: (params: { groupId: string; content: string; mediaUrl?: string }): Effect.Effect<MessageResponse, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: () =>
              client.groups.sendMessage({
                content: params.content,
                from_number: config.fromNumber,
                group_id: params.groupId,
                media_url: params.mediaUrl,
              }),
            catch: (error) =>
              new SendblueError("Failed to send group message", undefined, error),
          }),
          Effect.tap((response: MessageResponse) =>
            Effect.logInfo("Group message sent", {
              groupId: params.groupId,
              messageHandle: response.message_handle,
              status: response.status,
            })
          )
        ),

      /**
       * Creates a new group chat by sending a message to multiple phone numbers.
       * Sendblue will create a new group and return the group_id.
       * This is the preferred way to create groups (over BlueBubbles) since
       * Sendblue-created groups have phone-only participants.
       */
      createGroupChat: (params: {
        numbers: string[];
        content: string;
      }): Effect.Effect<{ groupId: string; messageResponse: MessageResponse }, SendblueError> =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              // Use the send-group-message API directly with numbers array
              const response = await fetch("https://api.sendblue.co/api/send-group-message", {
                method: "POST",
                headers: {
                  "sb-api-key-id": config.apiKey,
                  "sb-api-secret-key": config.apiSecret,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  numbers: params.numbers,
                  content: params.content,
                  from_number: config.fromNumber,
                }),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sendblue API error: ${response.status} - ${errorText}`);
              }

              const result = await response.json() as MessageResponse & { group_id?: string };
              return result;
            },
            catch: (error) =>
              new SendblueError("Failed to create group chat", undefined, error),
          }),
          Effect.flatMap((result) => {
            const groupId = result.group_id;
            if (!groupId) {
              return Effect.fail(
                new SendblueError("No group_id returned from Sendblue")
              );
            }
            return Effect.succeed({
              groupId,
              messageResponse: result as MessageResponse,
            });
          }),
          Effect.tap(({ groupId }) =>
            Effect.logInfo("Group chat created", {
              groupId,
              numbers: params.numbers,
            })
          )
        ),
    };
  });

// ============= Webhook Validation =============

export interface SendblueWebhookPayload {
  accountEmail: string;
  content: string;
  is_outbound: boolean;
  status: string;
  error_code: number | null;
  error_message: string | null;
  message_handle: string;
  date_sent: string;
  from_number: string;
  to_number: string;
  service: string;
  media_url?: string;
  message_type: string;
  // Group chat fields
  group_id?: string; // Empty string for non-group
  participants?: string[]; // Array of phone numbers in group
  group_display_name?: string | null;
}

/**
 * Validates incoming Sendblue webhook requests.
 * Sendblue sends the configured secret in the `sb-signing-secret` header.
 * This is a plain text comparison (not HMAC).
 */
export const validateWebhook = (
  headers: Headers,
  expectedSecret: string
): Effect.Effect<void, WebhookValidationError> =>
  Effect.try({
    try: () => {
      // Sendblue sends the secret in the sb-signing-secret header
      const signature = headers.get("sb-signing-secret");

      if (!signature) {
        throw new Error("Missing webhook signature header (sb-signing-secret)");
      }

      // Timing-safe comparison to prevent timing attacks
      if (signature.length !== expectedSecret.length) {
        throw new Error("Invalid webhook signature");
      }

      // Simple constant-time comparison
      let mismatch = 0;
      for (let i = 0; i < signature.length; i++) {
        mismatch |= signature.charCodeAt(i) ^ expectedSecret.charCodeAt(i);
      }

      if (mismatch !== 0) {
        throw new Error("Invalid webhook signature");
      }
    },
    catch: (error) =>
      new WebhookValidationError(
        error instanceof Error ? error.message : "Webhook validation failed"
      ),
  });

export const parseWebhookPayload = (
  body: unknown
): Effect.Effect<SendblueWebhookPayload, WebhookValidationError> =>
  Effect.try({
    try: () => {
      const payload = body as SendblueWebhookPayload;
      if (!payload.message_handle || !payload.from_number) {
        throw new Error("Invalid webhook payload structure");
      }
      return payload;
    },
    catch: (error) =>
      new WebhookValidationError(
        error instanceof Error ? error.message : "Failed to parse webhook payload"
      ),
  });

// ============= Effect Runner for Convex =============

export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> =>
  Effect.runPromise(
    pipe(
      effect,
      Effect.catchAll((error) => {
        console.error("Effect error:", error);
        return Effect.fail(error);
      })
    )
  );
