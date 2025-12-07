import { tool } from "ai";
import { z } from "zod";
import { MorphCloudClient } from "morphcloud";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { fetchInstallationAccessToken } from "../../convex/_shared/githubApp";
import { getLatestSnapshotId } from "./vm-snapshots";

// =============================================================================
// Progress Stage Types
// =============================================================================

type ProgressStage = "creating_session" | "starting_vm" | "vm_ready" | "cloning_repo" | "adding_mcp" | "analyzing_pr" | "running" | "completed" | "error";

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

// Lazily initialize Convex client to avoid errors when module is loaded in environments
// where NEXT_PUBLIC_CONVEX_URL is not set (e.g., Convex's module analysis phase)
let _convex: ConvexHttpClient | null = null;
function getConvexClient(): ConvexHttpClient {
  if (!_convex) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL environment variable is required");
    }
    _convex = new ConvexHttpClient(url);
  }
  return _convex;
}

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
        await getConvexClient().mutation(api.sessions.updateToolProgress, {
          sessionId: update.parentSessionId,
          toolCallId: update.toolCallId,
          progress: {
            stage: update.stage,
            message: update.message,
            ...update.extra,
          },
        });
      } catch (error) {
        console.warn(`[pr-screenshoter] Failed to update progress:`, error);
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
    console.log(`[pr-screenshoter] Progress (no parent): ${stage} - ${message}`);
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
// GitHub PR Parsing
// =============================================================================

interface ParsedPR {
  owner: string;
  repo: string;
  prNumber: number;
  gitRemote: string;
}

function parsePullRequestUrl(url: string): ParsedPR {
  // Supports formats:
  // https://github.com/owner/repo/pull/123
  // github.com/owner/repo/pull/123
  const match = url.match(/(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid GitHub PR URL: ${url}`);
  }

  const [, owner, repo, prNumber] = match;
  return {
    owner: owner!,
    repo: repo!,
    prNumber: parseInt(prNumber!, 10),
    gitRemote: `https://github.com/${owner}/${repo}.git`,
  };
}

// =============================================================================
// Repository Cloning Helpers (from coding-agent.ts)
// =============================================================================

// Get GitHub access token for cloning private repos
async function getGitHubAccessToken(installationId: number): Promise<string | null> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.warn("[pr-screenshoter] GitHub App credentials not configured");
    return null;
  }

  return fetchInstallationAccessToken(installationId, appId, privateKey);
}

// Build authenticated git remote URL
function buildAuthenticatedRemoteUrl(gitRemote: string, accessToken: string): string {
  const url = new URL(gitRemote);
  url.username = "x-access-token";
  url.password = accessToken;
  return url.toString();
}

// Safely quote a string for shell usage
function singleQuote(str: string): string {
  return `'${str.replace(/'/g, "'\"'\"'")}'`;
}

