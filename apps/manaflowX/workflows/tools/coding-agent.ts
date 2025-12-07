import { tool } from "ai";
import { z } from "zod";
import { MorphCloudClient } from "morphcloud";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

// =============================================================================
// JWT Helper Functions
// =============================================================================

function base64urlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const x = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += abc[(x >> 18) & 63];
    out += abc[(x >> 12) & 63];
    out += abc[(x >> 6) & 63];
    out += abc[x & 63];
  }
  if (i + 1 === bytes.length) {
    const x = bytes[i]! << 16;
    out += abc[(x >> 18) & 63];
    out += abc[(x >> 12) & 63];
  } else if (i < bytes.length) {
    const x = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += abc[(x >> 18) & 63];
    out += abc[(x >> 12) & 63];
    out += abc[(x >> 6) & 63];
  }
  return out;
}

async function createJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signatureInput = `${headerB64}.${payloadB64}`;

  // HMAC-SHA256 signature
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(signatureInput));
  const signatureB64 = base64urlEncode(new Uint8Array(signature));

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

// Initialize Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// =============================================================================
// Coding Agent Tool - Delegates tasks to OpenCode running in Morph VMs
// =============================================================================

// Load VM snapshot configuration
function loadVmSnapshots() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const snapshotsPath = join(__dirname, "../../sandbox/vm-snapshots.json");
  return JSON.parse(readFileSync(snapshotsPath, "utf-8"));
}

// Get the latest snapshot ID
function getLatestSnapshotId(): string {
  const snapshotsData = loadVmSnapshots();
  const preset = snapshotsData.presets[0];
  const latestVersion = preset.versions[preset.versions.length - 1];
  return latestVersion.snapshotId;
}

// Spawn a Morph VM instance and return the OpenCode URL
async function spawnCodingVM(options?: {
  onReady?: (instance: { exec: (cmd: string) => Promise<{ stdout: string; stderr: string }> }) => Promise<void>;
}): Promise<{
  instanceId: string;
  url: string;
  cleanup: () => Promise<void>;
}> {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY environment variable is required");
  }

  const client = new MorphCloudClient({ apiKey });
  const snapshotId = getLatestSnapshotId();

  console.log(`[coding-agent] Starting VM from snapshot: ${snapshotId}`);
  const instance = await client.instances.start({ snapshotId });
  console.log(`[coding-agent] Instance created: ${instance.id}`);

  console.log(`[coding-agent] Waiting for instance to be ready...`);
  await instance.waitUntilReady(60); // Wait up to 60 seconds

  // Run onReady callback if provided (e.g., to write config files)
  if (options?.onReady) {
    await options.onReady(instance);
  }

  const service = instance.networking.httpServices.find(
    (s) => s.name === "port-4096"
  );

  if (!service) {
    await client.instances.stop({ instanceId: instance.id });
    throw new Error("OpenCode service (port-4096) not found on VM");
  }

  console.log(`[coding-agent] VM ready at: ${service.url}`);

  return {
    instanceId: instance.id,
    url: service.url,
    cleanup: async () => {
      console.log(`[coding-agent] Stopping VM: ${instance.id}`);
      await client.instances.stop({ instanceId: instance.id });
    },
  };
}

// Extract text from response parts
function extractTextFromParts(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } =>
      typeof p === "object" && p !== null && (p as { type?: string }).type === "text"
    )
    .map((p) => p.text)
    .join("\n");
}

// Extract tool results summary from parts
function extractToolSummary(parts: unknown[]): string[] {
  return parts
    .filter((p): p is { type: "tool"; tool: string; state: { status: string; error?: string } } =>
      typeof p === "object" && p !== null && (p as { type?: string }).type === "tool"
    )
    .map((p) => {
      const status = p.state.status;
      const toolName = p.tool;
      if (status === "completed") {
        return `✓ ${toolName}`;
      } else if (status === "error") {
        return `✗ ${toolName}: ${p.state.error}`;
      }
      return `⏳ ${toolName}`;
    });
}

