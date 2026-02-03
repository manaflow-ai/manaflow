"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Effect, pipe } from "effect";
import {
  getSendblueConfig,
  makeSendblueService,
  SendblueError,
  ConfigError,
  runEffect,
} from "./sendblue";
import {
  getBedrockConfig,
  makeLLMService,
  LLMError,
  LLMConfigError,
  type ChatMessage,
  type AgentResult,
} from "./sms_llm";

// ============= Internal Actions (Effect-based) =============

export const sendMessage = internalAction({
  args: {
    content: v.string(),
    toNumber: v.string(),
    sendStyle: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    messageId: string;
    messageHandle?: string;
    status?: string;
  }> => {
    const program = pipe(
      // Get config
      getSendblueConfig(),

      // Create service and send message
      Effect.flatMap((config) =>
        pipe(
          makeSendblueService(config),
          Effect.flatMap((service) =>
            pipe(
              // Store message first
              Effect.tryPromise({
                try: () =>
                  ctx.runMutation(internal.sms_queries.storeOutboundMessage, {
                    content: args.content,
                    toNumber: args.toNumber,
                    fromNumber: config.fromNumber,
                    sendStyle: args.sendStyle,
                  }),
                catch: () => new SendblueError("Failed to store message"),
              }),

              // Send via Sendblue
              Effect.flatMap((messageId) =>
                pipe(
                  service.sendMessage({
                    toNumber: args.toNumber,
                    content: args.content,
                    sendStyle: args.sendStyle,
                  }),

                  // Update message with result
                  Effect.flatMap((response) =>
                    pipe(
                      Effect.tryPromise({
                        try: () =>
                          ctx.runMutation(internal.sms_queries.updateMessageStatus, {
                            messageId,
                            status: response.status || "sent",
                            messageHandle: response.message_handle,
                          }),
                        catch: () => new SendblueError("Failed to update message status"),
                      }),
                      Effect.map(() => ({
                        success: true,
                        messageId: messageId as string,
                        messageHandle: response.message_handle,
                        status: response.status,
                      }))
                    )
                  ),

                  // Handle send failure
                  Effect.catchAll((error) =>
                    pipe(
                      Effect.tryPromise({
                        try: () =>
                          ctx.runMutation(internal.sms_queries.updateMessageStatus, {
                            messageId,
                            status: "failed",
                            errorMessage: error instanceof SendblueError ? error.message : "Unknown error",
                          }),
                        catch: () => new SendblueError("Failed to update error status"),
                      }),
                      Effect.flatMap(() => Effect.fail(error))
                    )
                  )
                )
              )
            )
          )
        )
      ),

      // Log errors
      Effect.tapError((error) =>
        Effect.logError("sendMessage failed", { error })
      )
    );

    return runEffect(program);
  },
});

export const sendTypingIndicator = internalAction({
  args: {
    toNumber: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean }> => {
    const program = pipe(
      getSendblueConfig(),
      Effect.flatMap((config) =>
        pipe(
          makeSendblueService(config),
          Effect.flatMap((service) =>
            service.sendTypingIndicator({ toNumber: args.toNumber })
          ),
          Effect.map(() => ({ success: true }))
        )
      ),
      Effect.tapError((error) =>
        Effect.logError("sendTypingIndicator failed", { error })
      )
    );

    return runEffect(program);
  },
});

export const sendGroupTypingIndicator = internalAction({
  args: {
    groupId: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean }> => {
    const program = pipe(
      getSendblueConfig(),
      Effect.flatMap((config) =>
        pipe(
          makeSendblueService(config),
          Effect.flatMap((service) =>
            service.sendGroupTypingIndicator({ groupId: args.groupId })
          ),
          Effect.map(() => ({ success: true }))
        )
      ),
      Effect.tapError((error) =>
        Effect.logError("sendGroupTypingIndicator failed", { error })
      )
    );

    return runEffect(program);
  },
});