// Clone repository and checkout PR branch in the VM
async function cloneAndCheckoutPR(
  instance: { exec: (cmd: string) => Promise<{ stdout: string; stderr: string }> },
  parsedPR: ParsedPR,
  branch: string,
  installationId?: number
): Promise<void> {
  const { gitRemote, prNumber } = parsedPR;
  const workspacePath = "/workspace";

  console.log(`[pr-screenshoter] Cloning repository: ${gitRemote} for PR #${prNumber}`);

  // Get authenticated URL if we have an installation ID
  let cloneUrl = gitRemote;
  if (installationId) {
    const accessToken = await getGitHubAccessToken(installationId);
    if (accessToken) {
      cloneUrl = buildAuthenticatedRemoteUrl(gitRemote, accessToken);
      console.log(`[pr-screenshoter] Using authenticated clone URL`);

      // Set up gh CLI auth
      console.log(`[pr-screenshoter] Setting up gh auth in VM`);
      const ghAuthRes = await instance.exec(
        `bash -lc "printf %s ${singleQuote(accessToken)} | gh auth login --with-token && gh auth setup-git 2>&1"`
      );
      if (ghAuthRes.stderr && ghAuthRes.stderr.includes("error")) {
        console.warn(`[pr-screenshoter] gh auth setup warning: ${ghAuthRes.stderr}`);
      } else {
        console.log(`[pr-screenshoter] gh auth setup completed`);
      }
    } else {
      console.warn(`[pr-screenshoter] Could not get access token, attempting public clone`);
    }
  }

  // Remove existing workspace contents
  await instance.exec(`rm -rf ${workspacePath}/*`);

  // Clone with depth 1 (shallow clone for speed)
  const cloneCmd = `git clone --depth 1 "${cloneUrl}" ${workspacePath}`;
  const cloneResult = await instance.exec(cloneCmd);
  if (cloneResult.stderr && cloneResult.stderr.includes("fatal:")) {
    throw new Error(`Failed to clone repository: ${cloneResult.stderr}`);
  }
  console.log(`[pr-screenshoter] Clone completed`);

  // Configure git safe directory
  await instance.exec(`git config --global --add safe.directory ${workspacePath}`);

  // Fetch and checkout the PR branch
  console.log(`[pr-screenshoter] Fetching PR branch: ${branch}`);

  // Fetch the PR ref
  const fetchCmd = `cd ${workspacePath} && git fetch --depth 1 origin "+refs/heads/${branch}:refs/remotes/origin/${branch}"`;
  await instance.exec(fetchCmd);

  // Checkout the branch
  const checkoutCmd = `cd ${workspacePath} && git checkout -B "${branch}" "origin/${branch}"`;
  const checkoutResult = await instance.exec(checkoutCmd);
  if (checkoutResult.stderr && checkoutResult.stderr.includes("fatal:")) {
    throw new Error(`Failed to checkout branch ${branch}: ${checkoutResult.stderr}`);
  }

  console.log(`[pr-screenshoter] Repository ready at ${workspacePath} on branch ${branch}`);
}

// =============================================================================
// VM Spawning
// =============================================================================

async function getOrSpawnPRReviewVM(options?: {
  vmInstanceId?: string; // If provided, connect to existing VM instead of spawning new one
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
    console.log(`[pr-screenshoter] Connecting to existing VM: ${options.vmInstanceId}`);
    instance = await client.instances.get({ instanceId: options.vmInstanceId });
    isExisting = true;
    console.log(`[pr-screenshoter] Connected to existing instance: ${instance.id}`);
  } else {
    // Spawn new VM
    const snapshotId = getLatestSnapshotId();
    console.log(`[pr-screenshoter] Starting VM from snapshot: ${snapshotId}`);
    instance = await client.instances.start({ snapshotId });
    console.log(`[pr-screenshoter] Instance created: ${instance.id}`);

    console.log(`[pr-screenshoter] Waiting for instance to be ready...`);
    await instance.waitUntilReady(60);
  }

  // Wait for Chrome DevTools Protocol to be ready
  console.log(`[pr-screenshoter] Waiting for Chrome DevTools Protocol...`);
  for (let attempt = 0; attempt < 10; attempt++) {
    const cdpCheck = await instance.exec("curl -s http://127.0.0.1:39382/json/version");
    if (cdpCheck.stdout && cdpCheck.stdout.includes("Browser")) {
      console.log(`[pr-screenshoter] Chrome DevTools Protocol ready`);
      break;
    }
    if (attempt === 9) {
      throw new Error("Chrome DevTools Protocol not responding after 10 attempts");
    }
    console.log(`[pr-screenshoter] CDP not ready, retrying... (${attempt + 1}/10)`);
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

  console.log(`[pr-screenshoter] VM ready at: ${opencodeService.url}`);
  if (vncService) {
    console.log(`[pr-screenshoter] VNC available at: ${vncService.url}`);
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
        console.log(`[pr-screenshoter] Stopping VM: ${instance.id}`);
        await client.instances.stop({ instanceId: instance.id });
      } else {
        console.log(`[pr-screenshoter] Keeping existing VM: ${instance.id}`);
      }
    },
  };
}

// =============================================================================
// Extract helpers
// =============================================================================

function extractTextFromParts(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } =>
      typeof p === "object" && p !== null && (p as { type?: string }).type === "text"
    )
    .map((p) => p.text)
    .join("\n");
}

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

// =============================================================================
// PR Screenshoter Tool
// =============================================================================

