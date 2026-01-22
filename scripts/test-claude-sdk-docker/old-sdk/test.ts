import { query } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "node:http";

const CONVEX_PROXY_URL = process.env.CONVEX_PROXY_URL ?? "https://polite-canary-804.convex.site/api/anthropic";
const PROXY_PORT = 19876;

// Create local proxy to intercept and log all requests
const proxyServer = createServer(async (req, res) => {
  console.log("\n========== INTERCEPTED REQUEST ==========");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyString = Buffer.concat(chunks).toString("utf-8");

  if (bodyString) {
    try {
      const bodyJson = JSON.parse(bodyString);
      console.log("Body (summary):", JSON.stringify({
        model: bodyJson.model,
        max_tokens: bodyJson.max_tokens,
        stream: bodyJson.stream,
        messages_count: bodyJson.messages?.length,
        tools: bodyJson.tools?.map((t: { name: string }) => t.name),
      }, null, 2));
      // Log full messages to see what SDK is sending
      console.log("Messages:", JSON.stringify(bodyJson.messages, null, 2));
    } catch {
      console.log("Body (first 500 chars):", bodyString.slice(0, 500));
    }
  }
  console.log("==========================================\n");

  // Forward to actual endpoint
  const targetUrl = `${CONVEX_PROXY_URL}${req.url}`;
  console.log("Forwarding to:", targetUrl);

  try {
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      // Skip host, connection, and accept-encoding (to get uncompressed responses)
      if (key !== "host" && key !== "connection" && key !== "accept-encoding" && value) {
        forwardHeaders[key] = Array.isArray(value) ? value[0] : value;
      }
    }
    // Explicitly request no compression
    forwardHeaders["accept-encoding"] = "identity";

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyString || undefined,
    });

    console.log("Response status:", response.status);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));

    // Forward response headers
    response.headers.forEach((value, key) => {
      if (key !== "transfer-encoding") {
        res.setHeader(key, value);
      }
    });
    res.statusCode = response.status;

    // Capture and log FULL response body while forwarding
    if (response.body) {
      const reader = response.body.getReader();
      let fullResponse = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
        fullResponse += new TextDecoder().decode(value);
      }

      // Parse and display SSE events
      console.log("\n========== FULL SSE RESPONSE ==========");
      const events = fullResponse.split("\n\n").filter(e => e.trim());
      console.log(`Total SSE events: ${events.length}`);
      for (const event of events) {
        const lines = event.split("\n");
        const eventType = lines.find(l => l.startsWith("event:"))?.slice(7) || "unknown";
        const dataLine = lines.find(l => l.startsWith("data:"));
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine.slice(6));
            // Log tool_use blocks in detail
            if (data.type === "content_block_start" && data.content_block?.type === "tool_use") {
              console.log(`\n>>> TOOL_USE BLOCK START <<<`);
              console.log(`  ID: ${data.content_block.id}`);
              console.log(`  Name: ${data.content_block.name}`);
            } else if (data.type === "content_block_delta" && data.delta?.type === "input_json_delta") {
              console.log(`  Input delta: ${data.delta.partial_json?.slice(0, 100)}`);
            } else if (data.type === "message_stop") {
              console.log(`\n>>> MESSAGE_STOP <<<`);
            } else {
              console.log(`[${eventType}] ${data.type || JSON.stringify(data).slice(0, 100)}`);
            }
          } catch {
            console.log(`[${eventType}] (parse error) ${dataLine.slice(0, 100)}`);
          }
        }
      }
      console.log("========================================\n");
    }
    res.end();
  } catch (error) {
    console.error("Proxy error:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  }
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PROXY_PORT}`);
});

console.log("=== Claude Agent SDK Docker Test ===");
console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY);
console.log("ANTHROPIC_BASE_URL:", process.env.ANTHROPIC_BASE_URL);
console.log("CONVEX_PROXY_URL:", CONVEX_PROXY_URL);
console.log("");

// Set env vars for the SDK - point to local proxy
process.env.ANTHROPIC_API_KEY = "sk_placeholder_cmux_anthropic_api_key";
process.env.ANTHROPIC_BASE_URL = `http://localhost:${PROXY_PORT}`;
process.env.CLAUDE_CODE_ENABLE_TELEMETRY = "0";
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
process.env.DEBUG_CLAUDE_AGENT_SDK = "1";

console.log("=== After setting env vars ===");
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
        stderr: (data) => console.error("[stderr]", data.toString()),
        outputFormat: {
          type: "json_schema",
          schema: mathOutputSchema,
        },
      },
    })) {
      console.log(`[${message.type}]`, JSON.stringify(message, null, 2));

      // Exit early on error
      if (message.type === "assistant" && "error" in message) {
        console.log("\n!!! Error detected, stopping !!!");
        break;
      }

      if (message.type === "result") {
        console.log("\n=== DONE ===");
        break;
      }
    }
  } catch (error) {
    console.error("Error:", error);
    proxyServer.close();
    process.exit(1);
  }
  proxyServer.close();
}

main();