export const sendGroupMessage = internalAction({
  args: {
    content: v.string(),
    groupId: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    messageId: string;
    messageHandle?: string;
    status?: string;
  }> => {
    const program = pipe(
      getSendblueConfig(),
      Effect.flatMap((config) =>
        pipe(
          makeSendblueService(config),
          Effect.flatMap((service) =>
            pipe(
              // Store message first
              Effect.tryPromise({
                try: () =>
                  ctx.runMutation(internal.sms_queries.storeOutboundGroupMessage, {
                    content: args.content,
                    groupId: args.groupId,
                    fromNumber: config.fromNumber,
                  }),
                catch: () => new SendblueError("Failed to store group message"),
              }),

              // Send via Sendblue
              Effect.flatMap((messageId) =>
                pipe(
                  service.sendGroupMessage({
                    groupId: args.groupId,
                    content: args.content,
                  }),

                  // Update message with result
                  Effect.flatMap((response) =>
                    pipe(
                      Effect.tryPromise({
                        try: () =>
                          ctx.runMutation(internal.sms_queries.updateMessageStatus, {
                            messageId,
                            status: response.status || "sent",
                            messageHandle: response.message_handle,
                          }),
                        catch: () => new SendblueError("Failed to update message status"),
                      }),
                      Effect.map(() => ({
                        success: true,
                        messageId: messageId as string,
                        messageHandle: response.message_handle,
                        status: response.status,
                      }))
                    )
                  ),

                  // Handle send failure
                  Effect.catchAll((error) =>
                    pipe(
                      Effect.tryPromise({
                        try: () =>
                          ctx.runMutation(internal.sms_queries.updateMessageStatus, {
                            messageId,
                            status: "failed",
                            errorMessage: error instanceof SendblueError ? error.message : "Unknown error",
                          }),
                        catch: () => new SendblueError("Failed to update error status"),
                      }),
                      Effect.flatMap(() => Effect.fail(error))
                    )
                  )
                )
              )
            )
          )
        )
      ),
      Effect.tapError((error) =>
        Effect.logError("sendGroupMessage failed", { error })
      )
    );

    return runEffect(program);
  },
});

// Extract area code from phone number (US format)
const extractAreaCode = (phoneNumber: string): string | null => {
  // Handle +1XXXXXXXXXX or 1XXXXXXXXXX or XXXXXXXXXX formats
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1, 4);
  }
  if (digits.length === 10) {
    return digits.slice(0, 3);
  }
  return null;
};

export const handleInboundMessage = internalAction({
  args: {
    fromNumber: v.string(),
    content: v.string(),
    groupId: v.optional(v.string()),
    participants: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<void> => {
    const FALLBACK_MESSAGE = "sorry, i'm having trouble responding right now.";
    const isGroup = !!args.groupId;
    const areaCode = extractAreaCode(args.fromNumber);

    const program = pipe(
      Effect.logInfo("Processing inbound message", {
        from: args.fromNumber,
        contentLength: args.content.length,
        isGroup,
        groupId: args.groupId,
        areaCode,
      }),

      // Send typing indicator (non-fatal)
      // Note: Sendblue's route mapping can be unreliable. We log but don't block.
      Effect.flatMap(() =>
        isGroup
          ? pipe(
              Effect.tryPromise({
                try: () =>
                  ctx.runAction(internal.sms.sendGroupTypingIndicator, {
                    groupId: args.groupId!,
                  }),
                catch: (error) => new SendblueError("Failed to send group typing indicator", undefined, error),
              }),
              Effect.catchAll((error) =>
                Effect.logWarning("Group typing indicator failed", {
                  groupId: args.groupId,
                  error: error instanceof SendblueError ? error.message : String(error),
                })
              )
            )
          : pipe(
              Effect.tryPromise({
                try: () =>
                  ctx.runAction(internal.sms.sendTypingIndicator, {
                    toNumber: args.fromNumber,
                  }),
                catch: (error) => new SendblueError("Failed to send typing indicator", undefined, error),
              }),
              Effect.catchAll((error) =>
                Effect.logWarning("Typing indicator failed (Sendblue route mapping issue)", {
                  toNumber: args.fromNumber,
                  error: error instanceof SendblueError ? error.message : String(error),
                })
              )
            )
      ),

      // Fetch conversation history
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            ctx.runQuery(internal.sms_queries.getConversationHistory, {
              phoneNumber: args.fromNumber,
              groupId: args.groupId,
              limit: 20,
            }),
          catch: (error) => new SendblueError("Failed to fetch conversation history", undefined, error),
        })
      ),

      // Generate LLM response via agent loop
      Effect.flatMap((history: ChatMessage[]) =>
        pipe(
          getBedrockConfig(),
          Effect.map((config) => makeLLMService(config)),
          Effect.flatMap((llmService) =>
            llmService.generateAgentResponse(history, isGroup, 5, areaCode)
          ),
          Effect.tap((result: AgentResult) =>
            Effect.logInfo("Agent response generated", {
              toolCallCount: result.toolCalls.length,
              totalSteps: result.totalSteps,
              tools: result.toolCalls.map((tc) => ({
                tool: tc.tool,
                input: tc.input,
                durationMs: tc.durationMs,
              })),
            })
          ),
          Effect.map((result: AgentResult) => result.text),
          Effect.catchAll((error) => {
            if (error instanceof LLMConfigError) {
              return pipe(
                Effect.logError("LLM config missing", { error: error.message }),
                Effect.flatMap(() => Effect.succeed(FALLBACK_MESSAGE))
              );
            }
            if (error instanceof LLMError) {
              return pipe(
                Effect.logWarning("Bedrock API failure", { error: error.message }),
                Effect.flatMap(() => Effect.succeed(FALLBACK_MESSAGE))
              );
            }
            return pipe(
              Effect.logWarning("Unknown LLM error", { error }),
              Effect.flatMap(() => Effect.succeed(FALLBACK_MESSAGE))
            );
          })
        )
      ),

      // Send LLM response
      Effect.flatMap((responseText: string) =>
        Effect.tryPromise({
          try: () =>
            isGroup
              ? ctx.runAction(internal.sms.sendGroupMessage, {
                  content: responseText,
                  groupId: args.groupId!,
                })
              : ctx.runAction(internal.sms.sendMessage, {
                  content: responseText,
                  toNumber: args.fromNumber,
                }),
          catch: (error) => new SendblueError("Failed to send LLM response", undefined, error),
        })
      ),

      Effect.tap(() =>
        Effect.logInfo("LLM response sent", { to: isGroup ? args.groupId : args.fromNumber })
      ),

      // Catch but don't fail - we don't want webhook to fail if reply fails
      Effect.catchAll((error) =>
        Effect.logWarning("Failed to send LLM response", { error })
      )
    );

    await runEffect(program);
  },
});