const PR_REVIEW_PROMPT = `You are a screenshot collector for pull request reviews. Your job is to determine if a PR contains UI changes and, if so, capture screenshots of those changes.

<PR_URL>
{pullRequestUrl}
</PR_URL>

<PHASE_1_ANALYSIS>
First, analyze the changed files to determine if this PR contains UI changes.

IMPORTANT: Base your decision on the ACTUAL FILES CHANGED, not the PR title or description. PR descriptions can be misleading or incomplete. If the diff contains UI-affecting code, there ARE UI changes regardless of what the description says.

UI changes ARE present if the PR modifies code that affects what users see in the browser:
- Frontend components or templates (any framework: React, Vue, Rails ERB, PHP Blade, Django templates, etc.)
- Stylesheets (CSS, SCSS, Tailwind, styled-components, etc.)
- Markup or template files (HTML, JSX, ERB, Twig, Jinja, Handlebars, etc.)
- Client-side JavaScript/TypeScript that affects rendering
- UI states like loading indicators, error messages, empty states, or toasts
- Accessibility attributes, ARIA labels, or semantic markup

UI changes are NOT present if the PR only modifies:
- Server-side logic that doesn't change what's rendered (API handlers, database queries, background jobs)
- Configuration files (unless they affect theming or UI behavior)
- Tests, documentation, or build scripts
- Type definitions or interfaces for non-UI code

If no UI changes exist: Set hasUiChanges=false, take ZERO screenshots, and explain why. Do not start the dev server or open a browser.
</PHASE_1_ANALYSIS>

<PHASE_2_CAPTURE>
If UI changes exist, capture screenshots:

1. Read CLAUDE.md or AGENTS.md (may be one level deeper) and install dependencies if needed
2. Start the dev server. Check tmux panes first to see if already running. Look for instructions in README.md, CLAUDE.md, or framework-specific files (package.json, Makefile, Gemfile, composer.json, requirements.txt, etc.). Use dev_command above if provided.
3. Wait for the server to be ready (curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT should return 200)
4. Navigate to the pages/components modified in the PR
5. Capture screenshots of the changes, including:
   - The default/resting state of changed components
   - Interactive states: hover, focus, active, disabled
   - Conditional states: loading, error, empty, success (if the PR modifies these!)
   - Hidden UI: modals, dropdowns, tooltips, accordions
   - Responsive layouts if the PR includes responsive changes
6. Save screenshots to {outputDir} with descriptive names like "component-state-{branch}.png"
</PHASE_2_CAPTURE>

<WHAT_TO_CAPTURE>
Screenshot the UI states that the PR actually modifies. Be intentional:

- If the PR changes a loading spinner → screenshot the loading state
- If the PR changes error handling UI → screenshot the error state
- If the PR changes a skeleton loader → screenshot the skeleton
- If the PR changes hover styles → screenshot the hover state
- If the PR changes a modal → open and screenshot the modal

Don't screenshot loading/error states incidentally while waiting for the "real" UI. Screenshot them when they ARE the change.
</WHAT_TO_CAPTURE>

<CRITICAL_MISTAKES>
Avoid these failure modes:

FALSE POSITIVE: Taking screenshots when the PR has no UI changes. Backend-only, config, or test changes = hasUiChanges=false, zero screenshots.

FALSE NEGATIVE: Failing to capture screenshots when UI changes exist. If React components, CSS, or templates changed, you MUST capture them.

FAKE UI: Creating mock HTML files instead of screenshotting the real app. Never fabricate UIs. If the dev server won't start, report the failure.

WRONG PAGE: Screenshotting pages unrelated to the PR. Only capture components/pages that the changed files actually render.

DUPLICATE SCREENSHOTS: Taking multiple identical screenshots. Each screenshot should show something distinct.

INCOMPLETE CAPTURE: Missing important UI elements. Ensure full components are visible and not cut off.
</CRITICAL_MISTAKES>

<OUTPUT_REQUIREMENTS>
- Set hasUiChanges to true only if the PR modifies UI-rendering code AND you captured screenshots
- Set hasUiChanges to false if the PR has no UI changes (with zero screenshots)
- Include every screenshot path with a description of what it shows
- Do not close the browser when done
- Do not create summary documents
</OUTPUT_REQUIREMENTS>`;

