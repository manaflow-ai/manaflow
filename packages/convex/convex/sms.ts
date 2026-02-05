"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
  type SandboxToolContext,
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

      // Get or create phone user for sandbox tools
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            ctx.runMutation(internal.sms_phone_users.getOrCreate, {
              phoneNumber: args.fromNumber,
            }),
          catch: (error) => new SendblueError("Failed to get/create phone user", undefined, error),
        })
      ),

      // Continue with phone user context
      Effect.flatMap(({ phoneUser }) =>
        pipe(
          // Send typing indicator (non-fatal)
          // Note: Sendblue's route mapping can be unreliable. We log but don't block.
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

          // Generate LLM response via agent loop with sandbox tools
          Effect.flatMap((history: ChatMessage[]) =>
            pipe(
              getBedrockConfig(),
              Effect.map((config) => makeLLMService(config)),
              Effect.flatMap((llmService) => {
                // Create sandbox tool context for the LLM
                const sandboxContext: SandboxToolContext = {
                  phoneNumber: args.fromNumber,
                  userId: phoneUser.userId,
                  teamId: phoneUser.defaultTeamId,
                  executeAction: async <T>(
                    action: { name: string; args: Record<string, unknown> },
                    _handler: () => Promise<T>
                  ): Promise<T> => {
                    // Route to actual Convex actions
                    if (action.name === "sms.startAgentConversation") {
                      const result = await ctx.runAction(internal.sms.startAgentConversation, {
                        phoneNumber: args.fromNumber,
                        userId: phoneUser.userId,
                        teamId: phoneUser.defaultTeamId,
                        task: action.args.task as string,
                        providerId: action.args.provider as "claude" | "codex" | undefined,
                      });
                      return result as T;
                    }
                    if (action.name === "sms.sendToConversation") {
                      const result = await ctx.runAction(internal.sms.sendToConversation, {
                        phoneNumber: args.fromNumber,
                        userId: phoneUser.userId,
                        conversationId: action.args.conversationId as Id<"conversations">,
                        message: action.args.message as string,
                      });
                      return result as T;
                    }
                    if (action.name === "sms.getConversationStatus") {
                      const result = await ctx.runAction(internal.sms.getConversationStatus, {
                        userId: phoneUser.userId,
                        conversationId: action.args.conversationId as Id<"conversations">,
                        includeHistory: action.args.includeHistory as boolean | undefined,
                      });
                      return result as T;
                    }
                    throw new Error(`Unknown action: ${action.name}`);
                  },
                  runQuery: async <T>(
                    query: { name: string; args: Record<string, unknown> },
                    _handler: () => Promise<T>
                  ): Promise<T> => {
                    // Route to actual Convex queries
                    if (query.name === "sms_queries.getUnreadInbox") {
                      const result = await ctx.runQuery(internal.sms_queries.getUnreadInbox, {
                        phoneNumber: args.fromNumber,
                        limit: 20,
                      });
                      // Optionally mark as read
                      if (query.args.markAsRead) {
                        await ctx.runMutation(internal.sms_queries.markInboxRead, {
                          phoneNumber: args.fromNumber,
                        });
                      }
                      return result as T;
                    }
                    if (query.name === "sms_queries.getConversationsForPhone") {
                      const result = await ctx.runQuery(internal.sms_queries.getConversationsForPhone, {
                        phoneNumber: args.fromNumber,
                        userId: phoneUser.userId,
                        teamId: phoneUser.defaultTeamId,
                        status: query.args.status as "active" | "completed" | "all" | undefined,
                        limit: 20,
                      });
                      return result as T;
                    }
                    if (query.name === "sms_queries.searchConversations") {
                      const result = await ctx.runQuery(internal.sms_queries.searchConversations, {
                        userId: phoneUser.userId,
                        teamId: phoneUser.defaultTeamId,
                        query: query.args.query as string,
                        limit: query.args.limit as number | undefined,
                      });
                      return result as T;
                    }
                    throw new Error(`Unknown query: ${query.name}`);
                  },
                };

                return llmService.generateAgentResponse(
                  history,
                  isGroup,
                  10, // Increase max tool roundtrips for sandbox operations
                  areaCode,
                  sandboxContext
                );
              }),
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
          )
        )
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

// ============= SMS Agent Sandbox Actions =============

/**
 * Start a new sandbox conversation for an SMS user.
 * This is called by the LLM agent when the user requests a coding task.
 */
export const startAgentConversation = internalAction({
  args: {
    phoneNumber: v.string(),
    userId: v.string(),
    teamId: v.string(),
    task: v.string(),
    providerId: v.optional(
      v.union(v.literal("claude"), v.literal("codex"), v.literal("gemini"), v.literal("opencode"))
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    conversationId?: string;
    error?: string;
  }> => {
    const providerId = args.providerId ?? "claude";

    const program = pipe(
      Effect.logInfo("Starting agent conversation for SMS user", {
        phoneNumber: args.phoneNumber,
        providerId,
        taskLength: args.task.length,
      }),

      // Create conversation via internal ACP action
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: async () => {
            // Create the conversation
            const sessionId = `sms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const conversationId = await ctx.runMutation(
              internal.acp.createConversationInternal,
              {
                teamId: args.teamId,
                userId: args.userId,
                sessionId,
                providerId,
                cwd: "/workspace", // Universal path that works on all sandbox providers
                initializedOnSandbox: false,
              }
            );

            return conversationId;
          },
          catch: (error) =>
            new SendblueError(
              `Failed to create conversation: ${error instanceof Error ? error.message : String(error)}`
            ),
        })
      ),

      // Create initial message
      Effect.flatMap((conversationId) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              const messageId = await ctx.runMutation(
                internal.acp.createMessageInternal,
                {
                  conversationId,
                  role: "user",
                  content: [{ type: "text", text: args.task }],
                }
              );
              return { conversationId, messageId };
            },
            catch: (error) =>
              new SendblueError(
                `Failed to create message: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      // Schedule message delivery
      Effect.flatMap(({ conversationId, messageId }) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              await ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
                conversationId,
                messageId,
                attempt: 0,
              });
              return conversationId;
            },
            catch: (error) =>
              new SendblueError(
                `Failed to schedule delivery: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      // Add inbox entry
      Effect.flatMap((conversationId) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              await ctx.runMutation(internal.sms_queries.addInboxEntry, {
                phoneNumber: args.phoneNumber,
                conversationId,
                type: "started",
                summary: `Started: ${args.task.slice(0, 50)}${args.task.length > 50 ? "..." : ""}`,
              });
              return conversationId;
            },
            catch: (error) =>
              new SendblueError(
                `Failed to add inbox entry: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      Effect.map((conversationId) => ({
        success: true,
        conversationId: conversationId as string,
      })),

      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof SendblueError ? error.message : String(error),
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Send a message to an existing sandbox conversation.
 */
export const sendToConversation = internalAction({
  args: {
    phoneNumber: v.string(),
    userId: v.string(),
    conversationId: v.id("conversations"),
    message: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> => {
    const program = pipe(
      Effect.logInfo("Sending message to conversation", {
        phoneNumber: args.phoneNumber,
        conversationId: args.conversationId,
      }),

      // Verify conversation belongs to user
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: async () => {
            const conversation = await ctx.runQuery(
              internal.conversations.getByIdInternal,
              { conversationId: args.conversationId }
            );
            if (!conversation) {
              throw new Error("Conversation not found");
            }
            if (conversation.userId !== args.userId) {
              throw new Error("Conversation does not belong to user");
            }
            return conversation;
          },
          catch: (error) =>
            new SendblueError(
              error instanceof Error ? error.message : String(error)
            ),
        })
      ),

      // Create message
      Effect.flatMap((conversation) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              const messageId = await ctx.runMutation(
                internal.acp.createMessageInternal,
                {
                  conversationId: args.conversationId,
                  role: "user",
                  content: [{ type: "text", text: args.message }],
                }
              );
              return { conversation, messageId };
            },
            catch: (error) =>
              new SendblueError(
                `Failed to create message: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      // Schedule delivery
      Effect.flatMap(({ messageId }) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              await ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
                conversationId: args.conversationId,
                messageId,
                attempt: 0,
              });
              return messageId;
            },
            catch: (error) =>
              new SendblueError(
                `Failed to schedule delivery: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      Effect.map((messageId) => ({
        success: true,
        messageId: messageId as string,
      })),

      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof SendblueError ? error.message : String(error),
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Get the status and last message from a conversation.
 */
export const getConversationStatus = internalAction({
  args: {
    userId: v.string(),
    conversationId: v.id("conversations"),
    includeHistory: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    status?: string;
    title?: string;
    lastAssistantMessage?: string;
    history?: Array<{ role: string; content: string }>;
    error?: string;
  }> => {
    const program = pipe(
      Effect.logInfo("Getting conversation status", {
        conversationId: args.conversationId,
      }),

      // Get conversation
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: async () => {
            const conversation = await ctx.runQuery(
              internal.conversations.getByIdInternal,
              { conversationId: args.conversationId }
            );
            if (!conversation) {
              throw new Error("Conversation not found");
            }
            if (conversation.userId !== args.userId) {
              throw new Error("Conversation does not belong to user");
            }
            return conversation;
          },
          catch: (error) =>
            new SendblueError(
              error instanceof Error ? error.message : String(error)
            ),
        })
      ),

      // Get messages
      Effect.flatMap((conversation) =>
        pipe(
          Effect.tryPromise({
            try: async () => {
              const messages = await ctx.runQuery(
                internal.conversationMessages.listByConversationInternal,
                {
                  conversationId: args.conversationId,
                  limit: args.includeHistory ? 20 : 5,
                }
              );
              return { conversation, messages };
            },
            catch: (error) =>
              new SendblueError(
                `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`
              ),
          })
        )
      ),

      Effect.map(({ conversation, messages }) => {
        // Find the last assistant message
        const assistantMessages = messages.filter((m) => m.role === "assistant");
        const lastAssistant = assistantMessages[assistantMessages.length - 1];

        // Extract text content from the last assistant message
        let lastAssistantMessage: string | undefined;
        if (lastAssistant && lastAssistant.content) {
          const textBlocks = lastAssistant.content
            .filter((block) => block.type === "text" && block.text)
            .map((block) => block.text);
          lastAssistantMessage = textBlocks.join("\n");
        }

        // Build history if requested
        let history: Array<{ role: string; content: string }> | undefined;
        if (args.includeHistory) {
          history = messages.map((m) => {
            const textContent = m.content
              .filter((block) => block.type === "text" && block.text)
              .map((block) => block.text)
              .join("\n");
            return { role: m.role, content: textContent };
          });
        }

        return {
          success: true,
          status: conversation.status,
          title: conversation.title,
          lastAssistantMessage,
          history,
        };
      }),

      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof SendblueError ? error.message : String(error),
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Send a proactive notification to the user when a task completes.
 * @deprecated Use triggerAgentWithNotification instead for agent-controlled responses.
 */
export const sendProactiveNotification = internalAction({
  args: {
    phoneNumber: v.string(),
    conversationId: v.id("conversations"),
    summary: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
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
                  ctx.runMutation(internal.sms_queries.storeOutboundMessage, {
                    content: args.summary,
                    toNumber: args.phoneNumber,
                    fromNumber: config.fromNumber,
                  }),
                catch: () => new SendblueError("Failed to store proactive message"),
              }),

              // Send via Sendblue
              Effect.flatMap((messageId) =>
                pipe(
                  service.sendMessage({
                    toNumber: args.phoneNumber,
                    content: args.summary,
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
                        catch: () =>
                          new SendblueError("Failed to update message status"),
                      }),
                      Effect.map(() => ({ success: true }))
                    )
                  ),

                  Effect.catchAll(() => Effect.succeed({ success: false }))
                )
              )
            )
          )
        )
      ),
      Effect.catchAll(() => Effect.succeed({ success: false }))
    );

    return runEffect(program);
  },
});

// ============= Notification Entry Type =============

type NotificationEntry = {
  _id: unknown;
  phoneNumber: string;
  conversationId: unknown;
  type: "started" | "message" | "completed" | "error";
  summary: string;
  isRead: boolean;
  createdAt: number;
  title?: string;
  lastMessage?: string;
};

/**
 * Build the notification context string for the agent.
 * This is injected into the system prompt so the agent knows about completed tasks.
 */
function buildNotificationContext(notifications: NotificationEntry[]): string {
  if (notifications.length === 0) return "";

  const primary = notifications[0];
  const others = notifications.slice(1);

  let context = `[SYSTEM NOTIFICATION - respond to user via send_sms]

your sandbox task just finished:
- task: "${primary.title || "coding task"}"
- status: ${primary.type}
- result: ${primary.lastMessage || "completed"}
`;

  if (others.length > 0) {
    context += `
other pending notifications (${others.length}):
${others.map((n) => `- ${n.title || "task"}: ${n.type}`).join("\n")}
`;
  }

  context += `
respond naturally to the user about this. use send_sms to send your message.
keep it brief and casual - this is imessage.`;

  return context;
}

/**
 * Trigger the agent with notification context.
 * Instead of sending a hardcoded notification, this re-runs the agent with context about
 * what just completed, letting the agent decide how to respond naturally.
 */
export const triggerAgentWithNotification = internalAction({
  args: {
    phoneNumber: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args): Promise<void> => {
    const program = pipe(
      Effect.logInfo("Triggering agent with notification", {
        phoneNumber: args.phoneNumber,
        conversationId: args.conversationId,
      }),

      // 1. Get phone user for context
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () =>
            ctx.runQuery(internal.sms_phone_users.getByPhone, {
              phoneNumber: args.phoneNumber,
            }),
          catch: (error) =>
            new SendblueError("Failed to get phone user", undefined, error),
        })
      ),

      Effect.flatMap((phoneUser) => {
        if (!phoneUser) {
          return Effect.logWarning("No phone user found, skipping notification");
        }

        return pipe(
          // 2. Get all unread inbox entries
          Effect.tryPromise({
            try: () =>
              ctx.runQuery(internal.sms_queries.getUnreadInbox, {
                phoneNumber: args.phoneNumber,
              }),
            catch: (error) =>
              new SendblueError("Failed to get unread inbox", undefined, error),
          }),

          // 3. Enrich entries with conversation details
          Effect.flatMap((unreadEntries) =>
            Effect.tryPromise({
              try: async () => {
                const notifications: NotificationEntry[] = await Promise.all(
                  unreadEntries.map(async (entry) => {
                    if (entry.type === "completed" || entry.type === "error") {
                      const conv = await ctx.runQuery(
                        internal.conversations.getByIdInternal,
                        { conversationId: entry.conversationId }
                      );
                      const messages = await ctx.runQuery(
                        internal.conversationMessages.listByConversationInternal,
                        { conversationId: entry.conversationId, limit: 5 }
                      );
                      const lastAssistant = messages
                        .filter((m) => m.role === "assistant")
                        .pop();

                      // Extract text from last assistant message
                      let lastMessage: string | undefined;
                      if (lastAssistant && lastAssistant.content) {
                        const textBlocks = lastAssistant.content
                          .filter((block) => block.type === "text" && block.text)
                          .map((block) => block.text);
                        lastMessage = textBlocks.join(" ").slice(0, 500);
                      }

                      return {
                        ...entry,
                        title: conv?.title,
                        lastMessage,
                      } as NotificationEntry;
                    }
                    return entry as NotificationEntry;
                  })
                );
                return notifications;
              },
              catch: (error) =>
                new SendblueError(
                  "Failed to enrich notifications",
                  undefined,
                  error
                ),
            })
          ),

          // 4. Build notification context and run agent
          Effect.flatMap((notifications) => {
            if (notifications.length === 0) {
              return Effect.logInfo("No notifications to process");
            }

            const notificationContext = buildNotificationContext(notifications);

            return pipe(
              // Get SMS conversation history
              Effect.tryPromise({
                try: () =>
                  ctx.runQuery(internal.sms_queries.getConversationHistory, {
                    phoneNumber: args.phoneNumber,
                    limit: 20,
                  }),
                catch: (error) =>
                  new SendblueError(
                    "Failed to get conversation history",
                    undefined,
                    error
                  ),
              }),

              // Run agent with notification context
              Effect.flatMap((history) =>
                pipe(
                  getBedrockConfig(),
                  Effect.map((config) => makeLLMService(config)),
                  Effect.flatMap((llmService) => {
                    // Create sandbox tool context for the LLM
                    const sandboxContext: SandboxToolContext = {
                      phoneNumber: args.phoneNumber,
                      userId: phoneUser.userId,
                      teamId: phoneUser.defaultTeamId,
                      executeAction: async <T>(
                        action: { name: string; args: Record<string, unknown> },
                        _handler: () => Promise<T>
                      ): Promise<T> => {
                        // Route to actual Convex actions
                        if (action.name === "sms.startAgentConversation") {
                          const result = await ctx.runAction(
                            internal.sms.startAgentConversation,
                            {
                              phoneNumber: args.phoneNumber,
                              userId: phoneUser.userId,
                              teamId: phoneUser.defaultTeamId,
                              task: action.args.task as string,
                              providerId: action.args.provider as
                                | "claude"
                                | "codex"
                                | undefined,
                            }
                          );
                          return result as T;
                        }
                        if (action.name === "sms.sendToConversation") {
                          const result = await ctx.runAction(
                            internal.sms.sendToConversation,
                            {
                              phoneNumber: args.phoneNumber,
                              userId: phoneUser.userId,
                              conversationId: action.args
                                .conversationId as Id<"conversations">,
                              message: action.args.message as string,
                            }
                          );
                          return result as T;
                        }
                        if (action.name === "sms.getConversationStatus") {
                          const result = await ctx.runAction(
                            internal.sms.getConversationStatus,
                            {
                              userId: phoneUser.userId,
                              conversationId: action.args
                                .conversationId as Id<"conversations">,
                              includeHistory: action.args.includeHistory as
                                | boolean
                                | undefined,
                            }
                          );
                          return result as T;
                        }
                        throw new Error(`Unknown action: ${action.name}`);
                      },
                      runQuery: async <T>(
                        query: { name: string; args: Record<string, unknown> },
                        _handler: () => Promise<T>
                      ): Promise<T> => {
                        // Route to actual Convex queries
                        if (query.name === "sms_queries.getUnreadInbox") {
                          const result = await ctx.runQuery(
                            internal.sms_queries.getUnreadInbox,
                            {
                              phoneNumber: args.phoneNumber,
                              limit: 20,
                            }
                          );
                          // Optionally mark as read
                          if (query.args.markAsRead) {
                            await ctx.runMutation(
                              internal.sms_queries.markInboxRead,
                              {
                                phoneNumber: args.phoneNumber,
                              }
                            );
                          }
                          return result as T;
                        }
                        if (
                          query.name === "sms_queries.getConversationsForPhone"
                        ) {
                          const result = await ctx.runQuery(
                            internal.sms_queries.getConversationsForPhone,
                            {
                              phoneNumber: args.phoneNumber,
                              userId: phoneUser.userId,
                              teamId: phoneUser.defaultTeamId,
                              status: query.args.status as
                                | "active"
                                | "completed"
                                | "all"
                                | undefined,
                              limit: 20,
                            }
                          );
                          return result as T;
                        }
                        if (query.name === "sms_queries.searchConversations") {
                          const result = await ctx.runQuery(
                            internal.sms_queries.searchConversations,
                            {
                              userId: phoneUser.userId,
                              teamId: phoneUser.defaultTeamId,
                              query: query.args.query as string,
                              limit: query.args.limit as number | undefined,
                            }
                          );
                          return result as T;
                        }
                        throw new Error(`Unknown query: ${query.name}`);
                      },
                    };

                    return llmService.generateAgentResponse(
                      history,
                      false, // isGroup
                      5, // maxRoundtrips
                      extractAreaCode(args.phoneNumber),
                      sandboxContext,
                      notificationContext // Pass the notification context
                    );
                  }),

                  Effect.tap((result) =>
                    Effect.logInfo("Agent notification response generated", {
                      toolCallCount: result.toolCalls.length,
                      totalSteps: result.totalSteps,
                      tools: result.toolCalls.map((tc) => tc.tool),
                    })
                  ),

                  // 5. Mark notifications as read
                  Effect.flatMap((result) =>
                    pipe(
                      Effect.tryPromise({
                        try: () =>
                          ctx.runMutation(internal.sms_queries.markAllInboxRead, {
                            phoneNumber: args.phoneNumber,
                          }),
                        catch: (error) =>
                          new SendblueError(
                            "Failed to mark inbox read",
                            undefined,
                            error
                          ),
                      }),
                      Effect.map(() => result)
                    )
                  ),

                  // 6. Fallback if agent didn't send anything via send_sms
                  Effect.flatMap((result) => {
                    const sentSms = result.toolCalls.some(
                      (t) => t.tool === "send_sms"
                    );
                    if (!sentSms && notifications.length > 0) {
                      // Agent didn't send a message, send a simple fallback
                      const fallbackMessage =
                        notifications[0].type === "completed"
                          ? `${notifications[0].title || "task"} done 👍`
                          : `${notifications[0].title || "task"}: ${notifications[0].type}`;

                      return pipe(
                        Effect.logInfo("Agent didn't send SMS, using fallback"),
                        Effect.flatMap(() =>
                          Effect.tryPromise({
                            try: () =>
                              ctx.runAction(internal.sms.sendProactiveNotification, {
                                phoneNumber: args.phoneNumber,
                                conversationId: args.conversationId,
                                summary: fallbackMessage,
                              }),
                            catch: (error) =>
                              new SendblueError(
                                "Failed to send fallback notification",
                                undefined,
                                error
                              ),
                          })
                        )
                      );
                    }
                    return Effect.succeed(undefined);
                  }),

                  Effect.catchAll((error) => {
                    if (error instanceof LLMConfigError) {
                      return Effect.logError("LLM config missing", {
                        error: error.message,
                      });
                    }
                    if (error instanceof LLMError) {
                      return Effect.logWarning("Bedrock API failure", {
                        error: error.message,
                      });
                    }
                    return Effect.logWarning("Unknown LLM error", { error });
                  })
                )
              )
            );
          })
        );
      }),

      Effect.catchAll((error) =>
        Effect.logWarning("triggerAgentWithNotification failed", { error })
      )
    );

    await runEffect(program);
  },
});