export const delegateToCodingAgentTool = tool({
  description: `Delegate a coding task to a remote coding agent running in a sandboxed VM.
The agent has full access to code editing, file operations, and terminal commands.
Use this for tasks that require:
- Writing or modifying code
- Running tests or builds
- Exploring codebases
- Making git commits
- Any task that needs filesystem access

The agent will complete the task autonomously and return the results.`,
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "Detailed description of the coding task to perform. Be specific about what files to modify, what tests to run, etc."
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Additional context about the codebase, requirements, or constraints"
      ),
    agent: z
      .enum(["build", "plan", "general"])
      .optional()
      .default("build")
      .describe(
        "Which agent mode to use: 'build' for coding tasks, 'plan' for read-only analysis, 'general' for general questions"
      ),
  }),
  execute: async ({ task, context, agent }: { task: string; context?: string; agent: "build" | "plan" | "general" }) => {
    let vm: Awaited<ReturnType<typeof spawnCodingVM>> | null = null;
    let convexSessionId: string | null = null;

    try {
      // Get required environment variables
      const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

      // Generate a random JWT secret for this invocation
      // This secret will be written to the VM and used by the plugin
      const jwtSecretBytes = crypto.getRandomValues(new Uint8Array(32));
      const jwtSecret = base64urlEncode(jwtSecretBytes);

      if (!convexSiteUrl) {
        console.warn("[coding-agent] CONVEX_SITE_URL not set, streaming to Convex disabled");
      }

      // Create a session in Convex to track this coding agent task
      // The JWT secret is stored directly on the session for reliable authentication
      // The task is stored on the session so the UI can query by it directly
      convexSessionId = await convex.mutation(api.codingAgent.createCodingAgentSession, {
        toolCallId: `tool_${Date.now()}`, // Generate a unique ID
        task,
        context,
        agent,
        jwtSecret, // Store secret directly on session - no taskHash lookup needed
      });
      console.log(`[coding-agent] Created Convex session: ${convexSessionId}`);

      // Spawn a VM with JWT config written before OpenCode starts
      vm = await spawnCodingVM({
        onReady: async (instance) => {
          if (jwtSecret && convexSiteUrl && convexSessionId) {
            // Create JWT with session ID
            const now = Math.floor(Date.now() / 1000);
            const jwt = await createJWT(
              {
                sessionId: convexSessionId,
                iat: now,
                exp: now + 3600, // 1 hour expiry
              },
              jwtSecret
            );

            // Write config to the VM
            const config = {
              convexUrl: `${convexSiteUrl}/opencode_hook`,
              jwt,
            };

            const escapedConfig = JSON.stringify(config).replace(/'/g, "'\"'\"'");
            await instance.exec(`mkdir -p /root/.xagi && echo '${escapedConfig}' > /root/.xagi/config.json`);
            console.log(`[coding-agent] Wrote JWT config to VM`);
          }
        },
      });

      // Update session with the Morph instance ID
      await convex.mutation(api.codingAgent.updateCodingAgentSessionInstance, {
        sessionId: convexSessionId as Id<"sessions">,
        morphInstanceId: vm.instanceId,
      });
      console.log(`[coding-agent] Updated session with instance ID: ${vm.instanceId}`);

      // Create OpenCode client using the official SDK
      const opencode = createOpencodeClient({
        baseUrl: vm.url,
      });

      // Create a session
      const sessionResponse = await opencode.session.create({
        body: {
          title: `Task: ${task.slice(0, 50)}...`,
        },
      });

      if (sessionResponse.error) {
        throw new Error(`Failed to create session: ${JSON.stringify(sessionResponse.error)}`);
      }

      const session = sessionResponse.data;
      console.log(`[coding-agent] Created OpenCode session: ${session.id}`);

      // Build the prompt
      const fullPrompt = context
        ? `${task}\n\nContext:\n${context}`
        : task;

      // Send the prompt and wait for response
      console.log(`[coding-agent] Sending task to agent...`);
      const promptResponse = await opencode.session.prompt({
        path: { id: session.id },
        body: {
          parts: [{ type: "text", text: fullPrompt }],
          agent: agent || "build",
        },
      });

      if (promptResponse.error) {
        throw new Error(`Failed to send prompt: ${JSON.stringify(promptResponse.error)}`);
      }

      const response = promptResponse.data;

      // Extract results
      const textResponse = extractTextFromParts(response.parts);
      const toolsSummary = extractToolSummary(response.parts);

      const result = {
        success: true,
        sessionId: session.id,
        convexSessionId, // Include Convex session ID for UI linking
        response: textResponse,
        toolsUsed: toolsSummary,
        tokens: response.info.tokens,
        cost: response.info.cost,
      };

      console.log(`[coding-agent] Task completed. Tokens: ${response.info.tokens.input + response.info.tokens.output}`);

      return result;
    } catch (error) {
      console.error(`[coding-agent] Error:`, error);
      return {
        success: false,
        convexSessionId, // Include even on error for debugging
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // TODO: Re-enable cleanup after debugging
      // Always cleanup the VM
      // if (vm) {
      //   await vm.cleanup().catch((e) =>
      //     console.error(`[coding-agent] Cleanup error:`, e)
      //   );
      // }
    }
  },
});

// Export for use in workflows
export const codingAgentTools = {
  delegateToCodingAgent: delegateToCodingAgentTool,
};