export const pullRequestScreenshoterTool = tool({
  description: `Review a GitHub Pull Request for UI changes and capture screenshots.
This tool analyzes the PR's changed files to determine if there are UI changes, and if so:
- Clones the repository with the PR branch
- Starts the dev server
- Takes screenshots of the UI changes
- Uploads screenshots for human review

Use this for:
- PR reviews that may have visual/UI changes
- Visual regression testing
- Documenting UI changes before merging

The tool returns whether UI changes exist and provides screenshot URLs if applicable.`,
  inputSchema: z.object({
    pullRequestUrl: z
      .string()
      .describe(
        "GitHub Pull Request URL (e.g., 'https://github.com/owner/repo/pull/123')"
      ),
    branch: z
      .string()
      .describe(
        "The branch name of the PR to checkout (e.g., 'feature/new-ui')"
      ),
    installationId: z
      .number()
      .optional()
      .describe(
        "GitHub App installation ID for private repos"
      ),
    devCommand: z
      .string()
      .optional()
      .describe(
        "Custom command to start the dev server (e.g., 'npm run dev'). If not provided, the agent will try to detect it."
      ),
    installCommand: z
      .string()
      .optional()
      .describe(
        "Custom command to install dependencies (e.g., 'bun install', 'npm install'). If not provided, the agent will try to detect it."
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
    { pullRequestUrl, branch, installationId, devCommand, installCommand, vmInstanceId, path }: {
      pullRequestUrl: string;
      branch: string;
      installationId?: number;
      devCommand?: string;
      installCommand?: string;
      vmInstanceId?: string;
      path?: string;
    },
    { toolCallId }: { toolCallId: string }
  ) => {
    let vm: Awaited<ReturnType<typeof getOrSpawnPRReviewVM>> | null = null;
    let convexSessionId: string | null = null;

    // Look up the parent session ID for progress updates
    const parentSessionId = await getConvexClient().query(api.codingAgent.getParentSessionForToolCall, {
      toolCallId,
    });

    try {
      // Parse the PR URL
      const parsedPR = parsePullRequestUrl(pullRequestUrl);
      console.log(`[pr-screenshoter] Parsed PR: ${parsedPR.owner}/${parsedPR.repo}#${parsedPR.prNumber}`);

      const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;

      // Generate JWT secret for this invocation
      const jwtSecretBytes = crypto.getRandomValues(new Uint8Array(32));
      const jwtSecret = base64urlEncode(jwtSecretBytes);

      if (!convexSiteUrl) {
        console.warn("[pr-screenshoter] NEXT_PUBLIC_CONVEX_SITE_URL not set, streaming to Convex disabled");
      }

      // Update progress: Creating session
      updateProgress(parentSessionId, toolCallId, "creating_session", "Creating tracking session...");

      // Create a session in Convex
      convexSessionId = await getConvexClient().mutation(api.codingAgent.createCodingAgentSession, {
        toolCallId,
        task: `PR Screenshot Review: ${pullRequestUrl}`,
        context: `Branch: ${branch}`,
        agent: "pr-screenshoter",
        jwtSecret,
      });
      console.log(`[pr-screenshoter] Created Convex session: ${convexSessionId}`);

      // Update progress: Starting/Connecting VM
      const vmProgressMsg = vmInstanceId ? "Connecting to existing VM..." : "Starting screenshot VM...";
      updateProgress(parentSessionId, toolCallId, "starting_vm", vmProgressMsg, {
        sessionId: convexSessionId,
      });

      // Get or spawn VM
      vm = await getOrSpawnPRReviewVM({
        vmInstanceId,
      });

      // Write JWT config to VM
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
        await vm.instance.exec(`mkdir -p /root/.xagi && echo '${escapedConfig}' > /root/.xagi/config.json`);
        console.log(`[pr-screenshoter] Wrote JWT config to VM`);
      }

      // Write OpenCode config with provider API keys
      const xaiApiKey = process.env.XAI_API_KEY;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
      if (xaiApiKey || anthropicApiKey) {
        const opencodeConfig: Record<string, unknown> = {
          $schema: "https://opencode.ai/config.json",
          provider: {},
        };

        // Set default model based on available keys (prefer Anthropic)
        if (anthropicApiKey) {
          opencodeConfig.model = "anthropic/claude-opus-4-5";
          (opencodeConfig.provider as Record<string, unknown>).anthropic = {
            options: {
              apiKey: anthropicApiKey,
            },
          };
        }
        if (xaiApiKey) {
          if (!anthropicApiKey) {
            opencodeConfig.model = "xai/grok-4-1-fast-non-reasoning";
          }
          (opencodeConfig.provider as Record<string, unknown>).xai = {
            options: {
              apiKey: xaiApiKey,
            },
          };
        }

        const escapedOpencodeConfig = JSON.stringify(opencodeConfig).replace(/'/g, "'\"'\"'");
        await vm.instance.exec(`mkdir -p /root/.config/opencode && echo '${escapedOpencodeConfig}' > /root/.config/opencode/opencode.json`);
        console.log(`[pr-screenshoter] Wrote OpenCode config with model: ${opencodeConfig.model}`);
      } else {
        console.warn(`[pr-screenshoter] No API keys set (XAI_API_KEY or ANTHROPIC_API_KEY), using default model`);
      }

      // Update session with the Morph instance ID
      await getConvexClient().mutation(api.codingAgent.updateCodingAgentSessionInstance, {
        sessionId: convexSessionId as Id<"sessions">,
        morphInstanceId: vm.instanceId,
      });
      console.log(`[pr-screenshoter] Updated session with instance ID: ${vm.instanceId}`);

      // Update progress: VM ready
      updateProgress(parentSessionId, toolCallId, "vm_ready", "VM ready, cloning repository...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Update progress: Cloning repo
      updateProgress(parentSessionId, toolCallId, "cloning_repo", `Cloning ${parsedPR.owner}/${parsedPR.repo}...`, {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Clone the repository and checkout the PR branch
      await cloneAndCheckoutPR(vm.instance, parsedPR, branch, installationId);

      // Update progress: Adding MCP
      updateProgress(parentSessionId, toolCallId, "adding_mcp", "Adding Chrome DevTools MCP...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      // Create OpenCode client (with optional directory for path)
      const opencode = createOpencodeClient({
        baseUrl: vm.url,
        ...(path && { directory: path }),
      });

      // Add the Chrome DevTools MCP server
      const mcpAddResult = await opencode.mcp.add({
        body: {
          name: "chrome",
          config: {
            type: "local",
            command: ["bunx", "chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:39382"],
            enabled: true,
            timeout: 30000,
          },
        },
      });

      if (mcpAddResult.error) {
        throw new Error(`Failed to add Chrome DevTools MCP: ${JSON.stringify(mcpAddResult.error)}`);
      }
      console.log(`[pr-screenshoter] Chrome DevTools MCP added successfully`);

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
        console.warn(`[pr-screenshoter] Failed to add Convex upload MCP: ${JSON.stringify(uploadMcpResult.error)}`);
      } else {
        console.log(`[pr-screenshoter] Convex upload MCP added successfully`);
      }

      // Create a session
      const sessionResponse = await opencode.session.create({
        body: {
          title: `PR Review: ${parsedPR.owner}/${parsedPR.repo}#${parsedPR.prNumber}`,
        },
      });

      if (sessionResponse.error) {
        throw new Error(`Failed to create session: ${JSON.stringify(sessionResponse.error)}`);
      }

      const session = sessionResponse.data;
      console.log(`[pr-screenshoter] Created OpenCode session: ${session.id}`);

      // Build the prompt
      const outputDir = "/tmp/pr-screenshots";
      let fullPrompt = PR_REVIEW_PROMPT
        .replace("{pullRequestUrl}", pullRequestUrl)
        .replace("{outputDir}", outputDir)
        .replace("{branch}", branch);

      // Add install command hint if provided
      if (installCommand) {
        fullPrompt = fullPrompt.replace(
          "1. Read CLAUDE.md or AGENTS.md (may be one level deeper) and install dependencies if needed",
          `1. Read CLAUDE.md or AGENTS.md (may be one level deeper) and install dependencies with: ${installCommand}`
        );
      }

      // Add dev command hint if provided
      if (devCommand) {
        fullPrompt = fullPrompt.replace(
          "</PHASE_2_CAPTURE>",
          `\nHint: The dev server can be started with: ${devCommand}\n</PHASE_2_CAPTURE>`
        );
      }

      // Add browser tool instructions
      fullPrompt = `You have access to a Chrome browser via the Chrome DevTools MCP.

Available browser tools:
- navigate_page: Navigate to a URL
- take_screenshot: Take a screenshot of the page (use filePath parameter to save to a file)
- click: Click an element by selector
- fill: Fill an input field
- evaluate_script: Execute JavaScript in the page context
- list_pages: List open browser pages
- new_page: Open a new page
- select_page: Switch to a different page
- wait_for: Wait for an element or condition

Available image tools:
- upload_image: Upload a screenshot to get a permanent public URL. Accepts "path" (file path) or "data" (base64).

IMPORTANT SCREENSHOT INSTRUCTIONS:
1. When taking screenshots, ALWAYS use the filePath parameter to save to a file in ${outputDir}/
2. Upload the screenshot using upload_image with the path parameter pointing to the saved file.
3. In your final response, include the uploaded images using markdown syntax: ![description](url)

First, create the output directory:
\`\`\`bash
mkdir -p ${outputDir}
\`\`\`

Then use the gh CLI to fetch PR details:
\`\`\`bash
gh pr view ${parsedPR.prNumber} --repo ${parsedPR.owner}/${parsedPR.repo} --json files,title,body
\`\`\`

` + fullPrompt;

      // Update progress: Analyzing PR
      updateProgress(parentSessionId, toolCallId, "analyzing_pr", "Analyzing PR for UI changes...", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      console.log(`[pr-screenshoter] Sending task to agent...`);

      // Update progress: Running
      updateProgress(parentSessionId, toolCallId, "running", "Screenshot agent is working...", {
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
      updateProgress(parentSessionId, toolCallId, "completed", "PR screenshot review completed", {
        sessionId: convexSessionId,
        instanceId: vm.instanceId,
      });

      const result = {
        success: true,
        sessionId: session.id,
        convexSessionId,
        morphInstanceId: vm.instanceId,
        path: session.directory, // Working directory path in the VM
        vncUrl: vm.vncUrl,
        pullRequest: {
          url: pullRequestUrl,
          owner: parsedPR.owner,
          repo: parsedPR.repo,
          number: parsedPR.prNumber,
          branch,
        },
        response: textResponse,
        toolsUsed: toolsSummary,
        tokens: response.info.tokens,
        cost: response.info.cost,
      };

      console.log(`[pr-screenshoter] Task completed. Tokens: ${response.info.tokens.input + response.info.tokens.output}`);

      return result;
    } catch (error) {
      console.error(`[pr-screenshoter] Error:`, error);

      updateProgress(parentSessionId, toolCallId, "error", error instanceof Error ? error.message : String(error), {
        sessionId: convexSessionId ?? undefined,
      });

      return {
        success: false,
        convexSessionId,
        vncUrl: vm?.vncUrl,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await progressQueue.flush();

      // TODO: Re-enable cleanup after debugging
      // if (vm) {
      //   await vm.cleanup().catch((e) =>
      //     console.error(`[pr-screenshoter] Cleanup error:`, e)
      //   );
      // }
    }
  },
});

// Export for use in workflows
export const prScreenshoterTools = {
  pullRequestScreenshoter: pullRequestScreenshoterTool,
};

// Export types for direct function call
export type PRScreenshotInput = {
  pullRequestUrl: string;
  branch: string;
  installationId?: number;
  devCommand?: string;
  installCommand?: string;
  vmInstanceId?: string;
  path?: string;
};

export type PRScreenshotResult = {
  success: true;
  sessionId: string;
  convexSessionId: string;
  morphInstanceId: string;
  path: string; // Working directory path in the VM
  vncUrl: string;
  pullRequest: {
    url: string;
    owner: string;
    repo: string;
    number: number;
    branch: string;
  };
  response: string;
  toolsUsed: string[];
  tokens: { input: number; output: number };
  cost: number;
} | {
  success: false;
  convexSessionId: string | null;
  vncUrl?: string;
  error: string;
};

// Direct function export for calling from Convex actions
export async function screenshotPullRequest(
  input: PRScreenshotInput,
  toolCallId: string
): Promise<PRScreenshotResult> {
  // The tool's execute function is the implementation
  // We access it via the tool's parameters property
  const execute = pullRequestScreenshoterTool.execute;
  if (!execute) {
    return {
      success: false,
      convexSessionId: null,
      error: "Tool execute function not found",
    };
  }
  return execute(input, { toolCallId, messages: [] }) as Promise<PRScreenshotResult>;
}
