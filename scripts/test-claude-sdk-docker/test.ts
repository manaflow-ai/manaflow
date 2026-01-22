import { query } from "@anthropic-ai/claude-agent-sdk";

const CONVEX_PROXY_URL = process.env.CONVEX_PROXY_URL ?? "https://adorable-wombat-701.convex.site/api/anthropic";

console.log("=== Claude Agent SDK Docker Test ===");
console.log("Talking directly to Convex (no local proxy)");
console.log("CONVEX_PROXY_URL:", CONVEX_PROXY_URL);
console.log("");

// Set env vars for the SDK - point directly to Convex
process.env.ANTHROPIC_API_KEY = "sk_placeholder_cmux_anthropic_api_key";
process.env.ANTHROPIC_BASE_URL = CONVEX_PROXY_URL;
process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "0";
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";

console.log("=== Env vars set ===");
console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY);
console.log("ANTHROPIC_BASE_URL:", process.env.ANTHROPIC_BASE_URL);
console.log("");

const mathOutputSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["expression", "result", "explanation"],
  properties: {
    expression: { type: "string" },
    result: { type: "number" },
    explanation: { type: "string" },
  },
} as const;

async function main() {
  console.log("Starting Claude Agent SDK query...\n");

  try {
    for await (const message of query({
      prompt: "What is 2 + 2? Reply with just the number.",
      options: {
        model: "claude-opus-4-5",
        maxTurns: 5,
        allowDangerouslySkipPermissions: true,
        permissionMode: "bypassPermissions",
        env: process.env as Record<string, string>,
        outputFormat: {
          type: "json_schema",
          schema: mathOutputSchema,
        },
      },
    })) {
      console.log(`[${message.type}]`, JSON.stringify(message, null, 2));

      if (message.type === "result") {
        console.log("\n=== SUCCESS ===");
        break;
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
