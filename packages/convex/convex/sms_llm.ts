"use node";

import { Effect, pipe } from "effect";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { CLOUDFLARE_OPENAI_BASE_URL } from "@cmux/shared";
import { toBedrockModelId } from "./bedrock_utils";


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

export type OpenAIConfig = {
  apiKey: string;
  baseURL: string;
  modelId: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  promptCacheRetention: "in_memory" | "24h" | null;
};

function parseReasoningEffort(
  value: string | undefined
): OpenAIConfig["reasoningEffort"] {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "default" || normalized === "auto") {
    return undefined;
  }

  switch (normalized) {
    case "none":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return normalized;
  }

  throw new Error(
    `Invalid SMS_OPENAI_REASONING_EFFORT: ${value}. Expected "none", "minimal", "low", "medium", "high", "xhigh", "auto", or "default".`
  );
}

function parsePromptCacheRetention(
  value: string | undefined
): "in_memory" | "24h" | null {
  if (value === undefined) {
    // Default to in-memory caching to avoid relying on model-specific 24h support.
    return "in_memory";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "off" || normalized === "none") {
    return null;
  }
  if (normalized === "in_memory") {
    return "in_memory";
  }
  if (normalized === "24h") {
    return "24h";
  }
  throw new Error(
    `Invalid SMS_OPENAI_PROMPT_CACHE_RETENTION: ${value}. Expected "in_memory", "24h", "off", or "none".`
  );
}

