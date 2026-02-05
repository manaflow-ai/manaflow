import { Effect, pipe } from "effect";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { getSendblueConfig, makeSendblueService } from "./sendblue";

// ============= Errors =============

export class LLMError {
  readonly _tag = "LLMError";
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

export class LLMConfigError {
  readonly _tag = "LLMConfigError";
  constructor(readonly message: string) {}
}

export class ToolExecutionError {
  readonly _tag = "ToolExecutionError";
  readonly message: string;
  constructor(
    readonly toolName: string,
    readonly command: string,
    readonly cause?: unknown
  ) {
    this.message = `Tool ${toolName} failed executing: ${command}`;
  }
}

// ============= Config =============

export type BedrockConfig = {
  bearerToken: string;
  region: string;
};

export const getBedrockConfig = (): Effect.Effect<BedrockConfig, LLMConfigError> =>
  Effect.try({
    try: () => {
      const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
      const region = process.env.AWS_REGION ?? "us-east-1";

      if (!bearerToken) {
        throw new Error("Missing AWS_BEARER_TOKEN_BEDROCK");
      }

      return { bearerToken, region };
    },
    catch: (error) =>
      new LLMConfigError(
        error instanceof Error ? error.message : "Invalid Bedrock configuration"
      ),
  });

// ============= Types =============

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ToolCall = {
  tool: string;
  input: unknown;
  output: string;
  durationMs: number;
};

export type AgentResult = {
  text: string;
  toolCalls: ToolCall[];
  totalSteps: number;
};

// ============= Fake Bash Tool =============

type BashResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const executeFakeBash = (command: string): BashResult => {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  switch (cmd) {
    case "echo":
      return { stdout: args.join(" ") + "\n", stderr: "", exitCode: 0 };

    case "date":
      return { stdout: new Date().toISOString() + "\n", stderr: "", exitCode: 0 };

    case "whoami":
      return { stdout: "sms-agent\n", stderr: "", exitCode: 0 };

    case "pwd":
      return { stdout: "/home/sms-agent\n", stderr: "", exitCode: 0 };

    case "ls":
      return {
        stdout: "notes.txt\nreminders.txt\ncontacts.txt\n",
        stderr: "",
        exitCode: 0,
      };

    case "cat":
      if (args[0] === "notes.txt") {
        return { stdout: "remember to be helpful and friendly!\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "reminders.txt") {
        return { stdout: "(no reminders set)\n", stderr: "", exitCode: 0 };
      }
      if (args[0] === "contacts.txt") {
        return { stdout: "(contacts are private)\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: `cat: ${args[0]}: No such file or directory\n`, exitCode: 1 };

    case "weather":
    case "curl": {
      // Fake weather API
      if (command.includes("weather") || command.includes("wttr")) {
        return {
          stdout: "currently 72°F, partly cloudy in your area\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "curl: network requests disabled in sandbox\n", exitCode: 1 };
    }

    case "calc":
    case "bc": {
      // Simple calculator
      const expr = args.join("");
      try {
        // Safe eval for basic math only
        const sanitized = expr.replace(/[^0-9+\-*/().]/g, "");
        if (sanitized !== expr) {
          return { stdout: "", stderr: "calc: invalid expression\n", exitCode: 1 };
        }
        const result = Function(`"use strict"; return (${sanitized})`)();
        return { stdout: `${result}\n`, stderr: "", exitCode: 0 };
      } catch {
        return { stdout: "", stderr: "calc: invalid expression\n", exitCode: 1 };
      }
    }

    case "help":
      return {
        stdout: `available commands:
  echo <text>     - print text
  date            - show current date/time
  whoami          - show current user
  pwd             - print working directory
  ls              - list files
  cat <file>      - show file contents
  weather         - get weather info
  calc <expr>     - calculate expression
  help            - show this help
`,
        stderr: "",
        exitCode: 0,
      };

    default:
      return {
        stdout: "",
        stderr: `bash: ${cmd}: command not found\n`,
        exitCode: 127,
      };
  }
};

// ============= Effect-wrapped Tool Execution =============

const executeToolWithEffect = (
  toolName: string,
  command: string
): Effect.Effect<string, ToolExecutionError> =>
  pipe(
    Effect.logInfo("Tool execution started", { tool: toolName, command }),
    Effect.flatMap(() =>
      Effect.sync(() => {
        const start = Date.now();
        const result = executeFakeBash(command);
        const duration = Date.now() - start;
        return { result, duration };
      })
    ),
    Effect.tap(({ result, duration }) =>
      Effect.logInfo("Tool execution completed", {
        tool: toolName,
        command,
        exitCode: result.exitCode,
        durationMs: duration,
        hasStdout: result.stdout.length > 0,
        hasStderr: result.stderr.length > 0,
      })
    ),
    Effect.map(({ result }) => {
      if (result.exitCode !== 0) {
        return result.stderr || `Command failed with exit code ${result.exitCode}`;
      }
      return result.stdout || "(no output)";
    }),
    Effect.catchAll((error) =>
      Effect.fail(new ToolExecutionError(toolName, command, error))
    )
  );

// ============= System Prompts =============

const buildSystemPrompt = (isGroup: boolean, areaCode: string | null, hasSandboxTools: boolean): string => {
  const basePrompt = isGroup
    ? `you are a helpful assistant in a group imessage chat.
keep responses concise (under 160 characters when possible, max 500).
be conversational and friendly. don't use markdown formatting like *bold* or _italic_ - those render as literal characters in imessage. if you need emphasis, use unicode: 𝗯𝗼𝗹𝗱 or 𝘪𝘵𝘢𝘭𝘪𝘤.
always type in lowercase. no capital letters ever. this is imessage, keep it casual.
don't use emojis.
messages from different people are prefixed with their last 4 digits like [1234]: message.
pay attention to who is speaking and respond appropriately to the conversation.`
    : `you are a helpful assistant responding via imessage.
keep responses concise (under 160 characters when possible, max 500).
be conversational and friendly. don't use markdown formatting like *bold* or _italic_ - those render as literal characters in imessage. if you need emphasis, use unicode: 𝗯𝗼𝗹𝗱 or 𝘪𝘵𝘢𝘭𝘪𝘤.
always type in lowercase. no capital letters ever. this is imessage, keep it casual.
don't use emojis.`;

  const bashToolsPrompt = `

you have access to a bash tool for looking things up. use it when helpful but don't overuse it.
available commands: echo, date, whoami, pwd, ls, cat, weather, calc, help`;

  const sandboxToolsPrompt = hasSandboxTools
    ? `

you have a send_sms tool to send messages during your work:
- send_sms: send text or images to the user. use this to send progress updates, share screenshots/results, or send multiple messages.
  parts can be: { type: "text", content: "..." } or { type: "image", url: "...", caption?: "..." }

use send_sms when you need to:
- send an acknowledgment before doing work ("on it!")
- share an image or screenshot
- send updates during a long task

you can also help with coding tasks using sandbox tools:
- start_agent: start a new coding agent in a sandbox. use this when user wants help with coding/development tasks.
- read_inbox: check for updates from your sandbox conversations. shows which conversations have updates.
- send_message: send a follow-up message to an existing conversation.
- get_status: get the current status and last assistant message from a conversation.
- list_conversations: list recent sandbox conversations (most recent 20).
- search_conversations: search through older conversation history.

IMPORTANT: when the user asks for coding help, use send_sms first to acknowledge ("on it, give me a sec"), then call start_agent. this makes the experience feel more responsive.

check read_inbox periodically or when user asks about task status.
use get_status to see full details and the agent's response.`
    : "";

  const areaCodeContext = areaCode
    ? `

context: the user's phone area code is ${areaCode}. use this to infer their approximate location/timezone when relevant (e.g., 949 = orange county ca = pacific time, 212 = nyc = eastern time).`
    : "";

  return basePrompt + bashToolsPrompt + sandboxToolsPrompt + areaCodeContext;
};

// Legacy prompts for simple response (no area code, no sandbox tools)
const SYSTEM_PROMPT = buildSystemPrompt(false, null, false);
const GROUP_SYSTEM_PROMPT = buildSystemPrompt(true, null, false);

// ============= Sandbox Tool Context =============

// Result types for sandbox tool operations
export type StartAgentResult = {
  success: boolean;
  conversationId?: string;
  error?: string;
};

export type SendToConversationResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

export type GetConversationStatusResult = {
  success: boolean;
  status?: string;
  title?: string;
  lastAssistantMessage?: string;
  history?: Array<{ role: string; content: string }>;
  error?: string;
};

export type InboxItem = {
  conversationId: string;
  type: string;
  summary: string;
};

export type ConversationItem = {
  _id: string;
  status: string;
  title?: string;
};

export type SandboxToolContext = {
  phoneNumber: string;
  userId: string;
  teamId: string;
  executeAction: <T>(
    action: { name: string; args: Record<string, unknown> },
    handler: () => Promise<T>
  ) => Promise<T>;
  runQuery: <T>(
    query: { name: string; args: Record<string, unknown> },
    handler: () => Promise<T>
  ) => Promise<T>;
};

// ============= LLM Service =============

export const makeLLMService = (config: BedrockConfig) => {
  const bedrock = createAmazonBedrock({
    region: config.region,
    apiKey: config.bearerToken,
  });

  // Use cross-region inference profile (required for on-demand throughput)
  const model = bedrock("global.anthropic.claude-opus-4-5-20251101-v1:0");

  return {
    /**
     * Simple response generation (no tools)
     */
    generateResponse: (
      messages: ChatMessage[],
      isGroup = false
    ): Effect.Effect<string, LLMError> =>
      Effect.tryPromise({
        try: async () => {
          const systemPrompt = isGroup ? GROUP_SYSTEM_PROMPT : SYSTEM_PROMPT;
          const { text } = await generateText({
            model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            // Use Anthropic's prompt caching for the system prompt
            system: {
              role: "system",
              content: systemPrompt,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
              },
            },
          });
          return text;
        },
        catch: (error) => {
          console.error("Bedrock API error details:", error);
          return new LLMError("Failed to generate LLM response", error);
        },
      }),

    /**
     * Agent loop with tool access
     */
    generateAgentResponse: (
      messages: ChatMessage[],
      isGroup = false,
      maxToolRoundtrips = 5,
      areaCode: string | null = null,
      sandboxContext: SandboxToolContext | null = null,
      notificationContext: string | null = null
    ): Effect.Effect<AgentResult, LLMError> =>
      pipe(
        Effect.logInfo("Agent loop started", {
          messageCount: messages.length,
          isGroup,
          maxToolRoundtrips,
          areaCode,
          hasSandboxTools: sandboxContext !== null,
        }),
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: async () => {
              const toolCalls: ToolCall[] = [];
              const hasSandboxTools = sandboxContext !== null;
              let systemPrompt = buildSystemPrompt(isGroup, areaCode, hasSandboxTools);

              // Prepend notification context if provided (for proactive notifications)
              if (notificationContext) {
                systemPrompt = notificationContext + "\n\n---\n\n" + systemPrompt;
              }

              // Build tools object
              const tools: Record<string, {
                description: string;
                inputSchema: z.ZodType<unknown>;
                execute: (input: unknown) => Promise<string>;
              }> = {
                bash: {
                  description:
                    "Execute bash commands in a sandboxed environment. Available: echo, date, whoami, pwd, ls, cat, weather, calc, help",
                  inputSchema: z.object({
                    command: z.string().describe("The bash command to execute"),
                  }),
                  execute: async (input: unknown) => {
                    const { command } = input as { command: string };
                    const start = Date.now();

                    // Run the Effect and get the result
                    const output = await Effect.runPromise(
                      pipe(
                        executeToolWithEffect("bash", command),
                        Effect.catchAll((error) =>
                          Effect.succeed(`Error: ${error.message}`)
                        )
                      )
                    );

                    const duration = Date.now() - start;
                    toolCalls.push({
                      tool: "bash",
                      input: command,
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                },
              };

              // Add sandbox tools if context is available
              if (sandboxContext) {
                // Add send_sms tool when we have sandbox context (which includes phone number)
                tools.send_sms = {
                  description:
                    "Send a message to the user. Use this to send updates during long tasks, share images, or send multiple messages. Each part is sent as a separate message.",
                  inputSchema: z.object({
                    parts: z.array(z.union([
                      z.object({
                        type: z.literal("text"),
                        content: z.string().describe("Text message content"),
                      }),
                      z.object({
                        type: z.literal("image"),
                        url: z.string().url().describe("Public URL of the image"),
                        caption: z.string().optional().describe("Optional caption for the image"),
                      }),
                    ])).describe("Message parts to send - can mix text and images"),
                  }),
                  execute: async (input: unknown) => {
                    const { parts } = input as {
                      parts: Array<
                        | { type: "text"; content: string }
                        | { type: "image"; url: string; caption?: string }
                      >;
                    };
                    const start = Date.now();
                    // Use the phone number from sandbox context
                    const toNumber = sandboxContext.phoneNumber;

                    // Send each part as a separate message
                    const results: string[] = [];
                    for (const part of parts) {
                      const result = await Effect.runPromise(
                        pipe(
                          getSendblueConfig(),
                          Effect.flatMap(makeSendblueService),
                          Effect.flatMap((service) => {
                            if (part.type === "text") {
                              return service.sendMessage({
                                toNumber,
                                content: part.content,
                              });
                            } else {
                              return service.sendMessage({
                                toNumber,
                                content: part.caption || "",
                                mediaUrl: part.url,
                              });
                            }
                          }),
                          Effect.map(() => `${part.type} sent`),
                          Effect.catchAll((error) =>
                            Effect.succeed(`failed: ${error instanceof Error ? error.message : String(error)}`)
                          )
                        )
                      );
                      results.push(result);
                    }

                    const duration = Date.now() - start;
                    const output = results.join(", ");
                    toolCalls.push({
                      tool: "send_sms",
                      input: { parts: parts.map(p => p.type === "text" ? { type: "text", content: p.content.slice(0, 50) + (p.content.length > 50 ? "..." : "") } : { type: "image", url: p.url }) },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.start_agent = {
                  description: "Start a new coding agent in a sandbox. Use this when user wants help with coding tasks.",
                  inputSchema: z.object({
                    task: z.string().describe("The task/prompt to give to the agent"),
                    provider: z.enum(["claude", "codex"]).optional().describe("Agent type, defaults to claude"),
                  }),
                  execute: async (input: unknown) => {
                    const { task, provider } = input as { task: string; provider?: "claude" | "codex" };
                    const start = Date.now();

                    const result = await sandboxContext.executeAction<StartAgentResult>(
                      { name: "sms.startAgentConversation", args: { task, provider } },
                      async () => {
                        // This will be replaced by actual action call in the handler
                        return { success: false, error: "Not implemented" };
                      }
                    );

                    const duration = Date.now() - start;
                    const output = result.success && result.conversationId
                      ? `started agent! conversation id: ${result.conversationId}`
                      : `failed to start agent: ${result.error || "unknown error"}`;

                    toolCalls.push({
                      tool: "start_agent",
                      input: { task, provider },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.read_inbox = {
                  description: "Check for updates from your sandbox conversations. Shows which conversations have updates.",
                  inputSchema: z.object({
                    markAsRead: z.boolean().optional().describe("Mark items as read after showing"),
                  }),
                  execute: async (input: unknown) => {
                    const { markAsRead } = input as { markAsRead?: boolean };
                    const start = Date.now();

                    const result = await sandboxContext.runQuery<InboxItem[]>(
                      { name: "sms_queries.getUnreadInbox", args: { markAsRead } },
                      async () => {
                        // This will be replaced by actual query call in the handler
                        return [];
                      }
                    );

                    const duration = Date.now() - start;
                    const output = result.length === 0
                      ? "no new updates"
                      : result.map((item) =>
                          `[${item.type}] ${item.conversationId}: ${item.summary}`
                        ).join("\n");

                    toolCalls.push({
                      tool: "read_inbox",
                      input: { markAsRead },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.send_message = {
                  description: "Send a follow-up message to a sandbox conversation",
                  inputSchema: z.object({
                    conversationId: z.string().describe("The conversation ID to message"),
                    message: z.string().describe("The message to send"),
                  }),
                  execute: async (input: unknown) => {
                    const { conversationId, message } = input as { conversationId: string; message: string };
                    const start = Date.now();

                    const result = await sandboxContext.executeAction<SendToConversationResult>(
                      { name: "sms.sendToConversation", args: { conversationId, message } },
                      async () => {
                        return { success: false, error: "Not implemented" };
                      }
                    );

                    const duration = Date.now() - start;
                    const output = result.success
                      ? "message sent!"
                      : `failed to send: ${result.error || "unknown error"}`;

                    toolCalls.push({
                      tool: "send_message",
                      input: { conversationId, message },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.get_status = {
                  description: "Get the current status and last assistant message from a sandbox conversation",
                  inputSchema: z.object({
                    conversationId: z.string().describe("The conversation ID to check"),
                    includeHistory: z.boolean().optional().describe("Include recent message history"),
                  }),
                  execute: async (input: unknown) => {
                    const { conversationId, includeHistory } = input as { conversationId: string; includeHistory?: boolean };
                    const start = Date.now();

                    const result = await sandboxContext.executeAction<GetConversationStatusResult>(
                      { name: "sms.getConversationStatus", args: { conversationId, includeHistory } },
                      async () => {
                        return { success: false, error: "Not implemented" };
                      }
                    );

                    const duration = Date.now() - start;
                    let output: string;
                    if (!result.success) {
                      output = `failed to get status: ${result.error || "unknown error"}`;
                    } else {
                      const parts = [`status: ${result.status || "unknown"}`];
                      if (result.title) parts.push(`title: ${result.title}`);
                      if (result.lastAssistantMessage) {
                        parts.push(`last message: ${result.lastAssistantMessage}`);
                      }
                      output = parts.join("\n");
                    }

                    toolCalls.push({
                      tool: "get_status",
                      input: { conversationId, includeHistory },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.list_conversations = {
                  description: "List your recent sandbox conversations (most recent 20)",
                  inputSchema: z.object({
                    status: z.enum(["active", "completed", "all"]).optional().describe("Filter by status"),
                  }),
                  execute: async (input: unknown) => {
                    const { status } = input as { status?: "active" | "completed" | "all" };
                    const start = Date.now();

                    const result = await sandboxContext.runQuery<ConversationItem[]>(
                      { name: "sms_queries.getConversationsForPhone", args: { status } },
                      async () => {
                        return [];
                      }
                    );

                    const duration = Date.now() - start;
                    const output = result.length === 0
                      ? "no conversations found"
                      : result.map((conv) =>
                          `${conv._id}: [${conv.status}] ${conv.title || "(untitled)"}`
                        ).join("\n");

                    toolCalls.push({
                      tool: "list_conversations",
                      input: { status },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.search_conversations = {
                  description: "Search through your conversation history",
                  inputSchema: z.object({
                    query: z.string().describe("Search query to find conversations"),
                    limit: z.number().optional().describe("Maximum results to return"),
                  }),
                  execute: async (input: unknown) => {
                    const { query, limit } = input as { query: string; limit?: number };
                    const start = Date.now();

                    const result = await sandboxContext.runQuery<ConversationItem[]>(
                      { name: "sms_queries.searchConversations", args: { query, limit } },
                      async () => {
                        return [];
                      }
                    );

                    const duration = Date.now() - start;
                    const output = result.length === 0
                      ? "no matching conversations found"
                      : result.map((conv) =>
                          `${conv._id}: [${conv.status}] ${conv.title || "(untitled)"}`
                        ).join("\n");

                    toolCalls.push({
                      tool: "search_conversations",
                      input: { query, limit },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };
              }

              const { text, steps } = await generateText({
                model,
                messages: messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
                // Use Anthropic's prompt caching for the system prompt
                system: {
                  role: "system",
                  content: systemPrompt,
                  providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral" } },
                  },
                },
                tools,
                stopWhen: stepCountIs(maxToolRoundtrips),
              });

              return {
                text,
                toolCalls,
                totalSteps: steps.length,
              };
            },
            catch: (error) => {
              console.error("Agent loop error:", error);
              return new LLMError("Failed to run agent loop", error);
            },
          })
        ),
        Effect.tap((result) =>
          Effect.logInfo("Agent loop completed", {
            textLength: result.text.length,
            toolCallCount: result.toolCalls.length,
            totalSteps: result.totalSteps,
          })
        )
      ),
  };
};
