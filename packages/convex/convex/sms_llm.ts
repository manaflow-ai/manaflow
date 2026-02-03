import { Effect, pipe } from "effect";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";

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

const buildSystemPrompt = (isGroup: boolean, areaCode: string | null): string => {
  const basePrompt = isGroup
    ? `you are a helpful assistant in a group imessage chat.
keep responses concise (under 160 characters when possible, max 500).
be conversational and friendly. don't use markdown formatting.
always type in lowercase. no capital letters ever. this is imessage, keep it casual.
messages from different people are prefixed with their last 4 digits like [1234]: message.
pay attention to who is speaking and respond appropriately to the conversation.`
    : `you are a helpful assistant responding via imessage.
keep responses concise (under 160 characters when possible, max 500).
be conversational and friendly. don't use markdown formatting.
always type in lowercase. no capital letters ever. this is imessage, keep it casual.`;

  const toolsPrompt = `

you have access to a bash tool for looking things up. use it when helpful but don't overuse it.
available commands: echo, date, whoami, pwd, ls, cat, weather, calc, help`;

  const areaCodeContext = areaCode
    ? `

context: the user's phone area code is ${areaCode}. use this to infer their approximate location/timezone when relevant (e.g., 949 = orange county ca = pacific time, 212 = nyc = eastern time).`
    : "";

  return basePrompt + toolsPrompt + areaCodeContext;
};

// Legacy prompts for simple response (no area code)
const SYSTEM_PROMPT = buildSystemPrompt(false, null);
const GROUP_SYSTEM_PROMPT = buildSystemPrompt(true, null);

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
      areaCode: string | null = null
    ): Effect.Effect<AgentResult, LLMError> =>
      pipe(
        Effect.logInfo("Agent loop started", {
          messageCount: messages.length,
          isGroup,
          maxToolRoundtrips,
          areaCode,
        }),
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: async () => {
              const toolCalls: ToolCall[] = [];
              const systemPrompt = buildSystemPrompt(isGroup, areaCode);

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
                tools: {
                  bash: {
                    description:
                      "Execute bash commands in a sandboxed environment. Available: echo, date, whoami, pwd, ls, cat, weather, calc, help",
                    inputSchema: z.object({
                      command: z.string().describe("The bash command to execute"),
                    }),
                    execute: async ({ command }: { command: string }) => {
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
                },
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
