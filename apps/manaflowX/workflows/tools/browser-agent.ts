import { tool } from "ai";
import { z } from "zod";
import { MorphCloudClient } from "morphcloud";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { getLatestSnapshotId } from "./vm-snapshots";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

// =============================================================================
// Progress Stage Types
// =============================================================================

type ProgressStage = "creating_session" | "starting_vm" | "vm_ready" | "adding_mcp" | "sending_task" | "running" | "completed" | "error";

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
// Background Progress Queue
// =============================================================================

type ProgressUpdate = {
  parentSessionId: Id<"sessions">;
  toolCallId: string;
  stage: ProgressStage;
  message: string;
  extra?: { sessionId?: string; instanceId?: string };
};

class ProgressQueue {
  private queue: ProgressUpdate[] = [];
  private processing = false;

  enqueue(update: ProgressUpdate): void {
    this.queue.push(update);
    if (!this.processing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const update = this.queue.shift()!;
      try {
        await convex.mutation(api.sessions.updateToolProgress, {
          sessionId: update.parentSessionId,
          toolCallId: update.toolCallId,
          progress: {
            stage: update.stage,
            message: update.message,
            ...update.extra,
          },
        });
      } catch (error) {
        console.warn(`[browser-agent] Failed to update progress:`, error);
      }
    }

    this.processing = false;
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) {
      return;
    }
    while (this.processing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

const progressQueue = new ProgressQueue();

function updateProgress(
  parentSessionId: Id<"sessions"> | null,
  toolCallId: string,
  stage: ProgressStage,
  message: string,
  extra?: { sessionId?: string; instanceId?: string }
): void {
  if (!parentSessionId) {
    console.log(`[browser-agent] Progress (no parent): ${stage} - ${message}`);
    return;
  }

  progressQueue.enqueue({
    parentSessionId,
    toolCallId,
    stage,
    message,
    extra,
  });
}

// =============================================================================
// Browser Agent Tool - Uses OpenCode with Chrome DevTools MCP
// =============================================================================

// Get or spawn a Morph VM instance with browser capabilities
async function getOrSpawnBrowserVM(options?: {
  vmInstanceId?: string; // If provided, connect to existing VM instead of spawning new one
}): Promise<{
  instanceId: string;
  url: string;
  vncUrl: string;
  isExisting: boolean; // Whether we connected to an existing VM
  cleanup: () => Promise<void>;
}> {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY environment variable is required");
  }

  const client = new MorphCloudClient({ apiKey });

  let instance;
  let isExisting = false;

  if (options?.vmInstanceId) {
    // Connect to existing VM
    console.log(`[browser-agent] Connecting to existing VM: ${options.vmInstanceId}`);
    instance = await client.instances.get({ instanceId: options.vmInstanceId });
    isExisting = true;
    console.log(`[browser-agent] Connected to existing instance: ${instance.id}`);
  } else {
    // Spawn new VM
    const snapshotId = getLatestSnapshotId();
    console.log(`[browser-agent] Starting VM from snapshot: ${snapshotId}`);
    instance = await client.instances.start({ snapshotId });
    console.log(`[browser-agent] Instance created: ${instance.id}`);

    console.log(`[browser-agent] Waiting for instance to be ready...`);
    await instance.waitUntilReady(60);
  }

  // Wait for Chrome DevTools Protocol to be ready
  console.log(`[browser-agent] Waiting for Chrome DevTools Protocol...`);
  for (let attempt = 0; attempt < 10; attempt++) {
    const cdpCheck = await instance.exec("curl -s http://127.0.0.1:39382/json/version");
    if (cdpCheck.stdout && cdpCheck.stdout.includes("Browser")) {
      console.log(`[browser-agent] Chrome DevTools Protocol ready`);
      break;
    }
    if (attempt === 9) {
      throw new Error("Chrome DevTools Protocol not responding after 10 attempts");
    }
    console.log(`[browser-agent] CDP not ready, retrying... (${attempt + 1}/10)`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const opencodeService = instance.networking.httpServices.find(
    (s) => s.name === "port-4096"
  );
  const vncService = instance.networking.httpServices.find(
    (s) => s.name === "novnc"
  );

  if (!opencodeService) {
    if (!isExisting) {
      await client.instances.stop({ instanceId: instance.id });
    }
    throw new Error("OpenCode service (port-4096) not found on VM");
  }

  console.log(`[browser-agent] VM ready at: ${opencodeService.url}`);
  if (vncService) {
    console.log(`[browser-agent] VNC available at: ${vncService.url}`);
  }

  return {
    instanceId: instance.id,
    url: opencodeService.url,
    vncUrl: vncService?.url ?? "",
    isExisting,
    cleanup: async () => {
      // Only cleanup if we spawned a new VM
      if (!isExisting) {
        console.log(`[browser-agent] Stopping VM: ${instance.id}`);
        await client.instances.stop({ instanceId: instance.id });
      } else {
        console.log(`[browser-agent] Keeping existing VM: ${instance.id}`);
      }
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

export const delegateToBrowserAgentTool = tool({
  description: `Delegate a browser automation task to a remote agent with Chrome DevTools access.
The agent runs in a sandboxed VM with a full Chrome browser and can:
- Navigate to URLs and interact with web pages
- Click elements, fill forms, and submit data
- Take screenshots and extract page content
- Execute JavaScript in the browser context
- Monitor network requests and console logs
- Scrape data from websites

Use this for tasks that require:
- Web scraping or data extraction
- Browser automation and testing
- Interacting with web applications
- Capturing screenshots or visual verification
- Any task that needs a real browser

The agent uses Chrome DevTools Protocol (CDP) via MCP for browser control.`,
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "Detailed description of the browser task to perform. Be specific about URLs to visit, elements to interact with, and data to extract."
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Additional context about the task, expected page structure, or constraints"
      ),
    startUrl: z
      .string()
      .optional()
      .describe(
        "Initial URL to navigate to before starting the task. If not provided, the browser starts on about:blank."
      ),
    vmInstanceId: z
      .string()
      .optional()
      .describe(
        "Morph VM instance ID to connect to. If provided, reuses an existing VM instead of spawning a new one. Use this to run browser tasks on a VM that was previously used by delegateToCodingAgent."
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Working directory path for the OpenCode session. If provided, the session will use this directory. Useful when reusing a VM from delegateToCodingAgent."
      ),
  }),
  execute: async (
    { task, context, startUrl, vmInstanceId, path }: {
      task: string;
      context?: string;
      startUrl?: string;
      vmInstanceId?: string;
      path?: string;
    },
    { toolCallId }: { toolCallId: string }
  ) => {
    let vm: Awaited<ReturnType<typeof getOrSpawnBrowserVM>> | null = null;
    let convexSessionId: string | null = null;

    // Look up the parent session ID for progress updates
    const parentSessionId = await convex.query(api.codingAgent.getParentSessionForToolCall, {
      toolCallId,
    });

    try {
      const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

      // Generate JWT secret for this invocation
      const jwtSecretBytes = crypto.getRandomValues(new Uint8Array(32));
      const jwtSecret = base64urlEncode(jwtSecretBytes);

      if (!convexSiteUrl) {
        console.warn("[browser-agent] NEXT_PUBLIC_CONVEX_SITE_URL not set, streaming to Convex disabled");
      }

      // Update progress: Creating session
      updateProgress(parentSessionId, toolCallId, "creating_session", "Creating tracking session...");

      // Create a session in Convex
      convexSessionId = await convex.mutation(api.codingAgent.createCodingAgentSession, {
        toolCallId, // Use the actual toolCallId from AI SDK for proper linking
        task,
        context,
        agent: "browser",
        jwtSecret,
      });
      console.log(`[browser-agent] Created Convex session: ${convexSessionId}`);

      // Update progress: Starting/Connecting VM
      const vmProgressMsg = vmInstanceId ? "Connecting to existing VM..." : "Starting browser VM...";
      updateProgress(parentSessionId, toolCallId, "starting_vm", vmProgressMsg, {
        sessionId: convexSessionId,
      });

      // Get or spawn VM
      vm = await getOrSpawnBrowserVM({
        vmInstanceId,
      });

      // Write JWT config to VM (works for both new and existing VMs)
      const morphApiKey = process.env.MORPH_API_KEY!;
      const client = new MorphCloudClient({ apiKey: morphApiKey });
      const instance = await client.instances.get({ instanceId: vm.instanceId });

      if (jwtSecret && convexSiteUrl && convexSessionId) {
        const now = Math.floor(Date.now() / 1000);
        const jwt = await createJWT(
          {
            sessionId: convexSessionId,
            iat: now,
            exp: now + 3600,
          },
          jwtSecret
        );

        const config = {
          convexUrl: `${convexSiteUrl}/opencode_hook`,
          jwt,
        };

        const escapedConfig = JSON.stringify(config).replace(/'/g, "'\"'\"'");
        await instance.exec(`mkdir -p /root/.xagi && echo '${escapedConfig}' > /root/.xagi/config.json`);
        console.log(`[browser-agent] Wrote JWT config to VM`);
      }

      // Write OpenCode config to use xAI Grok model
      const xaiApiKey = process.env.XAI_API_KEY;
      if (xaiApiKey) {
        const opencodeConfig = {
          $schema: "https://opencode.ai/config.json",
          model: "xai/grok-4-1-fast-non-reasoning",
          provider: {
            xai: {
              options: {
                apiKey: xaiApiKey,
              },
            },
          },
        };

        const escapedOpencodeConfig = JSON.stringify(opencodeConfig).replace(/'/g, "'\"'\"'");
        await instance.exec(`mkdir -p /root/.config/opencode && echo '${escapedOpencodeConfig}' > /root/.config/opencode/opencode.json`);
        console.log(`[browser-agent] Wrote OpenCode config with xAI/grok-4-1-fast-non-reasoning model`);
      } else {
        console.warn(`[browser-agent] XAI_API_KEY not set, using default model`);
      }

      // Update session with the Morph instance ID
      await convex.mutation(api.codingAgent.updateCodingAgentSessionInstance, {
        sessionId: convexSessionId as Id<"sessions">,
        morphInstanceId: vm.instanceId,
      });
      console.log(`[browser-agent] Updated session with instance ID: ${vm.instanceId}`);

      // Update progress: VM ready
      updateProgress(parentSessionId, toolCallId, "vm_ready", "VM ready, configuring browser MCP...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Create OpenCode client (with optional directory for path)
      const opencode = createOpencodeClient({
        baseUrl: vm.url,
        ...(path && { directory: path }),
      });

      // Update progress: Adding MCP
      updateProgress(parentSessionId, toolCallId, "adding_mcp", "Adding Chrome DevTools MCP...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Add the Chrome DevTools MCP server
      // Chrome is running on the VM at 127.0.0.1:39382
      const mcpAddResult = await opencode.mcp.add({
        body: {
          name: "chrome",
          config: {
            type: "local",
            command: ["bunx", "chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:39382"],
            enabled: true,
            timeout: 30000, // Browser operations can take time
          },
        },
      });

      if (mcpAddResult.error) {
        throw new Error(`Failed to add Chrome DevTools MCP: ${JSON.stringify(mcpAddResult.error)}`);
      }
      console.log(`[browser-agent] Chrome DevTools MCP added successfully`);

      // Add the Convex upload MCP server for image uploads
      const uploadMcpResult = await opencode.mcp.add({
        body: {
          name: "convex-upload",
          config: {
            type: "local",
            command: ["bun", "/root/mcp/convex-upload.ts"],
            enabled: true,
            timeout: 30000,
          },
        },
      });

      if (uploadMcpResult.error) {
        // Non-fatal - log warning but continue
        console.warn(`[browser-agent] Failed to add Convex upload MCP: ${JSON.stringify(uploadMcpResult.error)}`);
      } else {
        console.log(`[browser-agent] Convex upload MCP added successfully`);
      }

      // Create a session
      const sessionResponse = await opencode.session.create({
        body: {
          title: `Browser: ${task.slice(0, 50)}...`,
        },
      });

      if (sessionResponse.error) {
        throw new Error(`Failed to create session: ${JSON.stringify(sessionResponse.error)}`);
      }

      const session = sessionResponse.data;
      console.log(`[browser-agent] Created OpenCode session: ${session.id}`);

      // Build the prompt with browser-specific instructions
      let fullPrompt = `You have access to a Chrome browser via the Chrome DevTools MCP.

Available browser tools:
- navigate_page: Navigate to a URL
- take_screenshot: Take a screenshot of the page (use filePath parameter to save to a file)
- click: Click an element by selector
- fill: Fill an input field
- evaluate_script: Execute JavaScript in the page context (use this to get page HTML/content)
- list_pages: List open browser pages
- new_page: Open a new page
- select_page: Switch to a different page
- wait_for: Wait for an element or condition

Available image tools:
- upload_image: Upload a screenshot to get a permanent public URL. Accepts "path" (file path) or "data" (base64).

IMPORTANT SCREENSHOT INSTRUCTIONS:
1. Complete the requested task using the browser tools.
2. When taking screenshots, ALWAYS use the filePath parameter to save to a file in /tmp/:
   - Use a descriptive filename, e.g., filePath="/tmp/google-search-results.png" or filePath="/tmp/weather-widget.png"
3. Upload the screenshot using upload_image with the path parameter pointing to the saved file.
4. In your final response, include the uploaded image using markdown syntax: ![description](url)

DO NOT pass base64 data directly to upload_image - always save to a file first and use the path parameter.

This allows the user to see visual proof of the completed task.

`;

      if (startUrl) {
        fullPrompt += `First, navigate to: ${startUrl}\n\n`;
      }

      fullPrompt += `Task: ${task}`;

      if (context) {
        fullPrompt += `\n\nContext:\n${context}`;
      }

      // Update progress: Sending task
      updateProgress(parentSessionId, toolCallId, "sending_task", "Sending task to browser agent...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      console.log(`[browser-agent] Sending task to agent...`);

      // Update progress: Running
      updateProgress(parentSessionId, toolCallId, "running", "Browser agent is working...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      const promptResponse = await opencode.session.prompt({
        path: { id: session.id },
        body: {
          parts: [{ type: "text", text: fullPrompt }],
          agent: "build",
        },
      });

      if (promptResponse.error) {
        throw new Error(`Failed to send prompt: ${JSON.stringify(promptResponse.error)}`);
      }

      const response = promptResponse.data;

      // Extract results
      const textResponse = extractTextFromParts(response.parts);
      const toolsSummary = extractToolSummary(response.parts);

      // Update progress: Completed
      updateProgress(parentSessionId, toolCallId, "completed", "Browser task completed successfully", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      const result = {
        success: true,
        sessionId: session.id,
        convexSessionId,
        morphInstanceId: vm.instanceId,
        path: session.directory, // Working directory path in the VM
        vncUrl: vm.vncUrl, // Include VNC URL for visual debugging
        response: textResponse,
        toolsUsed: toolsSummary,
        tokens: response.info.tokens,
        cost: response.info.cost,
      };

      console.log(`[browser-agent] Task completed. Tokens: ${response.info.tokens.input + response.info.tokens.output}`);

      return result;
    } catch (error) {
      console.error(`[browser-agent] Error:`, error);

      updateProgress(parentSessionId, toolCallId, "error", error instanceof Error ? error.message : String(error), {
        sessionId: convexSessionId ?? undefined,
      });

      return {
        success: false,
        convexSessionId,
        vncUrl: vm?.vncUrl, // Include VNC URL even on error for debugging
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await progressQueue.flush();

      // TODO: Re-enable cleanup after debugging
      // if (vm) {
      //   await vm.cleanup().catch((e) =>
      //     console.error(`[browser-agent] Cleanup error:`, e)
      //   );
      // }
    }
  },
});

// Export for use in workflows
export const browserAgentTools = {
  delegateToBrowserAgent: delegateToBrowserAgentTool,
};