export const getOpenAIConfig = (): Effect.Effect<OpenAIConfig, LLMConfigError> =>
  Effect.try({
    try: () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error("Missing OPENAI_API_KEY");
      }

      const modelId = process.env.SMS_OPENAI_MODEL_ID ?? "gpt-5.2";
      const baseURL = process.env.SMS_OPENAI_BASE_URL ?? CLOUDFLARE_OPENAI_BASE_URL;

      return {
        apiKey,
        baseURL,
        modelId,
        reasoningEffort: parseReasoningEffort(
          process.env.SMS_OPENAI_REASONING_EFFORT
        ),
        promptCacheRetention: parsePromptCacheRetention(
          process.env.SMS_OPENAI_PROMPT_CACHE_RETENTION
        ),
      };
    },
    catch: (error) =>
      new LLMConfigError(
        error instanceof Error ? error.message : "Invalid OpenAI configuration"
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

export type LLMService = {
  generateResponse: (
    messages: ChatMessage[],
    isGroup?: boolean
  ) => Effect.Effect<string, LLMError>;
  generateAgentResponse: (
    messages: ChatMessage[],
    isGroup?: boolean,
    maxToolRoundtrips?: number,
    areaCode?: string | null,
    sandboxContext?: SandboxToolContext | null,
    notificationContext?: string | null
  ) => Effect.Effect<AgentResult, LLMError>;
};

async function sha256Base64Url(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const base64 = Buffer.from(new Uint8Array(digest)).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function buildOpenAIPromptCacheKey(options: {
  systemPrompt: string;
  modelId: string;
  toolNames: string[];
}): Promise<string> {
  const payload = JSON.stringify({
    v: 1,
    systemPrompt: options.systemPrompt,
    modelId: options.modelId,
    toolNames: options.toolNames,
  });
  const hash = await sha256Base64Url(payload);
  return `sms-${hash.slice(0, 40)}`;
}

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
avoid repetition: never send two consecutive messages that are identical or near-identical. if you're about to send a similar status/error update to your last assistant message, rephrase it and add one new detail or next step.
messages from different people are prefixed with their last 4 digits like [1234]: message.
pay attention to who is speaking and respond appropriately to the conversation.`
    : `you are a helpful assistant responding via imessage.
keep responses concise (under 160 characters when possible, max 500).
be conversational and friendly. don't use markdown formatting like *bold* or _italic_ - those render as literal characters in imessage. if you need emphasis, use unicode: 𝗯𝗼𝗹𝗱 or 𝘪𝘵𝘢𝘭𝘪𝘤.
always type in lowercase. no capital letters ever. this is imessage, keep it casual.
don't use emojis.
avoid repetition: never send two consecutive messages that are identical or near-identical. if you're about to send a similar status/error update to your last assistant message, rephrase it and add one new detail or next step.`;

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
- start_agent: start a new coding agent in a sandbox. provider can be claude or codex. if one fails (rate limit / provider down), retry with the other.
- read_inbox: check for updates from your sandbox conversations. shows which conversations have updates.
- send_message: send a follow-up message to an existing conversation.
- get_status: get the current status and last assistant message from a conversation.
- get_port_url: get the public URL for a port on a sandbox. use after starting a server (minecraft, jupyter, web server, etc.) to get the connection URL.
- view_media: see an image or video that the user sent. when you see [image attached: <url>] in a message, always call this tool before responding so you can actually see the image. for videos, returns metadata.
- list_conversations: list recent sandbox conversations (most recent 20).
- search_conversations: search through older conversation history.

RULES:
- be proactive. don't wait for the user to ask for results - send them as soon as they're ready.
- avoid spam. don't send duplicate status updates. if you need to retry or report an error again, change the wording and include one new detail (attempt number, provider used, next step).
- always provide public URLs, never localhost/0.0.0.0/127.0.0.1. use get_port_url to translate sandbox ports to public URLs.
- always report the actual result. never just say "done" or "task done" - tell them what happened.
- don't give up early - keep polling until the task actually completes. tasks can take 30-60 seconds.

WORKFLOW for coding tasks:
1. send_sms to acknowledge ("on it!")
2. start_agent with the task
3. poll get_status until status is "completed"
4. send the actual result to the user via send_sms

WORKFLOW for server tasks (jupyter, minecraft, web server, etc):
1. send_sms to acknowledge ("on it!")
2. start_agent with the task
3. poll get_status until status is "completed"
4. get_port_url to get the public URL (NEVER send internal/localhost URLs)
5. send the public URL to the user via send_sms`
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
  groupId?: string;
  userId: string;
  teamId: string;
  sendReplySms: (content: string, mediaUrl?: string) => Promise<{ success: boolean }>;
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

type SmsLLMProvider = "bedrock" | "openai";
type SmsLLMPreset = "opus_4_6" | "opus_4_5" | "gpt_5_2";

function parseSmsLLMPreset(value: string | undefined): SmsLLMPreset | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();

  if (
    normalized === "" ||
    normalized === "default" ||
    normalized === "auto" ||
    normalized === "none" ||
    normalized === "off"
  ) {
    return null;
  }

  switch (normalized) {
    case "opus_4_6":
    case "opus-4-6":
    case "opus4.6":
      return "opus_4_6";
    case "opus_4_5":
    case "opus-4-5":
    case "opus4.5":
      return "opus_4_5";
    case "gpt_5_2":
    case "gpt-5.2":
    case "gpt5.2":
      return "gpt_5_2";
  }

  throw new Error(
    `Invalid SMS_LLM_PRESET: ${value}. Expected "opus_4_6", "opus_4_5", or "gpt_5_2".`
  );
}

function resolveBedrockSmsModelId(preset: Exclude<SmsLLMPreset, "gpt_5_2">): string {
  if (preset === "opus_4_5") {
    return toBedrockModelId("claude-opus-4-5");
  }
  return toBedrockModelId("claude-opus-4-6");
}

type LLMBackend =
  | {
      provider: "bedrock";
      model: Parameters<typeof generateText>[0]["model"];
      modelId: string;
    }
  | {
      provider: "openai";
      model: Parameters<typeof generateText>[0]["model"];
      modelId: string;
      reasoningEffort: OpenAIConfig["reasoningEffort"];
      promptCacheRetention: OpenAIConfig["promptCacheRetention"];
    };

async function buildSystemOptions(
  backend: LLMBackend,
  systemPrompt: string,
  toolNames: string[]
): Promise<{
  system: Parameters<typeof generateText>[0]["system"];
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
}> {
  if (backend.provider === "bedrock") {
    return {
      system: {
        role: "system",
        content: systemPrompt,
        // Anthropic prompt caching (passed through Bedrock for Claude models).
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
    };
  }

  if (backend.promptCacheRetention === null) {
    return {
      system: systemPrompt,
      providerOptions:
        backend.reasoningEffort === undefined
          ? undefined
          : {
              openai: {
                reasoningEffort: backend.reasoningEffort,
              },
            },
    };
  }

  const promptCacheKey = await buildOpenAIPromptCacheKey({
    systemPrompt,
    modelId: backend.modelId,
    toolNames,
  });

  return {
    system: systemPrompt,
    providerOptions: {
      openai: {
        reasoningEffort: backend.reasoningEffort,
        promptCacheKey,
        promptCacheRetention: backend.promptCacheRetention,
      },
    },
  };
}

const makeLLMServiceFromBackend = (backend: LLMBackend): LLMService => {
  const model = backend.model;

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
          const { system, providerOptions } = await buildSystemOptions(
            backend,
            systemPrompt,
            []
          );
          const textResult = await generateText({
            model,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            system,
            providerOptions,
          });

          if (backend.provider === "openai") {
            console.log("[sms_llm] OpenAI token usage", {
              modelId: backend.modelId,
              promptCacheRetention: backend.promptCacheRetention,
              inputTokens: textResult.usage.inputTokens,
              cacheReadTokens: textResult.usage.inputTokenDetails.cacheReadTokens,
              cacheWriteTokens: textResult.usage.inputTokenDetails.cacheWriteTokens,
              outputTokens: textResult.usage.outputTokens,
              totalTokens: textResult.usage.totalTokens,
            });
          }
          return textResult.text;
        },
        catch: (error) => {
          console.error("LLM API error details:", error);
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
          llmProvider: backend.provider,
          llmModelId: backend.modelId,
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
              const tools: Parameters<typeof generateText>[0]["tools"] & Record<string, unknown> = {
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
                    "Send a message to the user via iMessage. Each text part must be under 400 characters - split longer messages into multiple parts. Each part is sent as a separate message.",
                  inputSchema: z.object({
                    parts: z.array(z.union([
                      z.object({
                        type: z.literal("text"),
                        content: z.string().max(400).describe("Text message content (max 400 chars)"),
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
                    // Validate text parts are under 400 chars (iMessage limit)
                    for (const part of parts) {
                      if (part.type === "text" && part.content.length > 400) {
                        const duration = Date.now() - start;
                        const output = `error: text part is ${part.content.length} chars, max is 400. split into multiple shorter messages.`;
                        toolCalls.push({
                          tool: "send_sms",
                          input: { parts: parts.map(p => p.type === "text" ? { type: "text", content: p.content.slice(0, 50) + "..." } : { type: "image", url: (p as { url: string }).url }) },
                          output,
                          durationMs: duration,
                        });
                        return output;
                      }
                    }

                    // Send each part via context callback (handles group vs individual routing)
                    const results: string[] = [];
                    for (const part of parts) {
                      try {
                        if (part.type === "text") {
                          await sandboxContext.sendReplySms(part.content);
                        } else {
                          await sandboxContext.sendReplySms(part.caption || "", part.url);
                        }
                        results.push(`${part.type} sent`);
                      } catch (error) {
                        results.push(`failed: ${error instanceof Error ? error.message : String(error)}`);
                      }
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

                const startAgentInputSchema = z.object({
                  task: z.string().describe("The task/prompt to give to the agent"),
                  provider: z.enum(["claude", "codex"]).optional().describe("Agent type. If omitted, defaults to claude (or SMS_SANDBOX_AGENT_DEFAULT_PROVIDER) and falls back to the other provider on failure."),
                });

                tools.start_agent = {
                  description:
                    "Start a new coding agent in a sandbox. Use this when user wants help with coding tasks. Provider can be claude or codex.",
                  inputSchema: startAgentInputSchema,
                  execute: async (input: unknown) => {
                    const { task, provider } = startAgentInputSchema.parse(input);
                    const start = Date.now();

                    const attemptProviders: Array<"claude" | "codex"> = (() => {
                      if (provider) return [provider];
                      try {
                        const preferred = parseSandboxAgentDefaultProvider(
                          process.env.SMS_SANDBOX_AGENT_DEFAULT_PROVIDER
                        );
                        return preferred === "claude"
                          ? ["claude", "codex"]
                          : ["codex", "claude"];
                      } catch (error) {
                        console.error(
                          "Invalid SMS_SANDBOX_AGENT_DEFAULT_PROVIDER, defaulting to claude:",
                          error
                        );
                        return ["claude", "codex"];
                      }
                    })();

                    const attemptSummaries: string[] = [];
                    let started: { provider: "claude" | "codex"; conversationId: string } | null = null;

                    for (const attemptProvider of attemptProviders) {
                      try {
                        const result = await sandboxContext.executeAction<StartAgentResult>(
                          {
                            name: "sms.startAgentConversation",
                            args: { task, provider: attemptProvider },
                          },
                          async () => {
                            // This will be replaced by actual action call in the handler
                            return { success: false, error: "Not implemented" };
                          }
                        );

                        if (result.success && result.conversationId) {
                          started = {
                            provider: attemptProvider,
                            conversationId: result.conversationId,
                          };
                          break;
                        }

                        attemptSummaries.push(
                          `${attemptProvider}: ${result.error || "unknown error"}`
                        );
                      } catch (error) {
                        console.error("start_agent failed:", error);
                        attemptSummaries.push(
                          `${attemptProvider}: ${error instanceof Error ? error.message : String(error)}`
                        );
                      }
                    }

                    const duration = Date.now() - start;
                    const output = started
                      ? `started agent! conversation id: ${started.conversationId} (provider: ${started.provider})`
                      : `failed to start agent. tried ${attemptSummaries.join("; ") || "no providers"}`;

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

                tools.get_port_url = {
                  description: "Get the public URL for a port on a sandbox. Use this after starting a server (like Minecraft, Jupyter, web server) to get the URL for users to connect to.",
                  inputSchema: z.object({
                    conversationId: z.string().describe("The conversation ID of the sandbox"),
                    port: z.number().describe("The port number to expose (e.g., 25565 for Minecraft, 8888 for Jupyter, 3000 for web server)"),
                  }),
                  execute: async (input: unknown) => {
                    const { conversationId, port } = input as { conversationId: string; port: number };
                    const start = Date.now();

                    type SandboxInfoResult = {
                      success: boolean;
                      error?: string;
                      provider?: string;
                      instanceId?: string;
                      sandboxUrl?: string;
                    };

                    const result = await sandboxContext.runQuery<SandboxInfoResult>(
                      { name: "sms_queries.getSandboxInfo", args: { conversationId } },
                      async () => {
                        return { success: false, error: "Not implemented" };
                      }
                    );

                    const duration = Date.now() - start;
                    let output: string;

                    if (!result.success) {
                      output = `failed to get sandbox info: ${result.error || "unknown error"}`;
                    } else if (result.provider === "e2b") {
                      // E2B format: {port}-{instanceId}.e2b.app
                      const host = `${port}-${result.instanceId}.e2b.app`;
                      output = `port ${port} is available at:\n- TCP/raw: ${host}:${port}\n- HTTPS: https://${host}`;
                    } else if (result.provider === "morph") {
                      // Morph format: port-{port}-{instanceId}.http.cloud.morph.so
                      const host = `port-${port}-${result.instanceId}.http.cloud.morph.so`;
                      output = `port ${port} is available at:\n- HTTPS: https://${host}`;
                    } else {
                      output = `unsupported provider: ${result.provider}`;
                    }

                    toolCalls.push({
                      tool: "get_port_url",
                      input: { conversationId, port },
                      output,
                      durationMs: duration,
                    });

                    return output;
                  },
                };

                tools.view_media = {
                  description:
                    "View an image or video that was attached to a message. Returns the actual image so you can see it. Use when you see [image attached: <url>] in a message.",
                  inputSchema: z.object({
                    url: z.string().url().describe("The media URL from the [image attached: <url>] annotation"),
                  }),
                  execute: async (input: unknown) => {
                    const parsed = z.object({ url: z.string().url() }).safeParse(input);
                    if (!parsed.success) {
                      const output = `invalid input: ${parsed.error.message}`;
                      toolCalls.push({
                        tool: "view_media",
                        input,
                        output,
                        durationMs: 0,
                      });
                      return output;
                    }

                    const { url } = parsed.data;
                    const start = Date.now();

                    try {
                      const response = await fetch(url);
                      if (!response.ok) {
                        const output = `error fetching media: ${response.status} ${response.statusText}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      const contentTypeHeader =
                        response.headers.get("content-type") ||
                        "application/octet-stream";
                      const mediaType = contentTypeHeader
                        .split(";")[0]
                        .trim()
                        .toLowerCase();

                      if (mediaType.startsWith("video/")) {
                        const contentLength = response.headers.get("content-length");
                        const output = `video (${mediaType}, ${contentLength ? Math.round(Number(contentLength) / 1024) + "KB" : "unknown size"}). url: ${url}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      if (!mediaType.startsWith("image/")) {
                        const output = `unsupported media type (${mediaType}). url: ${url}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      const supportedImageTypes = new Set([
                        "image/jpeg",
                        "image/png",
                        "image/gif",
                        "image/webp",
                      ]);
                      if (!supportedImageTypes.has(mediaType)) {
                        const output = `unsupported image type (${mediaType}). please resend as jpg/png/gif/webp. url: ${url}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      const maxBytes = 5 * 1024 * 1024; // 5MB
                      const contentLengthHeader = response.headers.get("content-length");
                      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;

                      if (contentLength !== null && Number.isFinite(contentLength) && contentLength > maxBytes) {
                        const output = `image too large (${Math.round(contentLength / 1024)}KB). url: ${url}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      // Image — read bytes, convert to base64
                      const arrayBuffer = await response.arrayBuffer();
                      if (arrayBuffer.byteLength > maxBytes) {
                        const output = `image too large (${Math.round(arrayBuffer.byteLength / 1024)}KB). url: ${url}`;
                        toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: Date.now() - start });
                        return output;
                      }

                      const base64 = Buffer.from(arrayBuffer).toString("base64");
                      const duration = Date.now() - start;
                      toolCalls.push({
                        tool: "view_media",
                        input: { url },
                        output: `[image ${mediaType} ${Math.round(arrayBuffer.byteLength / 1024)}KB]`,
                        durationMs: duration,
                      });

                      return { type: "image" as const, data: base64, mediaType };
                    } catch (error) {
                      console.error("view_media failed:", error);
                      const duration = Date.now() - start;
                      const output = `error fetching media: ${error instanceof Error ? error.message : String(error)}`;
                      toolCalls.push({ tool: "view_media", input: { url }, output, durationMs: duration });
                      return output;
                    }
                  },
                  toModelOutput({ output }: { output: string | { type: "image"; data: string; mediaType: string } }) {
                    if (typeof output === "string") {
                      return { type: "content" as const, value: [{ type: "text" as const, text: output }] };
                    }
                    return {
                      type: "content" as const,
                      value: [{ type: "media" as const, data: output.data, mediaType: output.mediaType }],
                    };
                  },
                };
              }

              const toolNames = Object.keys(tools).sort();
              const { system, providerOptions } = await buildSystemOptions(
                backend,
                systemPrompt,
                toolNames
              );

              const textResult = await generateText({
                model,
                messages: messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                })),
                system,
                providerOptions,
                tools,
                stopWhen: stepCountIs(maxToolRoundtrips),
              });

              if (backend.provider === "openai") {
                console.log("[sms_llm] OpenAI token usage (agent)", {
                  modelId: backend.modelId,
                  promptCacheRetention: backend.promptCacheRetention,
                  inputTokens: textResult.usage.inputTokens,
                  cacheReadTokens: textResult.usage.inputTokenDetails.cacheReadTokens,
                  cacheWriteTokens: textResult.usage.inputTokenDetails.cacheWriteTokens,
                  outputTokens: textResult.usage.outputTokens,
                  totalTokens: textResult.usage.totalTokens,
                });
              }

              return {
                text: textResult.text,
                toolCalls,
                totalSteps: textResult.steps.length,
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

export const makeLLMService = (config: BedrockConfig): LLMService => {
  const bedrock = createAmazonBedrock({
    region: config.region,
    apiKey: config.bearerToken,
  });

  // Use US cross-region inference profile for higher throughput quotas.
  // Default: Opus 4.6 (can be overridden by SMS_LLM_PRESET).
  const modelId = resolveBedrockSmsModelId("opus_4_6");
  const model = bedrock(modelId);

  return makeLLMServiceFromBackend({ provider: "bedrock", model, modelId });
};

export const makeOpenAILLMService = (config: OpenAIConfig): LLMService => {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const model = openai(config.modelId);

  return makeLLMServiceFromBackend({
    provider: "openai",
    model,
    modelId: config.modelId,
    reasoningEffort: config.reasoningEffort,
    promptCacheRetention: config.promptCacheRetention,
  });
};

function parseSandboxAgentDefaultProvider(
  value: string | undefined
): "claude" | "codex" {
  if (value === undefined) return "claude";
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "claude") return "claude";
  if (normalized === "codex") return "codex";
  throw new Error(
    `Invalid SMS_SANDBOX_AGENT_DEFAULT_PROVIDER: ${value}. Expected "claude" or "codex".`
  );
}

function parseSmsLLMProvider(value: string | undefined): SmsLLMProvider {
  if (value === undefined) return "bedrock";
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "bedrock") return "bedrock";
  if (normalized === "openai") return "openai";
  throw new Error(
    `Invalid SMS_LLM_PROVIDER: ${value}. Expected "bedrock" or "openai".`
  );
}

/**
 * Provider/model switch flag for SMS agent:
 * - SMS_LLM_PRESET=opus_4_6|opus_4_5|gpt_5_2 (optional; overrides SMS_LLM_PROVIDER + model selection)
 * - SMS_LLM_PROVIDER=openai|bedrock (default: bedrock)
 * - SMS_OPENAI_MODEL_ID=gpt-5.2 (default: gpt-5.2)
 * - SMS_OPENAI_REASONING_EFFORT=none|minimal|low|medium|high|xhigh|auto|default (default: auto)
 * - SMS_OPENAI_PROMPT_CACHE_RETENTION=in_memory|24h|off|none (default: in_memory)
 * - SMS_SANDBOX_AGENT_DEFAULT_PROVIDER=claude|codex (default: claude)
 */
export const getSmsLLMService = (): Effect.Effect<LLMService, LLMConfigError> =>
  pipe(
    Effect.try({
      try: () => ({
        preset: parseSmsLLMPreset(process.env.SMS_LLM_PRESET),
        provider: parseSmsLLMProvider(process.env.SMS_LLM_PROVIDER),
      }),
      catch: (error) =>
        new LLMConfigError(
          error instanceof Error ? error.message : "Invalid SMS LLM provider"
        ),
    }),
    Effect.flatMap(({ preset, provider }) => {
      if (preset === "gpt_5_2" || (preset === null && provider === "openai")) {
        return pipe(
          getOpenAIConfig(),
          Effect.map((config) =>
            makeOpenAILLMService({
              ...config,
              modelId: preset === "gpt_5_2" ? "gpt-5.2" : config.modelId,
            })
          )
        );
      }

      const bedrockModelId =
        preset === "opus_4_5" || preset === "opus_4_6"
          ? resolveBedrockSmsModelId(preset)
          : resolveBedrockSmsModelId("opus_4_6");

      return pipe(
        getBedrockConfig(),
        Effect.map((config) => {
          const bedrock = createAmazonBedrock({
            region: config.region,
            apiKey: config.bearerToken,
          });
          const model = bedrock(bedrockModelId);
          return makeLLMServiceFromBackend({
            provider: "bedrock",
            model,
            modelId: bedrockModelId,
          });
        })
      );
    })
  );
