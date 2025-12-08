import { tool } from "ai";
import { z } from "zod";
import { MorphCloudClient } from "morphcloud";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { fetchInstallationAccessToken } from "../../convex/_shared/githubApp";
import { getLatestSnapshotId } from "./vm-snapshots";
import { StackServerApp } from "@stackframe/stack";

// =============================================================================
// Stack Auth Data Vault - for fetching env vars
// =============================================================================

const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    home: process.env.NEXT_PUBLIC_STACK_URL || "http://localhost:3000",
  },
});

interface EnvVar {
  key: string;
  value: string;
}

async function fetchEnvVarsFromVault(userId: string, repoId: string): Promise<EnvVar[]> {
  const secret = process.env.STACK_DATA_VAULT_SECRET;
  if (!secret) {
    console.warn("[coding-agent] STACK_DATA_VAULT_SECRET not set, skipping env vars");
    return [];
  }

  try {
    const store = await stackServerApp.getDataVaultStore("xagi");
    const key = `env:${userId}:${repoId}`;
    const value = await store.getValue(key, { secret });

    if (!value) {
      console.log(`[coding-agent] No env vars found for user:${userId} repo:${repoId}`);
      return [];
    }

    const envVars = JSON.parse(value) as EnvVar[];
    console.log(`[coding-agent] Fetched ${envVars.length} env vars from vault`);
    return envVars;
  } catch (error) {
    console.error("[coding-agent] Failed to fetch env vars from vault:", error);
    return [];
  }
}

// =============================================================================
// Progress Stage Types
// =============================================================================