// ============= Admin Actions =============

export const registerWebhook = internalAction({
  args: {},
  handler: async (_ctx) => {
    const program = pipe(
      getSendblueConfig(),
      Effect.flatMap((config) =>
        Effect.tryPromise({
          try: async () => {
            const siteUrl = process.env.CONVEX_SITE_URL;
            if (!siteUrl) {
              throw new Error("Missing CONVEX_SITE_URL");
            }

            if (!config.webhookSecret) {
              throw new Error("Missing SENDBLUE_WEBHOOK_SECRET - required for secure webhooks");
            }

            const webhookUrl = `${siteUrl}/api/sendblue/webhook`;

            // Use PUT to REPLACE all webhooks with only the secured one
            const response = await fetch(
              "https://api.sendblue.co/api/account/webhooks",
              {
                method: "PUT",
                headers: {
                  "sb-api-key-id": config.apiKey,
                  "sb-api-secret-key": config.apiSecret,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  webhooks: {
                    receive: [
                      {
                        url: webhookUrl,
                        secret: config.webhookSecret,
                      },
                    ],
                    outbound: [
                      {
                        url: webhookUrl,
                        secret: config.webhookSecret,
                      },
                    ],
                  },
                }),
              }
            );

            const data = await response.json();
            if (!response.ok) {
              throw new Error(data.error_message || "Failed to register webhook");
            }

            return { success: true, webhookUrl, response: data };
          },
          catch: (error) =>
            new ConfigError(
              error instanceof Error ? error.message : "Failed to register webhook"
            ),
        })
      ),
      Effect.tap((result) =>
        Effect.logInfo("Webhook registered (replaced all)", result)
      )
    );

    return runEffect(program);
  },
});

/**
 * Creates a new group chat via Sendblue by sending an initial message to multiple numbers.
 * This is the recommended way to create groups (instead of BlueBubbles) because:
 * - Sendblue-created groups have phone-only participants
 * - Sendblue can see and respond to messages in these groups
 * - No email accounts are involved
 */
export const createGroupChat = internalAction({
  args: {
    numbers: v.array(v.string()),
    initialMessage: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    success: boolean;
    groupId?: string;
    messageHandle?: string;
    error?: string;
  }> => {
    const program = pipe(
      getSendblueConfig(),
      Effect.flatMap((config) =>
        pipe(
          makeSendblueService(config),
          Effect.flatMap((service) =>
            service.createGroupChat({
              numbers: args.numbers,
              content: args.initialMessage,
            })
          )
        )
      ),
      Effect.map((result) => ({
        success: true,
        groupId: result.groupId,
        messageHandle: result.messageResponse.message_handle,
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof SendblueError ? error.message :
                 error instanceof ConfigError ? error.message :
                 String(error),
        })
      )
    );

    return runEffect(program);
  },
});