type ProgressStage = "creating_session" | "starting_vm" | "vm_ready" | "sending_task" | "running" | "completed" | "error";

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
// Maintains ordering of progress updates while not blocking the main execution

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

  // Add update to queue and start processing if not already running
  enqueue(update: ProgressUpdate): void {
    this.queue.push(update);
    if (!this.processing) {
      this.processQueue();
    }
  }

  // Process queue items sequentially in the background
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
        // Log but don't fail - progress updates are not critical
        console.warn(`[coding-agent] Failed to update progress:`, error);
      }
    }

    this.processing = false;
  }

  // Wait for all pending updates to complete (call at end of tool execution)
  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.processing) {
      return;
    }
    // Wait for current processing to finish
    while (this.processing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Global progress queue instance
const progressQueue = new ProgressQueue();

// Helper to update progress in Convex (non-blocking)
function updateProgress(
  parentSessionId: Id<"sessions"> | null,
  toolCallId: string,
  stage: ProgressStage,
  message: string,
  extra?: { sessionId?: string; instanceId?: string }
): void {
  if (!parentSessionId) {
    console.log(`[coding-agent] Progress (no parent): ${stage} - ${message}`);
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
// Repository Cloning Helpers
// =============================================================================

interface RepoCloneConfig {
  gitRemote: string;           // e.g., "https://github.com/owner/repo.git"
  branch: string;              // branch to checkout
  installationId?: number;     // GitHub App installation ID for private repos
}

// Get GitHub access token for cloning private repos
async function getGitHubAccessToken(installationId: number): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.warn("[coding-agent] GitHub App credentials not configured");
    return null;
  }

  return fetchInstallationAccessToken(installationId, appId, privateKey);
}

// Build authenticated git remote URL
function buildAuthenticatedRemoteUrl(gitRemote: string, accessToken: string): string {
  // Convert https://github.com/owner/repo.git to https://x-access-token:TOKEN@github.com/owner/repo.git
  const url = new URL(gitRemote);
  url.username = "x-access-token";
  url.password = accessToken;
  return url.toString();
}

// Safely quote a string for shell usage (single quotes with escaping)
function singleQuote(str: string): string {
  return `'${str.replace(/'/g, "'\"'\"'")}'`;
}

// Clone repository and checkout branch in the VM
async function cloneRepositoryInVM(
  instance: { exec: (cmd: string) => Promise<{ stdout: string; stderr: string }> },
  config: RepoCloneConfig
): Promise<void> {
  const { gitRemote, branch, installationId } = config;
  const workspacePath = "/root/workspace";

  console.log(`[coding-agent] Cloning repository: ${gitRemote} branch: ${branch}`);

  // Get authenticated URL if we have an installation ID
  let cloneUrl = gitRemote;
  if (installationId) {
    const accessToken = await getGitHubAccessToken(installationId);
    if (accessToken) {
      cloneUrl = buildAuthenticatedRemoteUrl(gitRemote, accessToken);
      console.log(`[coding-agent] Using authenticated clone URL`);

      // Set up gh CLI auth and git credential helper in the VM
      console.log(`[coding-agent] Setting up gh auth in VM`);
      const ghAuthRes = await instance.exec(
        `bash -lc "printf %s ${singleQuote(accessToken)} | gh auth login --with-token && gh auth setup-git 2>&1"`
      );
      if (ghAuthRes.stderr && ghAuthRes.stderr.includes("error")) {
        console.warn(`[coding-agent] gh auth setup warning: ${ghAuthRes.stderr}`);
      } else {
        console.log(`[coding-agent] gh auth setup completed`);
      }
    } else {
      console.warn(`[coding-agent] Could not get access token, attempting public clone`);
    }
  }

  // Remove existing workspace contents (the VM may have a placeholder)
  // Use rm -rf on the directory and recreate it to ensure hidden files are also removed
  await instance.exec(`rm -rf ${workspacePath} && mkdir -p ${workspacePath}`);

  // Clone with depth 1 (shallow clone for speed)
  // Pattern from cmux: git clone --depth 1 "${repoUrl}" "${originPath}"
  const cloneCmd = `git clone --depth 1 "${cloneUrl}" ${workspacePath}`;
  const cloneResult = await instance.exec(cloneCmd);
  if (cloneResult.stderr && cloneResult.stderr.includes("fatal:")) {
    throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
  }
  console.log(`[coding-agent] Clone completed`);

  // Configure git safe directory
  // Pattern from cmux: git config --global --add safe.directory /workspace
  await instance.exec(`git config --global --add safe.directory ${workspacePath}`);

  // Set remote HEAD
  // Pattern from cmux: git remote set-head origin -a
  await instance.exec(`cd ${workspacePath} && git remote set-head origin -a`);

  // Fetch and checkout the specified branch
  // Pattern from cmux: git fetch --depth 1 origin +refs/heads/${branch}:refs/remotes/origin/${branch}
  // Pattern from cmux: git checkout -B ${branch} origin/${branch}
  if (branch !== "main" && branch !== "master") {
    console.log(`[coding-agent] Fetching and checking out branch: ${branch}`);

    // Fetch the specific branch
    const fetchCmd = `cd ${workspacePath} && git fetch --depth 1 origin "+refs/heads/${branch}:refs/remotes/origin/${branch}"`;
    await instance.exec(fetchCmd);

    // Checkout the branch (create local tracking branch)
    const checkoutCmd = `cd ${workspacePath} && git checkout -B "${branch}" "origin/${branch}"`;
    const checkoutResult = await instance.exec(checkoutCmd);
    if (checkoutResult.stderr && checkoutResult.stderr.includes("fatal:")) {
      throw new Error(`Failed to checkout branch ${branch}: ${checkoutResult.stderr}`);
    }
  } else {
    // For main/master, just ensure we're on the default branch
    const defaultBranchResult = await instance.exec(
      `cd ${workspacePath} && git rev-parse --abbrev-ref HEAD`
    );
    console.log(`[coding-agent] On branch: ${defaultBranchResult.stdout.trim()}`);
  }

  // Pull latest changes (for safety, in case the branch was partially cloned)
  // Pattern from cmux: git pull --ff-only --depth 1 origin ${branch}
  const pullCmd = `cd ${workspacePath} && git pull --ff-only --depth 1 origin "${branch}" 2>/dev/null || true`;
  await instance.exec(pullCmd);

  console.log(`[coding-agent] Repository ready at ${workspacePath}`);
}

// =============================================================================
// Coding Agent Tool - Delegates tasks to OpenCode running in Morph VMs
// =============================================================================

// Get or spawn a Morph VM instance and return the OpenCode URL
async function getOrSpawnCodingVM(options?: {
  vmInstanceId?: string; // If provided, connect to existing VM instead of spawning new one
  onReady?: (instance: { exec: (cmd: string) => Promise<{ stdout: string; stderr: string }> }) => Promise<void>;
  repo?: RepoCloneConfig;
  envVars?: Array<{ key: string; value: string }>;
}): Promise<{
  instanceId: string;
  url: string;
  vncUrl: string;
  isExisting: boolean; // Whether we connected to an existing VM
  instance: { exec: (cmd: string) => Promise<{ stdout: string; stderr: string }> };
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
    console.log(`[coding-agent] Connecting to existing VM: ${options.vmInstanceId}`);
    instance = await client.instances.get({ instanceId: options.vmInstanceId });
    isExisting = true;
    console.log(`[coding-agent] Connected to existing instance: ${instance.id}`);
  } else {
    // Spawn new VM
    const snapshotId = getLatestSnapshotId();
    console.log(`[coding-agent] Starting VM from snapshot: ${snapshotId}`);
    instance = await client.instances.start({ snapshotId });
    console.log(`[coding-agent] Instance created: ${instance.id}`);

    console.log(`[coding-agent] Waiting for instance to be ready...`);
    await instance.waitUntilReady(60); // Wait up to 60 seconds
  }

  // Run onReady callback if provided (e.g., to write config files)
  if (options?.onReady) {
    await options.onReady(instance);
  }

  // Clone repository if configuration provided (only for new VMs typically)
  if (options?.repo) {
    await cloneRepositoryInVM(instance, options.repo);
  }

  // Inject environment variables as .env file in workspace
  if (options?.envVars && options.envVars.length > 0) {
    console.log(`[coding-agent] Injecting ${options.envVars.length} environment variables`);

    // Build .env file content - each line is KEY=VALUE
    // We need to escape special characters for shell safety
    const envContent = options.envVars
      .filter((env) => env.key.trim() !== "")
      .map((env) => {
        // Escape backslashes and double quotes in values
        const escapedValue = env.value
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\$/g, "\\$")
          .replace(/`/g, "\\`");
        return `${env.key}="${escapedValue}"`;
      })
      .join("\n");

    // Write .env file to workspace using heredoc for safety
    const writeEnvCmd = `cat > /root/workspace/.env << 'ENVEOF'
${envContent}
ENVEOF`;

    await instance.exec(writeEnvCmd);

    // Verify the .env file was written
    const verifyResult = await instance.exec(`cat /root/workspace/.env`);
    console.log(`[coding-agent] Wrote .env file to /root/workspace/.env (${verifyResult.stdout.split('\n').length} lines)`);
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

  console.log(`[coding-agent] VM ready at: ${opencodeService.url}`);
  if (vncService) {
    console.log(`[coding-agent] VNC available at: ${vncService.url}`);
  }

  return {
    instanceId: instance.id,
    url: opencodeService.url,
    vncUrl: vncService?.url ?? "",
    isExisting,
    instance,
    cleanup: async () => {
      // Only cleanup if we spawned a new VM
      if (!isExisting) {
        console.log(`[coding-agent] Stopping VM: ${instance.id}`);
        await client.instances.stop({ instanceId: instance.id });
      } else {
        console.log(`[coding-agent] Keeping existing VM: ${instance.id}`);
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
    // Repository configuration for cloning
    repo: z
      .object({
        gitRemote: z
          .string()
          .describe("Git remote URL, e.g., 'https://github.com/owner/repo.git'"),
        branch: z
          .string()
          .describe("Branch to checkout after cloning"),
        installationId: z
          .number()
          .optional()
          .describe("GitHub App installation ID for private repos"),
        repoId: z
          .string()
          .optional()
          .describe("Convex repo ID for fetching env vars from vault"),
        userId: z
          .string()
          .optional()
          .describe("User ID for fetching env vars from vault"),
      })
      .optional()
      .describe("Repository to clone into the VM workspace. If not provided, no repository will be cloned."),
    installCommand: z
      .string()
      .optional()
      .describe(
        "Command to install dependencies (e.g., 'bun install', 'npm install'). If provided, the agent will run this after cloning the repository."
      ),
    vmInstanceId: z
      .string()
      .optional()
      .describe(
        "Morph VM instance ID to connect to. If provided, reuses an existing VM instead of spawning a new one."
      ),
    path: z
      .string()
      .optional()
      .describe(
        "Working directory path for the OpenCode session. If provided, the session will use this directory."
      ),
  }),
  execute: async (
    { task, context, agent, repo, installCommand, vmInstanceId, path }: {
      task: string;
      context?: string;
      agent: "build" | "plan" | "general";
      repo?: { gitRemote: string; branch: string; installationId?: number; repoId?: string; userId?: string };
      installCommand?: string;
      vmInstanceId?: string;
      path?: string;
    },
    { toolCallId }: { toolCallId: string }
  ) => {
    let vm: Awaited<ReturnType<typeof getOrSpawnCodingVM>> | null = null;
    let convexSessionId: string | null = null;

    // Look up the parent session ID for progress updates
    const parentSessionId = await convex.query(api.codingAgent.getParentSessionForToolCall, {
      toolCallId,
    });

    try {
      // Get required environment variables
      const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

      // Generate a random JWT secret for this invocation
      // This secret will be written to the VM and used by the plugin
      const jwtSecretBytes = crypto.getRandomValues(new Uint8Array(32));
      const jwtSecret = base64urlEncode(jwtSecretBytes);

      if (!convexSiteUrl) {
        console.warn("[coding-agent] NEXT_PUBLIC_CONVEX_SITE_URL not set, streaming to Convex disabled");
      }

      // Update progress: Creating session (non-blocking)
      updateProgress(parentSessionId, toolCallId, "creating_session", "Creating tracking session...");

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

      // Update progress: Session created, now starting/connecting VM (non-blocking)
      const vmProgressMsg = vmInstanceId ? "Connecting to existing VM..." : "Starting sandboxed VM...";
      updateProgress(parentSessionId, toolCallId, "starting_vm", vmProgressMsg, {
        sessionId: convexSessionId,
      });

      // Fetch env vars from vault if we have repoId and userId
      let envVars: EnvVar[] = [];
      if (repo?.repoId && repo?.userId) {
        envVars = await fetchEnvVarsFromVault(repo.userId, repo.repoId);
      }

      // Get or spawn a VM with JWT config written before OpenCode starts
      vm = await getOrSpawnCodingVM({
        vmInstanceId,
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

          // Write OpenCode config with provider API keys
          const xaiApiKey = process.env.XAI_API_KEY;
          const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
          if (xaiApiKey || anthropicApiKey) {
            const opencodeConfig: Record<string, unknown> = {
              $schema: "https://opencode.ai/config.json",
              provider: {},
            };

            // Set default model based on available keys (prefer xAI)
            if (xaiApiKey) {
              opencodeConfig.model = "xai/grok-4-1-fast-non-reasoning";
              (opencodeConfig.provider as Record<string, unknown>).xai = {
                options: {
                  apiKey: xaiApiKey,
                },
              };
            }
            if (anthropicApiKey) {
              if (!xaiApiKey) {
                opencodeConfig.model = "anthropic/claude-opus-4-5";
              }
              (opencodeConfig.provider as Record<string, unknown>).anthropic = {
                options: {
                  apiKey: anthropicApiKey,
                },
              };
            }

            const escapedOpencodeConfig = JSON.stringify(opencodeConfig).replace(/'/g, "'\"'\"'");
            await instance.exec(`mkdir -p /root/.config/opencode && echo '${escapedOpencodeConfig}' > /root/.config/opencode/opencode.json`);
            console.log(`[coding-agent] Wrote OpenCode config with model: ${opencodeConfig.model}`);
          } else {
            console.warn(`[coding-agent] No API keys set (XAI_API_KEY or ANTHROPIC_API_KEY), using default model`);
          }
        },
        // Pass repository config for cloning
        repo: repo,
        // Pass environment variables fetched from vault
        envVars,
      });

      // Update session with the Morph instance ID
      await convex.mutation(api.codingAgent.updateCodingAgentSessionInstance, {
        sessionId: convexSessionId as Id<"sessions">,
        morphInstanceId: vm.instanceId,
      });
      // Log the VM URL (derived from instance ID: https://port-4096-{id.replace('_', '-')}.http.cloud.morph.so)
      console.log(`[coding-agent] Updated session with instance ID: ${vm.instanceId} (VM URL: ${vm.url})`);

      // Update progress: VM ready (non-blocking)
      updateProgress(parentSessionId, toolCallId, "vm_ready", "VM ready, creating OpenCode session...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Create OpenCode client using the official SDK (with optional directory for path)
      const opencode = createOpencodeClient({
        baseUrl: vm.url,
        ...(path && { directory: path }),
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
      let fullPrompt = "";

      // Add install command instructions if provided
      if (installCommand) {
        fullPrompt += `## Setup Instructions

Before starting the task, install dependencies by running:
\`\`\`bash
${installCommand}
\`\`\`

`;
      }

      fullPrompt += task;

      if (context) {
        fullPrompt += `\n\nContext:\n${context}`;
      }

      // Update progress: Sending task (non-blocking)
      updateProgress(parentSessionId, toolCallId, "sending_task", "Sending task to coding agent...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Send the prompt and wait for response
      console.log(`[coding-agent] Sending task to agent...`);

      // Update progress: Running (non-blocking)
      updateProgress(parentSessionId, toolCallId, "running", "Coding agent is working...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

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

      // Extract results (handle undefined parts gracefully)
      const textResponse = extractTextFromParts(response.parts ?? []);
      const toolsSummary = extractToolSummary(response.parts ?? []);

      // Update progress: Completed (non-blocking)
      updateProgress(parentSessionId, toolCallId, "completed", "Task completed successfully", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      const result = {
        success: true,
        sessionId: session.id,
        convexSessionId, // Include Convex session ID for UI linking
        morphInstanceId: vm.instanceId, // VM instance ID for debugging (URL derived as https://port-4096-{id.replace('_', '-')}.http.cloud.morph.so)
        path: session.directory, // Working directory path in the VM
        vncUrl: vm.vncUrl, // VNC URL for visual debugging
        response: textResponse,
        toolsUsed: toolsSummary,
        tokens: response.info?.tokens,
        cost: response.info?.cost,
      };

      const totalTokens = (response.info?.tokens?.input ?? 0) + (response.info?.tokens?.output ?? 0);
      console.log(`[coding-agent] Task completed. Tokens: ${totalTokens}`);

      return result;
    } catch (error) {
      console.error(`[coding-agent] Error:`, error);

      // Update progress: Error (non-blocking)
      updateProgress(parentSessionId, toolCallId, "error", error instanceof Error ? error.message : String(error), {
        sessionId: convexSessionId ?? undefined,
      });

      return {
        success: false,
        convexSessionId, // Include even on error for debugging
        vncUrl: vm?.vncUrl, // Include VNC URL even on error for debugging
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Flush any pending progress updates before returning
      await progressQueue.flush();

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
