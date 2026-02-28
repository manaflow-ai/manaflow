import {
  getAccessTokenFromRequest,
  getUserFromRequest,
} from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { generateGitHubInstallationToken } from "@/lib/utils/github-app-token";
import { selectGitIdentity } from "@/lib/utils/gitIdentity";
import { stackServerAppJs } from "@/lib/utils/stack";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { DEFAULT_MORPH_SNAPSHOT_ID } from "@/lib/utils/morph-defaults";
import { RESERVED_CMUX_PORT_SET } from "@cmux/shared/utils/reserved-cmux-ports";
import { parseGithubRepoUrl } from "@cmux/shared/utils/parse-github-repo-url";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { MorphCloudClient } from "morphcloud";
import { getPveLxcClient, type PveLxcInstance } from "@/lib/utils/pve-lxc-client";
import {
  type SandboxInstance,
  wrapMorphInstance,
  wrapPveLxcInstance,
} from "@/lib/utils/sandbox-instance";
import {
  isPveLxcInstanceId,
  getInstanceById,
  tryGetInstanceById,
  getInstanceTeamId,
} from "./sandboxes/provider-dispatch";
import { getActiveSandboxProvider } from "@/lib/utils/sandbox-provider";
import { loadEnvironmentEnvVars } from "./sandboxes/environment";
import {
  configureGithubAccess,
  configureGitIdentity,
  fetchGitIdentityInputs,
  getFreshGitHubToken,
} from "./sandboxes/git";
import type { HydrateRepoConfig } from "./sandboxes/hydration";
import { hydrateWorkspace } from "./sandboxes/hydration";
import { resolveTeamAndSnapshot } from "./sandboxes/snapshot";
import {
  allocateScriptIdentifiers,
  runMaintenanceAndDevScripts,
} from "./sandboxes/startDevAndMaintenanceScript";
import {
  encodeEnvContentForEnvctl,
  envctlLoadCommand,
} from "./utils/ensure-env-vars";
import { AGENT_CONFIGS, type EnvironmentResult } from "@cmux/shared/agentConfig";
import { getClaudeEnvironment } from "@cmux/shared/providers/anthropic/environment";
import { createApplyClaudeApiKeys } from "@cmux/shared/providers/anthropic/configs";
import {
  getOpenAIEnvironment,
  applyCodexApiKeys,
} from "@cmux/shared/providers/openai/environment";
import {
  getProviderRegistry,
  type ProviderOverride,
} from "@cmux/shared/provider-registry";

/**
 * Create a MorphCloudClient instance.
 * Throws if MORPH_API_KEY is not configured.
 */
function getMorphClient(): MorphCloudClient {
  if (!env.MORPH_API_KEY) {
    throw new Error("Morph API key not configured");
  }
  return new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
}

/**
 * Get MorphCloudClient if configured, or null for PVE-only deployments.
 * Use with getInstanceById() which handles null Morph client for PVE instances.
 */
function getMorphClientOrNull(): MorphCloudClient | null {
  if (!env.MORPH_API_KEY) {
    return null;
  }
  return new MorphCloudClient({ apiKey: env.MORPH_API_KEY });
}

function concatConfigBlocks(
  blocks: Array<string | null | undefined>,
  separator: string,
): string | null {
  const normalizedBlocks = blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block && block.length > 0));
  if (normalizedBlocks.length === 0) {
    return null;
  }
  return normalizedBlocks.join(separator);
}

// Provider dispatch helpers imported from ./sandboxes/provider-dispatch

/**
 * Wait for the VSCode server to be ready by polling the service URL.
 * This prevents "upstream connect error" when the iframe loads before the server is ready.
 */
async function waitForVSCodeReady(
  vscodeUrl: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const { timeoutMs = 15_000, intervalMs = 500 } = options;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // Use a simple HEAD request to check if the server is responding
      const response = await fetch(vscodeUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(3_000),
      });
      // OpenVSCode server returns 200 for the root path when ready
      if (response.ok || response.status === 302 || response.status === 301) {
        return true;
      }
    } catch {
      // Connection refused or timeout - server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Wait for the Worker socket server to be ready by polling the socket.io endpoint.
 * This prevents "Worker socket not available" errors when the agent spawner tries to connect
 * before the worker service is actually listening.
 */
async function waitForWorkerReady(
  workerUrl: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const { timeoutMs = 15_000, intervalMs = 500 } = options;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      // Worker service uses socket.io - check if the HTTP endpoint responds
      // Socket.io exposes a polling transport at /socket.io/?EIO=4&transport=polling
      const response = await fetch(`${workerUrl}/socket.io/?EIO=4&transport=polling`, {
        method: "GET",
        signal: AbortSignal.timeout(3_000),
      });
      // Socket.io returns 200 with polling data when ready
      if (response.ok) {
        return true;
      }
    } catch {
      // Connection refused or timeout - server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Extract a safe, descriptive error message from sandbox start errors.
 * Avoids leaking sensitive information like API keys, tokens, or internal paths.
 */
function getSandboxStartErrorMessage(error: unknown): string {
  const baseMessage = "Failed to start sandbox";

  if (!(error instanceof Error)) {
    return baseMessage;
  }

  const message = error.message.toLowerCase();

  // Check for common error patterns and provide helpful context
  // Network/connectivity issues
  if (message.includes("timeout") || message.includes("timed out")) {
    return `${baseMessage}: request timed out while provisioning instance`;
  }
  if (message.includes("econnrefused") || message.includes("connection refused")) {
    return `${baseMessage}: could not connect to sandbox provider`;
  }
  if (message.includes("enotfound") || message.includes("getaddrinfo")) {
    return `${baseMessage}: could not resolve sandbox provider address`;
  }
  if (message.includes("network") || message.includes("socket")) {
    return `${baseMessage}: network error while provisioning instance`;
  }

  // Quota/resource issues (common with cloud providers)
  if (message.includes("quota") || message.includes("limit") || message.includes("exceeded")) {
    return `${baseMessage}: resource quota exceeded`;
  }
  if (message.includes("capacity") || message.includes("unavailable")) {
    return `${baseMessage}: sandbox provider capacity unavailable`;
  }

  // Snapshot issues
  if (message.includes("snapshot") && (message.includes("not found") || message.includes("invalid"))) {
    return `${baseMessage}: snapshot not found or invalid`;
  }

  // Authentication/authorization (without revealing details)
  if (message.includes("unauthorized") || message.includes("401")) {
    return `${baseMessage}: authentication failed with sandbox provider`;
  }
  if (message.includes("forbidden") || message.includes("403")) {
    return `${baseMessage}: access denied by sandbox provider`;
  }

  // Rate limiting
  if (message.includes("rate limit") || message.includes("429") || message.includes("too many")) {
    return `${baseMessage}: rate limited by sandbox provider`;
  }

  // Instance startup issues
  if (message.includes("instance") && message.includes("start")) {
    return `${baseMessage}: instance failed to start`;
  }

  // If error message is reasonably safe (no obvious secrets patterns), include part of it
  const sensitivePatterns = [
    /api[_-]?key/i,
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
    /bearer/i,
    /authorization/i,
    /sk[_-][a-z0-9]/i,
    /pk[_-][a-z0-9]/i,
  ];

  const hasSensitiveContent = sensitivePatterns.some((pattern) =>
    pattern.test(error.message)
  );

  if (!hasSensitiveContent && error.message.length < 200) {
    // Sanitize the message: remove potential file paths and URLs
    const sanitized = error.message
      .replace(/\/[^\s]+/g, "[path]") // Replace file paths
      .replace(/https?:\/\/[^\s]+/g, "[url]") // Replace URLs
      .trim();

    if (sanitized.length > 0 && sanitized !== "[path]" && sanitized !== "[url]") {
      return `${baseMessage}: ${sanitized}`;
    }
  }

  return baseMessage;
}

/**
 * Write auth files to a sandbox instance.
 * Decodes base64 content, shell-escapes it, and writes with proper permissions.
 */
async function writeFilesToSandbox(
  instance: SandboxInstance,
  files: EnvironmentResult["files"],
): Promise<void> {
  for (const file of files) {
    const destPath = file.destinationPath.replace("$HOME", "/root");
    const content = Buffer.from(file.contentBase64, "base64").toString("utf-8");
    // Only escape single quotes for shell - backslashes are literal in single-quoted strings
    const escapedContent = content.replace(/'/g, "'\\''");
    const dirPath = destPath.substring(0, destPath.lastIndexOf("/"));
    await instance.exec(`mkdir -p '${dirPath}'`);
    await instance.exec(`printf '%s' '${escapedContent}' > '${destPath}'`);
    if (file.mode) {
      await instance.exec(`chmod ${file.mode} '${destPath}'`);
    }
  }
}

/**
 * Apply environment result (files, env vars, startup commands) to a sandbox.
 */
async function applyEnvironmentResult(
  instance: SandboxInstance,
  envResult: Partial<EnvironmentResult>,
  label: string,
): Promise<void> {
  // Write files
  if (envResult.files && envResult.files.length > 0) {
    await writeFilesToSandbox(instance, envResult.files);
    console.log(`[${label}] Wrote ${envResult.files.length} auth files`);
  }

  // Apply environment variables
  if (envResult.env && Object.keys(envResult.env).length > 0) {
    const envContent = Object.entries(envResult.env)
      .map(([k, v]) => `${k}="${v}"`)
      .join("\n");
    const encodedEnv = encodeEnvContentForEnvctl(envContent);
    await instance.exec(envctlLoadCommand(encodedEnv));
    console.log(
      `[${label}] Applied ${Object.keys(envResult.env).length} env vars`,
    );
  }

  // Unset env vars
  if (envResult.unsetEnv && envResult.unsetEnv.length > 0) {
    for (const varName of envResult.unsetEnv) {
      await instance.exec(`envctl unset ${varName} 2>/dev/null || true`);
    }
  }

  // Run startup commands
  if (
    "startupCommands" in envResult &&
    envResult.startupCommands &&
    envResult.startupCommands.length > 0
  ) {
    for (const cmd of envResult.startupCommands) {
      await instance.exec(cmd);
    }
  }
}

/**
 * Set up provider auth (Claude + Codex) on a sandbox instance.
 * Fetches API keys, provider overrides, and workspace settings from Convex,
 * then applies full environment setup for both Claude and Codex CLIs.
 *
 * This is non-fatal: failures are logged but do not block sandbox creation.
 */
async function setupProviderAuth(
  instance: SandboxInstance,
  convex: ReturnType<typeof getConvex>,
  options: {
    teamSlugOrId: string;
    taskRunId?: string;
    taskRunJwt?: string;
    callbackUrl: string;
  },
): Promise<{ providers: string[] }> {
  const configuredProviders: string[] = [];

  // Fetch API keys, provider overrides, and workspace settings in parallel
  const [apiKeys, providerOverrides, workspaceSettings] = await Promise.all([
    convex.query(api.apiKeys.getAllForAgents, {
      teamSlugOrId: options.teamSlugOrId,
    }),
    convex
      .query(api.providerOverrides.getForTeam, {
        teamSlugOrId: options.teamSlugOrId,
      })
      .catch((err: unknown) => {
        console.error(
          "[setupProviderAuth] Failed to fetch provider overrides",
          err,
        );
        return [];
      }),
    convex
      .query(api.workspaceSettings.get, {
        teamSlugOrId: options.teamSlugOrId,
      })
      .catch((err: unknown) => {
        console.error(
          "[setupProviderAuth] Failed to fetch workspace settings",
          err,
        );
        return null;
      }),
  ]);

  // Resolve provider overrides into the shape expected by environment functions
  const registry = getProviderRegistry();
  const overrideMapped: ProviderOverride[] = providerOverrides.map(
    (o): ProviderOverride => ({
      teamId: String(o.teamId),
      providerId: o.providerId,
      baseUrl: o.baseUrl,
      apiFormat: o.apiFormat,
      apiKeyEnvVar: o.apiKeyEnvVar,
      customHeaders: o.customHeaders,
      fallbacks: o.fallbacks,
      enabled: o.enabled,
    }),
  );

  // --- Claude (Anthropic) auth ---
  try {
    const hasClaudeKeys =
      apiKeys.ANTHROPIC_API_KEY || apiKeys.CLAUDE_CODE_OAUTH_TOKEN;
    if (hasClaudeKeys) {
      const resolvedClaude = registry.resolveForAgent(
        "claude/opus-4.6",
        overrideMapped,
      );

      // Run full environment setup (hooks, memory, MCP, settings.json)
      // If no taskRunJwt, bypass proxy to avoid empty x-cmux-token header failures
      const shouldBypassProxy =
        workspaceSettings?.bypassAnthropicProxy ?? !options.taskRunJwt;
      const claudeEnvResult = await getClaudeEnvironment({
        taskRunId: options.taskRunId || "",
        taskRunJwt: options.taskRunJwt || "",
        prompt: "",
        apiKeys,
        callbackUrl: options.callbackUrl,
        workspaceSettings: {
          bypassAnthropicProxy: shouldBypassProxy,
        },
        providerConfig: resolvedClaude?.isOverridden
          ? {
              baseUrl: resolvedClaude.baseUrl,
              customHeaders: resolvedClaude.customHeaders,
              apiFormat: resolvedClaude.apiFormat,
              isOverridden: true,
            }
          : undefined,
      });

      await applyEnvironmentResult(
        instance,
        claudeEnvResult,
        "setupProviderAuth:claude",
      );

      // Also apply API keys (OAuth token or API key injection)
      const applyClaudeKeys = createApplyClaudeApiKeys();
      const claudeKeysResult = await applyClaudeKeys(apiKeys);
      await applyEnvironmentResult(
        instance,
        claudeKeysResult,
        "setupProviderAuth:claude-keys",
      );

      configuredProviders.push("claude");
      console.log("[setupProviderAuth] Claude provider auth configured");
    }
  } catch (error) {
    console.error("[setupProviderAuth] Failed to set up Claude auth:", error);
  }

  // --- Codex (OpenAI) auth ---
  try {
    const hasCodexKeys = apiKeys.OPENAI_API_KEY || apiKeys.CODEX_AUTH_JSON;
    if (hasCodexKeys) {
      const resolvedOpenAI = registry.resolveForAgent(
        "codex/gpt-5.2-codex-xhigh",
        overrideMapped,
      );

      // Run full environment setup (notify hooks, config.toml, memory, MCP)
      const codexEnvResult = await getOpenAIEnvironment({
        taskRunId: options.taskRunId || "",
        taskRunJwt: options.taskRunJwt || "",
        prompt: "",
        apiKeys,
        callbackUrl: options.callbackUrl,
        providerConfig: resolvedOpenAI?.isOverridden
          ? {
              baseUrl: resolvedOpenAI.baseUrl,
              customHeaders: resolvedOpenAI.customHeaders,
              apiFormat: resolvedOpenAI.apiFormat,
              isOverridden: true,
            }
          : undefined,
      });

      await applyEnvironmentResult(
        instance,
        codexEnvResult,
        "setupProviderAuth:codex",
      );

      // Also apply API keys (auth.json or env var injection)
      const codexKeysResult = applyCodexApiKeys(apiKeys);
      await applyEnvironmentResult(
        instance,
        codexKeysResult,
        "setupProviderAuth:codex-keys",
      );

      configuredProviders.push("codex");
      console.log("[setupProviderAuth] Codex provider auth configured");
    }
  } catch (error) {
    console.error("[setupProviderAuth] Failed to set up Codex auth:", error);
  }

  return { providers: configuredProviders };
}

/**
 * Cmux instance metadata stored in Morph instance.metadata
 */
interface CmuxInstanceMetadata {
  app?: string;
  userId?: string;
  teamId?: string;
}

/**
 * Result of instance ownership verification
 */
type VerifyInstanceOwnershipResult =
  | { authorized: true; instanceId: string }
  | { authorized: false; status: 403 | 404; message: string };

/**
 * Verify that a user owns or has team access to a Morph instance.
 * Checks instance metadata for cmux app prefix and user/team ownership.
 */
async function verifyInstanceOwnership(
  morphClient: MorphCloudClient,
  instanceId: string,
  userId: string,
  checkTeamMembership: () => Promise<{ teamId: string }[]>
): Promise<VerifyInstanceOwnershipResult> {
  let instance;
  try {
    instance = await morphClient.instances.get({ instanceId });
  } catch {
    return { authorized: false, status: 404, message: "Instance not found" };
  }

  const meta = instance.metadata as CmuxInstanceMetadata | undefined;

  // Verify the instance belongs to cmux (accepts cmux, cmux-dev, cmux-preview, etc.)
  if (!meta?.app?.startsWith("cmux")) {
    return { authorized: false, status: 404, message: "Instance not found" };
  }

  // Check direct ownership
  const isOwner = meta.userId === userId;
  if (isOwner) {
    return { authorized: true, instanceId };
  }

  // Check team membership if instance has a teamId
  if (meta.teamId) {
    try {
      const memberships = await checkTeamMembership();
      const isTeamMember = memberships.some((m) => m.teamId === meta.teamId);
      if (isTeamMember) {
        return { authorized: true, instanceId };
      }
    } catch {
      // Failed to check team membership - continue to deny
    }
  }

  return {
    authorized: false,
    status: 403,
    message: "Forbidden - not authorized to access this instance",
  };
}

export const sandboxesRouter = new OpenAPIHono();

const StartSandboxBody = z
  .object({
    teamSlugOrId: z.string(),
    environmentId: z.string().optional(),
    snapshotId: z.string().optional(),
    ttlSeconds: z
      .number()
      .optional()
      .default(60 * 60),
    metadata: z.record(z.string(), z.string()).optional(),
    taskRunId: z.string().optional(),
    taskRunJwt: z.string().optional(),
    isCloudWorkspace: z.boolean().optional(),
    // Optional hydration parameters to clone a repo into the sandbox on start
    repoUrl: z.string().optional(),
    branch: z.string().optional(),
    newBranch: z.string().optional(),
    depth: z.number().optional().default(1),
    // Agent parameters for CLI task creation - triggers agent startup after sandbox is ready
    agentName: z.string().optional(),
    prompt: z.string().optional(),
  })
  .openapi("StartSandboxBody");

const StartSandboxResponse = z
  .object({
    instanceId: z.string(),
    vscodeUrl: z.string(),
    workerUrl: z.string(),
    vncUrl: z.string().optional(),
    xtermUrl: z.string().optional(),
    provider: z.enum(["morph", "pve-lxc"]).default("morph"),
    vscodePersisted: z.boolean().optional(),
  })
  .openapi("StartSandboxResponse");

const UpdateSandboxEnvBody = z
  .object({
    teamSlugOrId: z.string(),
    envVarsContent: z.string(),
  })
  .openapi("UpdateSandboxEnvBody");

const UpdateSandboxEnvResponse = z
  .object({
    applied: z.literal(true),
  })
  .openapi("UpdateSandboxEnvResponse");

// Start a new sandbox (currently Morph-backed)
sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/start",
    tags: ["Sandboxes"],
    summary: "Start a sandbox environment",
    request: {
      body: {
        content: {
          "application/json": {
            schema: StartSandboxBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: StartSandboxResponse,
          },
        },
        description: "Sandbox started successfully",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to start sandbox" },
    },
  }),
  async (c) => {
    // Support both cookie-based (web) and Bearer token (CLI) authentication
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const githubAccessTokenPromise = (async () => {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return {
          githubAccessTokenError: "GitHub account not found",
          githubAccessToken: null,
        } as const;
      }
      const { accessToken: githubAccessToken } =
        await githubAccount.getAccessToken();
      if (!githubAccessToken) {
        return {
          githubAccessTokenError: "GitHub access token not found",
          githubAccessToken: null,
        } as const;
      }

      return { githubAccessTokenError: null, githubAccessToken } as const;
    })();

    const body = c.req.valid("json");
    try {
      console.log("[sandboxes.start] incoming", {
        teamSlugOrId: body.teamSlugOrId,
        hasEnvId: Boolean(body.environmentId),
        hasSnapshotId: Boolean(body.snapshotId),
        repoUrl: body.repoUrl,
        branch: body.branch,
      });
    } catch {
      /* noop */
    }

    try {
      const convex = getConvex({ accessToken });

      const {
        team,
        provider,
        resolvedSnapshotId,
        resolvedTemplateVmid,
        environmentDataVaultKey,
        environmentMaintenanceScript,
        environmentDevScript,
        environmentSelectedRepos,
      } = await resolveTeamAndSnapshot({
        req: c.req.raw,
        convex,
        teamSlugOrId: body.teamSlugOrId,
        environmentId: body.environmentId,
        snapshotId: body.snapshotId,
      });

      const environmentEnvVarsPromise = environmentDataVaultKey
        ? loadEnvironmentEnvVars(environmentDataVaultKey)
        : Promise.resolve<string | null>(null);

      // Use body.repoUrl if provided, otherwise fall back to first selectedRepo from environment
      const repoUrl = body.repoUrl ?? environmentSelectedRepos?.[0] ?? null;
      if (!body.repoUrl && environmentSelectedRepos?.[0]) {
        console.log(`[sandboxes.start] Using environment selectedRepo: ${repoUrl}`);
      }
      // Parse repo URL once if provided
      const parsedRepoUrl = repoUrl ? parseGithubRepoUrl(repoUrl) : null;

      const workspaceConfigRepoInputs = body.environmentId
        ? environmentSelectedRepos ?? []
        : parsedRepoUrl
          ? [parsedRepoUrl.fullName]
          : [];
      const workspaceConfigRepos = Array.from(
        new Set(
          workspaceConfigRepoInputs.flatMap((repoInput) => {
            const parsedRepo = parseGithubRepoUrl(repoInput);
            if (!parsedRepo) {
              console.warn(
                `[sandboxes.start] Skipping invalid workspace config repo "${repoInput}"`,
              );
              return [];
            }
            return [parsedRepo.fullName];
          }),
        ),
      );

      const workspaceConfigs = await Promise.all(
        workspaceConfigRepos.map(async (projectFullName) => {
          try {
            const config = await convex.query(api.workspaceConfigs.get, {
              teamSlugOrId: body.teamSlugOrId,
              projectFullName,
            });
            if (!config) {
              return null;
            }
            const envVarsContent = config.dataVaultKey
              ? await loadEnvironmentEnvVars(config.dataVaultKey)
              : null;
            console.log(`[sandboxes.start] Loaded workspace config for ${projectFullName}`, {
              hasMaintenanceScript: Boolean(config.maintenanceScript),
              hasEnvVars: Boolean(envVarsContent),
            });
            return {
              projectFullName,
              maintenanceScript: config.maintenanceScript ?? undefined,
              envVarsContent: envVarsContent ?? undefined,
            };
          } catch (error) {
            console.error(
              `[sandboxes.start] Failed to load workspace config for ${projectFullName}`,
              error,
            );
            return null;
          }
        }),
      );
      const loadedWorkspaceConfigs = workspaceConfigs.flatMap((config) =>
        config ? [config] : [],
      );
      const workspaceMaintenanceScript = concatConfigBlocks(
        loadedWorkspaceConfigs.map((config) => config.maintenanceScript),
        "\n\n",
      );
      const workspaceEnvVarsContent = concatConfigBlocks(
        loadedWorkspaceConfigs.map((config) => config.envVarsContent),
        "\n",
      );

      const maintenanceScript = concatConfigBlocks(
        [workspaceMaintenanceScript, environmentMaintenanceScript],
        "\n\n",
      );
      const devScript = environmentDevScript ?? null;

      const isCloudWorkspace =
        body.isCloudWorkspace !== undefined
          ? body.isCloudWorkspace
          : !body.taskRunId;

      const scriptIdentifiers =
        maintenanceScript || devScript
          ? allocateScriptIdentifiers()
          : null;

      const gitIdentityPromise = githubAccessTokenPromise.then(
        ({ githubAccessToken }) => {
          if (!githubAccessToken) {
            throw new Error("GitHub access token not found");
          }
          return fetchGitIdentityInputs(convex, githubAccessToken);
        },
      );

      // Start the sandbox using the appropriate provider
      let instance: SandboxInstance | null = null;
      let rawPveLxcInstance: PveLxcInstance | null = null;
      let usedWarmPool = false;
      let warmPoolRepoUrl: string | undefined;
      let warmPoolBranch: string | undefined;

      if (provider === "pve-lxc") {
        // Proxmox VE LXC provider
        console.log(`[sandboxes.start] Starting PVE LXC sandbox with snapshot ${resolvedSnapshotId}`);
        const pveClient = getPveLxcClient();
        rawPveLxcInstance = await pveClient.instances.start({
          snapshotId: resolvedSnapshotId,
          templateVmid: resolvedTemplateVmid,
          ttlSeconds: body.ttlSeconds ?? 60 * 60,
          ttlAction: "pause",
          metadata: {
            app: "cmux",
            teamId: team.uuid,
            userId: user.id,
            ...(body.environmentId ? { environmentId: body.environmentId } : {}),
            ...(body.metadata || {}),
          },
        });
        instance = wrapPveLxcInstance(rawPveLxcInstance);
        console.log(`[sandboxes.start] PVE LXC sandbox started: ${instance.id}`);
      } else {
        // Morph provider (default)
        const client = getMorphClient();

        if (!body.environmentId) {
          try {
            const claimed = await convex.mutation(api.warmPool.claimInstance, {
              teamId: team.uuid,
              repoUrl: repoUrl ?? undefined,
              branch: body.branch ?? undefined,
              taskRunId: body.taskRunId || "",
            });

            if (claimed) {
              console.log(
                `[sandboxes.start] Claimed warm pool instance ${claimed.instanceId}`,
              );
              let claimedMorphInstance = await client.instances.get({
                instanceId: claimed.instanceId,
              });
              if (claimedMorphInstance.networking.httpServices.length === 0) {
                claimedMorphInstance = await client.instances.get({
                  instanceId: claimed.instanceId,
                });
              }

              const claimedWrapped = wrapMorphInstance(claimedMorphInstance);
              const claimedExposed = claimedWrapped.networking.httpServices;
              const claimedVscodeService = claimedExposed.find(
                (service) => service.port === 39378,
              );
              const claimedWorkerService = claimedExposed.find(
                (service) => service.port === 39377,
              );
              if (claimedVscodeService && claimedWorkerService) {
                instance = claimedWrapped;
                usedWarmPool = true;
                warmPoolRepoUrl = claimed.repoUrl;
                warmPoolBranch = claimed.branch;
                void (async () => {
                  await instance.setWakeOn(true, true);
                })();
              } else {
                console.warn(
                  `[sandboxes.start] Warm pool instance ${claimed.instanceId} missing services, falling back to on-demand start`,
                );
              }
            }
          } catch (error) {
            console.error(
              "[sandboxes.start] Warm pool claim failed, falling back to on-demand start",
              error,
            );
          }
        }

        if (!usedWarmPool) {
          const morphInstance = await client.instances.start({
            snapshotId: resolvedSnapshotId,
            ttlSeconds: body.ttlSeconds ?? 60 * 60,
            ttlAction: "pause",
            metadata: {
              app: "cmux",
              teamId: team.uuid,
              ...(body.environmentId ? { environmentId: body.environmentId } : {}),
              ...(body.metadata || {}),
            },
          });
          instance = wrapMorphInstance(morphInstance);
          void (async () => {
            await instance.setWakeOn(true, true);
          })();
        }
      }

      if (!instance) {
        return c.text("Failed to start sandbox instance", 500);
      }

      // Record sandbox creation in Convex for activity tracking
      // This enables the maintenance cron to properly track and garbage collect instances
      try {
        await convex.mutation(api.sandboxInstances.recordCreate, {
          instanceId: instance.id,
          provider: provider === "pve-lxc" ? "pve-lxc" : "morph",
          vmid: rawPveLxcInstance?.vmid,
          hostname: rawPveLxcInstance?.networking.hostname,
          snapshotId: resolvedSnapshotId,
          snapshotProvider: provider === "pve-lxc" ? "pve-lxc" : "morph",
          templateVmid: resolvedTemplateVmid,
          teamSlugOrId: body.teamSlugOrId,
        });
        console.log(`[sandboxes.start] Recorded instance creation for ${instance.id}`);
      } catch (error) {
        // Non-fatal: instance is created, but activity tracking may not work
        console.error(
          "[sandboxes.start] Failed to record instance creation (non-fatal):",
          error,
        );
      }

      // SDK bug: instances.start() returns empty httpServices array
      // Re-fetch instance to get the actual networking data
      let refreshedInstance: SandboxInstance = instance;
      if (instance.networking.httpServices.length === 0) {
        refreshedInstance = await getInstanceById(instance.id, getMorphClientOrNull());
      }

      const exposed = refreshedInstance.networking.httpServices;
      const vscodeService = exposed.find((service) => service.port === 39378);
      // PVE-LXC uses port 39376 for Node.js worker (Go worker uses 39377)
      // Morph uses port 39377 for Node.js worker
      const workerPort = provider === "pve-lxc" ? 39376 : 39377;
      const workerService = exposed.find((service) => service.port === workerPort);
      const vncService = exposed.find((service) => service.port === 39380);
      const xtermService = exposed.find((service) => service.port === 39383);
      if (!vscodeService || !workerService) {
        await instance.stop().catch((stopError) => {
          console.error(`[sandboxes.start] Failed to stop instance ${instance.id}:`, stopError);
        });
        return c.text("VSCode or worker service not found", 500);
      }

      // Wait for VSCode server to be ready before persisting URL
      // This prevents "upstream connect error" when the frontend loads the iframe
      // before the OpenVSCode server is actually listening
      const vscodeReady = await waitForVSCodeReady(vscodeService.url);
      if (!vscodeReady) {
        console.warn(
          `[sandboxes.start] VSCode server did not become ready within timeout for ${instance.id}, proceeding anyway`,
        );
      } else {
        console.log(
          `[sandboxes.start] VSCode server ready for ${instance.id}`,
        );
      }

      // Wait for Worker socket server to be ready before returning
      // This prevents "Worker socket not available" errors when the agent spawner
      // tries to connect before the worker service is actually listening
      const workerReady = await waitForWorkerReady(workerService.url);
      if (!workerReady) {
        console.warn(
          `[sandboxes.start] Worker server did not become ready within timeout for ${instance.id}, proceeding anyway`,
        );
      } else {
        console.log(
          `[sandboxes.start] Worker server ready for ${instance.id}`,
        );
      }

      // Persist VSCode URLs to Convex once the server is ready
      // Status is "starting" to indicate hydration is still in progress
      let vscodePersisted = false;
      if (body.taskRunId) {
        try {
          await convex.mutation(api.taskRuns.updateVSCodeInstance, {
            teamSlugOrId: body.teamSlugOrId,
            id: body.taskRunId as Id<"taskRuns">,
            vscode: {
              provider: provider === "pve-lxc" ? "pve-lxc" : "morph",
              containerName: instance.id,
              status: "starting",
              url: vscodeService.url,
              workspaceUrl: `${vscodeService.url}/?folder=/root/workspace`,
              vncUrl: vncService?.url,
              xtermUrl: xtermService?.url,
              startedAt: Date.now(),
            },
          });
          vscodePersisted = true;
          console.log(
            `[sandboxes.start] Persisted VSCode info for ${body.taskRunId}`,
          );
        } catch (error) {
          console.error(
            "[sandboxes.start] Failed to persist VSCode info (non-fatal):",
            error,
          );
        }

        // Store environment repos as discovered repos for git diff
        // This allows the git diff UI to work immediately without waiting for discovery
        if (environmentSelectedRepos && environmentSelectedRepos.length > 0) {
          try {
            await convex.mutation(api.taskRuns.updateDiscoveredRepos, {
              teamSlugOrId: body.teamSlugOrId,
              runId: body.taskRunId as Id<"taskRuns">,
              discoveredRepos: environmentSelectedRepos,
            });
            console.log(
              `[sandboxes.start] Stored discovered repos for ${body.taskRunId}:`,
              environmentSelectedRepos
            );
          } catch (error) {
            console.error(
              "[sandboxes.start] Failed to store discovered repos (non-fatal):",
              error,
            );
          }
        }
      }

      // Get environment variables from the environment if configured
      const environmentEnvVarsContent = await environmentEnvVarsPromise;

      // Prepare environment variables including task JWT if present
      // Workspace config env vars are the base layer, environment vars override later.
      let envVarsToApply =
        concatConfigBlocks(
          [workspaceEnvVarsContent, environmentEnvVarsContent],
          "\n",
        ) ?? "";

      // Add CMUX task-related env vars if present
      if (body.taskRunId) {
        envVarsToApply += `\nCMUX_TASK_RUN_ID="${body.taskRunId}"`;
      }
      if (body.taskRunJwt) {
        envVarsToApply += `\nCMUX_TASK_RUN_JWT="${body.taskRunJwt}"`;
        // Also add the JWT secret so the worker can verify tokens for image uploads
        // Only add if the secret is configured to avoid injecting "undefined" as a literal value
        if (env.CMUX_TASK_RUN_JWT_SECRET) {
          envVarsToApply += `\nCMUX_TASK_RUN_JWT_SECRET="${env.CMUX_TASK_RUN_JWT_SECRET}"`;
        } else {
          console.warn(
            "[sandboxes.start] CMUX_TASK_RUN_JWT_SECRET not configured, image uploads will not work",
          );
        }
      }

      // Apply all environment variables if any
      if (envVarsToApply.trim().length > 0) {
        try {
          const encodedEnv = encodeEnvContentForEnvctl(envVarsToApply);
          const loadRes = await instance.exec(envctlLoadCommand(encodedEnv));
          if (loadRes.exit_code === 0) {
            console.log(
              `[sandboxes.start] Applied environment variables via envctl`,
              {
                hasEnvironmentVars: Boolean(environmentEnvVarsContent),
                hasWorkspaceVars: Boolean(workspaceEnvVarsContent),
                hasTaskRunId: Boolean(body.taskRunId),
                hasTaskRunJwt: Boolean(body.taskRunJwt),
              },
            );
          } else {
            console.error(
              `[sandboxes.start] Env var bootstrap failed exit=${loadRes.exit_code} stderr=${(loadRes.stderr || "").slice(0, 200)}`,
            );
          }
        } catch (error) {
          console.error(
            "[sandboxes.start] Failed to apply environment variables",
            error,
          );
        }
      }

      // Fetch user API keys early so they're available for provider auth and agent startup
      const userApiKeysPromise = convex
        .query(api.apiKeys.getAllForAgents, {
          teamSlugOrId: body.teamSlugOrId,
        })
        .catch((err: unknown) => {
          console.error(
            "[sandboxes.start] Failed to fetch API keys (non-fatal):",
            err,
          );
          return {} as Record<string, string>;
        });

      // Set up provider auth (Claude + Codex) so CLIs work out of the box
      // This runs for all sandbox starts (web UI cloud workspace, task create, devsh)
      const providerAuthPromise = (async () => {
        try {
          const callbackUrl =
            env.NEXT_PUBLIC_CONVEX_URL || "http://localhost:9779";
          const result = await setupProviderAuth(instance, convex, {
            teamSlugOrId: body.teamSlugOrId,
            taskRunId: body.taskRunId || undefined,
            taskRunJwt: body.taskRunJwt || undefined,
            callbackUrl,
          });
          if (result.providers.length > 0) {
            console.log(
              `[sandboxes.start] Provider auth configured: ${result.providers.join(", ")}`,
            );
          }
        } catch (error) {
          console.error(
            "[sandboxes.start] Provider auth setup failed (non-fatal):",
            error,
          );
        }
      })();

      const configureGitIdentityTask = gitIdentityPromise
        .then(([who, gh]) => {
          const { name, email } = selectGitIdentity(who, gh);
          return configureGitIdentity(instance, { name, email });
        })
        .catch((error) => {
          console.log(
            `[sandboxes.start] Failed to configure git identity; continuing...`,
            error,
          );
        });

      const { githubAccessToken, githubAccessTokenError } =
        await githubAccessTokenPromise;
      if (githubAccessTokenError) {
        console.error(
          `[sandboxes.start] GitHub access token error: ${githubAccessTokenError}`,
        );
        return c.text("Failed to resolve GitHub credentials", 401);
      }

      // Try to use GitHub App installation token for better permission scope.
      // The user's OAuth token from Stack Auth may not have 'repo' scope needed for private repos.
      let gitAuthToken = githubAccessToken;
      if (parsedRepoUrl) {
        try {
          // Look up GitHub App installation for the repo's owner
          const connections = await convex.query(api.github.listProviderConnections, {
            teamSlugOrId: body.teamSlugOrId,
          });
          const targetConnection = connections.find(
            (co) =>
              co.isActive &&
              co.accountLogin?.toLowerCase() === parsedRepoUrl.owner.toLowerCase()
          );
          if (targetConnection) {
            console.log(
              `[sandboxes.start] Found GitHub App installation ${targetConnection.installationId} for ${parsedRepoUrl.owner}`
            );
            const appToken = await generateGitHubInstallationToken({
              installationId: targetConnection.installationId,
              repositories: [parsedRepoUrl.fullName],
              permissions: {
                contents: "write",
                metadata: "read",
                // Required for pushing workflow files (.github/workflows/*)
                // Without this, pushes containing workflow files are rejected
                workflows: "write",
              },
            });
            gitAuthToken = appToken;
            console.log(
              `[sandboxes.start] Using GitHub App token for git authentication`
            );
          } else {
            console.log(
              `[sandboxes.start] No GitHub App installation found for ${parsedRepoUrl.owner}, using user OAuth token`
            );
          }
        } catch (error) {
          console.error(
            `[sandboxes.start] Failed to get GitHub App token, falling back to user OAuth:`,
            error
          );
        }
      }

      await configureGithubAccess(instance, gitAuthToken);

      // Only skip hydration if both repo URL and branch match the warm pool instance
      // This ensures we don't use wrong branch when user prewarmed with different branch
      const requestedBranch = body.branch ?? undefined;
      const skipHydration =
        usedWarmPool &&
        typeof repoUrl === "string" &&
        repoUrl.length > 0 &&
        warmPoolRepoUrl === repoUrl &&
        warmPoolBranch === requestedBranch;
      if (skipHydration) {
        console.log(
          `[sandboxes.start] Skipping hydration - repo and branch already cloned in warm pool instance ${instance.id}`,
        );
      } else {
        let repoConfig: HydrateRepoConfig | undefined;
        if (repoUrl) {
          console.log(`[sandboxes.start] Hydrating repo for ${instance.id}`);
          if (!parsedRepoUrl) {
            return c.text("Unsupported repo URL; expected GitHub URL", 400);
          }
          console.log(`[sandboxes.start] Parsed owner/repo: ${parsedRepoUrl.fullName}`);

          // Use authenticated URL for cloning when token available (required for private repos)
          const authenticatedGitUrl = gitAuthToken
            ? `https://x-access-token:${gitAuthToken}@github.com/${parsedRepoUrl.owner}/${parsedRepoUrl.repo}.git`
            : parsedRepoUrl.gitUrl;
          const maskedGitUrl = gitAuthToken
            ? `https://x-access-token:***@github.com/${parsedRepoUrl.owner}/${parsedRepoUrl.repo}.git`
            : parsedRepoUrl.gitUrl;

          repoConfig = {
            owner: parsedRepoUrl.owner,
            name: parsedRepoUrl.repo,
            repoFull: parsedRepoUrl.fullName,
            cloneUrl: authenticatedGitUrl,
            maskedCloneUrl: maskedGitUrl,
            depth: Math.max(1, Math.floor(body.depth ?? 1)),
            baseBranch: body.branch || "main",
            newBranch: body.newBranch ?? "",
          };
        }

        try {
          await hydrateWorkspace({
            instance,
            repo: repoConfig,
          });
        } catch (error) {
          console.error(`[sandboxes.start] Hydration failed:`, error);
          await instance.stop().catch((stopError) => {
            console.error(`[sandboxes.start] Failed to stop instance ${instance.id} after hydration failure:`, stopError);
          });
          return c.text("Failed to hydrate sandbox", 500);
        }
      }

      // Capture starting commit SHA for diff baseline (after hydration, before agent runs)
      if (body.taskRunId) {
        console.log(
          "[sandboxes.start] Capturing starting commit SHA for taskRunId:",
          body.taskRunId,
        );
        try {
          const execResult = await instance.exec(
            "git -C /root/workspace rev-parse HEAD",
          );
          console.log("[sandboxes.start] git rev-parse HEAD result:", {
            exit_code: execResult.exit_code,
            stdout: execResult.stdout?.substring(0, 50),
          });
          if (execResult.exit_code === 0 && execResult.stdout) {
            const startingCommitSha = execResult.stdout.trim();
            console.log(
              "[sandboxes.start] Starting commit SHA:",
              startingCommitSha,
              "length:",
              startingCommitSha.length,
            );
            if (startingCommitSha.length === 40) {
              console.log(
                "[sandboxes.start] Saving startingCommitSha to Convex:",
                startingCommitSha,
              );
              void convex
                .mutation(api.taskRuns.updateStartingCommitSha, {
                  teamSlugOrId: body.teamSlugOrId,
                  id: body.taskRunId as Id<"taskRuns">,
                  startingCommitSha,
                })
                .catch((error) => {
                  console.error(
                    "[sandboxes.start] Failed to update starting commit SHA:",
                    error,
                  );
                });
            }
          }
        } catch (error) {
          console.error(
            "[sandboxes.start] Failed to capture starting commit SHA:",
            error,
          );
        }
      }

      // Update status to "running" after hydration completes
      if (body.taskRunId && vscodePersisted) {
        void convex
          .mutation(api.taskRuns.updateVSCodeStatus, {
            teamSlugOrId: body.teamSlugOrId,
            id: body.taskRunId as Id<"taskRuns">,
            status: "running",
          })
          .catch((error) => {
            console.error(
              "[sandboxes.start] Failed to update VSCode status to running:",
              error,
            );
          });
      }

      // Populate projectFullName and baseBranch on the task for crown evaluation refresh.
      // This ensures GitHub diff info is available when retrying crown evaluation.
      if (body.taskRunId && parsedRepoUrl) {
        void (async () => {
          try {
            const taskRun = await convex.query(api.taskRuns.get, {
              teamSlugOrId: body.teamSlugOrId,
              id: body.taskRunId as Id<"taskRuns">,
            });
            if (taskRun) {
              await convex.mutation(api.tasks.setProjectAndBranch, {
                teamSlugOrId: body.teamSlugOrId,
                id: taskRun.taskId,
                projectFullName: parsedRepoUrl.fullName,
                baseBranch: body.branch ?? "main",
              });
            }
          } catch (error) {
            console.error(
              "[sandboxes.start] Failed to set project and branch info:",
              error,
            );
          }
        })();
      }

      if (maintenanceScript || devScript) {
        (async () => {
          await runMaintenanceAndDevScripts({
            instance,
            maintenanceScript: maintenanceScript || undefined,
            devScript: devScript || undefined,
            identifiers: scriptIdentifiers ?? undefined,
            convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
            taskRunJwt: body.taskRunJwt || undefined,
            isCloudWorkspace,
          });
        })().catch((error) => {
          console.error(
            "[sandboxes.start] Background script execution failed:",
            error,
          );
        });
      }

      await configureGitIdentityTask;

      // If agent name and prompt are provided, start the agent in the sandbox
      // This is used by CLI task creation to spawn agents without the desktop app
      if (body.agentName && body.prompt) {
        // Ensure provider auth is complete before starting the agent
        await providerAuthPromise;

        const agentConfig = AGENT_CONFIGS.find(
          (a) => a.name === body.agentName
        );
        if (agentConfig) {
          console.log(
            `[sandboxes.start] Starting agent ${body.agentName} with prompt`
          );

          // Get agent environment setup (files, env vars, startup commands)
          if (agentConfig.environment) {
            try {
              const callbackUrl = env.NEXT_PUBLIC_CONVEX_URL || "http://localhost:9779";
              const resolvedApiKeys = await userApiKeysPromise;
              const envResult = await agentConfig.environment({
                taskRunId: body.taskRunId || "",
                taskRunJwt: body.taskRunJwt || "",
                prompt: body.prompt,
                apiKeys: resolvedApiKeys,
                callbackUrl,
              });

              await applyEnvironmentResult(
                instance,
                envResult,
                "sandboxes.start:agent-env",
              );
            } catch (envError) {
              console.error(
                `[sandboxes.start] Failed to set up agent environment:`,
                envError
              );
              // Continue anyway - the agent might still work
            }
          }

          // Start the agent via worker HTTP API for proper PTY/terminal integration
          const agentCmd = [agentConfig.command, ...agentConfig.args].join(" ");
          const terminalId = `agent-${body.taskRunId || "cli"}`;

          try {
            // Call worker HTTP API to create terminal
            const createTerminalResponse = await fetch(
              `${workerService.url}/api/create-terminal`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  terminalId,
                  taskRunId: body.taskRunId,
                  taskRunJwt: body.taskRunJwt,
                  agentName: agentConfig.name,
                  prompt: body.prompt,
                  ptyCommand: agentCmd,
                  cwd: "/root/workspace",
                  env: {},
                  startupCommands: [],
                  postStartCommands: [],
                  convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
                }),
                signal: AbortSignal.timeout(30000),
              }
            );

            if (createTerminalResponse.ok) {
              const result = await createTerminalResponse.json();
              console.log(
                `[sandboxes.start] Started agent terminal via worker API: ${terminalId}`,
                result
              );
            } else {
              const errorText = await createTerminalResponse.text();
              console.error(
                `[sandboxes.start] Failed to create agent terminal: ${createTerminalResponse.status} ${errorText}`
              );
              // Fall back to tmux if worker API fails
              const fallbackCmd = `tmux new-session -d -s '${terminalId}' -c /root/workspace 'source /etc/profile 2>/dev/null || true; ${agentCmd}'`;
              await instance.exec(fallbackCmd);
              console.log(
                `[sandboxes.start] Fell back to tmux for agent: ${terminalId}`
              );
            }
          } catch (startError) {
            console.error(
              `[sandboxes.start] Failed to start agent via worker API:`,
              startError
            );
            // Fall back to tmux
            try {
              const fallbackCmd = `tmux new-session -d -s '${terminalId}' -c /root/workspace 'source /etc/profile 2>/dev/null || true; ${agentCmd}'`;
              await instance.exec(fallbackCmd);
              console.log(
                `[sandboxes.start] Fell back to tmux for agent: ${terminalId}`
              );
            } catch (fallbackError) {
              console.error(
                `[sandboxes.start] Tmux fallback also failed:`,
                fallbackError
              );
            }
          }
        } else {
          console.warn(
            `[sandboxes.start] Unknown agent: ${body.agentName}, skipping agent startup`
          );
        }
      }

      // Ensure provider auth completes before returning
      await providerAuthPromise;

      return c.json({
        instanceId: instance.id,
        vscodeUrl: vscodeService.url,
        workerUrl: workerService.url,
        vncUrl: vncService?.url,
        xtermUrl: xtermService?.url,
        provider: provider === "pve-lxc" ? "pve-lxc" : "morph",
        vscodePersisted,
      });
    } catch (error) {
      if (error instanceof HTTPException) {
        const message =
          typeof error.message === "string" && error.message.length > 0
            ? error.message
            : "Request failed";
        return c.text(message, error.status);
      }
      console.error("Failed to start sandbox:", error);
      // Provide a more descriptive error message without leaking sensitive details
      const errorMessage = getSandboxStartErrorMessage(error);
      return c.text(errorMessage, 500);
    }
  },
);

// Set up provider auth (Claude + Codex) on an existing sandbox instance.
// Used by `devsh start` after VM creation, and other cases where a sandbox
// was created without provider auth.

const SetupProvidersBody = z
  .object({
    teamSlugOrId: z.string(),
    taskRunId: z.string().optional(),
    taskRunJwt: z.string().optional(),
  })
  .openapi("SetupProvidersBody");

const SetupProvidersResponse = z
  .object({
    success: z.boolean(),
    providers: z.array(z.string()),
  })
  .openapi("SetupProvidersResponse");

sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/setup-providers",
    tags: ["Sandboxes"],
    summary: "Set up provider auth on an existing sandbox",
    description:
      "Configures Claude and Codex CLI auth (API keys, OAuth tokens, settings files) " +
      "on an existing sandbox instance so coding CLIs work out of the box.",
    request: {
      params: z.object({
        id: z.string().openapi({ description: "Sandbox instance ID" }),
      }),
      body: {
        content: {
          "application/json": {
            schema: SetupProvidersBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SetupProvidersResponse,
          },
        },
        description: "Provider auth configured",
      },
      401: { description: "Unauthorized" },
      404: { description: "Instance not found" },
      500: { description: "Failed to set up providers" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { id: instanceId } = c.req.valid("param");
    const body = c.req.valid("json");

    try {
      const convex = getConvex({ accessToken });

      // Verify team access
      const team = await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId: body.teamSlugOrId,
      });

      // Get the instance via provider dispatch
      const morphClient = getMorphClientOrNull();
      const instance = await tryGetInstanceById(
        instanceId,
        morphClient,
        "setup-providers",
      );
      if (!instance) {
        return c.text("Instance not found", 404);
      }

      // Verify sandbox ownership - check activity record first, fall back to instance metadata
      if (isPveLxcInstanceId(instanceId)) {
        const activity = await convex.query(api.sandboxInstances.getActivity, {
          instanceId,
        });
        // Require activity record for PVE instances to prove ownership
        // This prevents users from targeting arbitrary PVE instance IDs
        if (!activity) {
          return c.text("Forbidden: No ownership record for this instance", 403);
        }
        if (activity.teamId && activity.teamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }
      } else {
        // For Morph instances, verify team ownership via metadata
        const metadataTeamId = getInstanceTeamId(instance);
        if (metadataTeamId && metadataTeamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }
      }

      const callbackUrl =
        env.NEXT_PUBLIC_CONVEX_URL || "http://localhost:9779";
      const result = await setupProviderAuth(instance, convex, {
        teamSlugOrId: body.teamSlugOrId,
        taskRunId: body.taskRunId,
        taskRunJwt: body.taskRunJwt,
        callbackUrl,
      });

      return c.json({
        success: true,
        providers: result.providers,
      });
    } catch (error) {
      // Re-throw HTTPException to preserve proper status codes (403, 404, etc.)
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("[setup-providers] Failed:", error);
      return c.text("Failed to set up providers", 500);
    }
  },
);

// Prewarm a Morph sandbox instance for faster task startup.
const PrewarmSandboxBody = z
  .object({
    teamSlugOrId: z.string(),
    repoUrl: z.string().optional(),
    branch: z.string().optional(),
  })
  .openapi("PrewarmSandboxBody");

const PrewarmSandboxResponse = z
  .object({
    id: z.string(),
    alreadyExists: z.boolean(),
  })
  .openapi("PrewarmSandboxResponse");

sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/prewarm",
    tags: ["Sandboxes"],
    summary: "Prewarm a sandbox instance for a repo",
    description:
      "Creates a Morph instance in the background with the repo already cloned. " +
      "Call this when the user starts typing a task description for faster startup.",
    request: {
      body: {
        content: {
          "application/json": {
            schema: PrewarmSandboxBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: PrewarmSandboxResponse,
          },
        },
        description: "Prewarm entry created (provisioning in background)",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to create prewarm entry" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    // Check sandbox provider - prewarming is only supported for Morph
    const providerConfig = getActiveSandboxProvider();
    if (providerConfig.provider !== "morph") {
      // Return a no-op response for non-Morph providers
      // The client will just start a fresh sandbox when needed
      return c.json({ id: "", alreadyExists: true });
    }

    const body = c.req.valid("json");

    try {
      const convex = getConvex({ accessToken });

      const team = await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId: body.teamSlugOrId,
      });

      const snapshotId = DEFAULT_MORPH_SNAPSHOT_ID;
      const result = await convex.mutation(api.warmPool.createPrewarmEntry, {
        teamId: team.uuid,
        userId: user.id,
        snapshotId,
        repoUrl: body.repoUrl,
        branch: body.branch,
      });

      if (result.alreadyExists) {
        return c.json({ id: result.id, alreadyExists: true });
      }

      const githubAccountPromise = user.getConnectedAccount("github");
      const prewarmEntryId = result.id;
      void (async () => {
        try {
          const client = getMorphClient();

          let morphInstance = await client.instances.start({
            snapshotId,
            ttlSeconds: 3600,
            ttlAction: "pause",
            metadata: {
              app: "cmux-warm-pool",
              teamId: team.uuid,
              userId: user.id,
            },
          });

          if (morphInstance.networking.httpServices.length === 0) {
            morphInstance = await client.instances.get({
              instanceId: morphInstance.id,
            });
          }

          const instance = wrapMorphInstance(morphInstance);
          void (async () => {
            await instance.setWakeOn(true, true);
          })();

          const exposed = instance.networking.httpServices;
          const vscodeService = exposed.find((service) => service.port === 39378);
          const workerService = exposed.find((service) => service.port === 39377);
          if (!vscodeService || !workerService) {
            throw new Error(
              `VSCode or worker service not found on instance ${instance.id}`,
            );
          }

          await waitForVSCodeReady(vscodeService.url, { timeoutMs: 30_000 });

          const githubAccount = await githubAccountPromise;
          if (githubAccount) {
            const { accessToken: githubAccessToken } =
              await githubAccount.getAccessToken();
            if (githubAccessToken) {
              await configureGithubAccess(instance, githubAccessToken);
            }
          }

          if (body.repoUrl) {
            const parsedRepo = parseGithubRepoUrl(body.repoUrl);
            if (parsedRepo) {
              await hydrateWorkspace({
                instance,
                repo: {
                  owner: parsedRepo.owner,
                  name: parsedRepo.repo,
                  repoFull: parsedRepo.fullName,
                  cloneUrl: parsedRepo.gitUrl,
                  maskedCloneUrl: parsedRepo.gitUrl,
                  depth: 1,
                  baseBranch: body.branch || "main",
                  newBranch: "",
                },
              });
            }
          }

          await convex.mutation(api.warmPool.markInstanceReady, {
            id: prewarmEntryId,
            instanceId: instance.id,
            vscodeUrl: vscodeService.url,
            workerUrl: workerService.url,
          });
        } catch (error) {
          console.error("[sandboxes.prewarm] Background provisioning failed:", error);
          try {
            await convex.mutation(api.warmPool.markInstanceFailed, {
              id: prewarmEntryId,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
          } catch (markError) {
            console.error(
              "[sandboxes.prewarm] Failed to mark entry as failed:",
              markError,
            );
          }
        }
      })();

      return c.json({ id: result.id, alreadyExists: false });
    } catch (error) {
      console.error("[sandboxes.prewarm] Failed:", error);
      return c.text("Failed to create prewarm entry", 500);
    }
  },
);

const SandboxRefreshGitHubAuthBody = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("SandboxRefreshGitHubAuthBody");

const SandboxRefreshGitHubAuthResponse = z
  .object({
    refreshed: z.literal(true),
  })
  .openapi("SandboxRefreshGitHubAuthResponse");

// Refresh GitHub authentication inside a sandbox (Morph or PVE LXC)
sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/refresh-github-auth",
    tags: ["Sandboxes"],
    summary: "Refresh GitHub authentication inside a sandbox",
    description:
      "Fetches a fresh GitHub token via Stack Auth and re-authenticates the GitHub CLI inside the sandbox.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: SandboxRefreshGitHubAuthBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SandboxRefreshGitHubAuthResponse,
          },
        },
        description: "GitHub authentication refreshed successfully",
      },
      400: { description: "Unsupported sandbox provider" },
      401: { description: "Unauthorized or GitHub not connected" },
      403: { description: "Forbidden - sandbox does not belong to this team" },
      404: { description: "Sandbox not found" },
      409: { description: "Sandbox is paused/stopped and must be resumed first" },
      500: { description: "Failed to refresh GitHub authentication" },
      503: { description: "Sandbox provider not configured" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("json");

    const convex = getConvex({ accessToken });
    const team = await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    const activity = await convex.query(api.sandboxInstances.getActivity, {
      instanceId: id,
    });
    if (!activity) {
      return c.text("Sandbox not found", 404);
    }
    if (activity.teamId && activity.teamId !== team.uuid) {
      return c.text("Forbidden", 403);
    }

    const provider =
      activity.provider ||
      (isPveLxcInstanceId(id)
        ? "pve-lxc"
        : id.startsWith("morphvm_")
          ? "morph"
          : undefined);

    // Try to use GitHub App installation token (same logic as /sandboxes/start)
    // to maintain consistency with initial sandbox setup
    let gitAuthToken: string | undefined;

    // Look up the taskRun to get the repo owner for GitHub App token preference
    const taskRun = await convex.query(api.taskRuns.getByContainerName, {
      teamSlugOrId,
      containerName: id,
    });

    if (taskRun) {
      const task = await convex.query(api.tasks.getById, {
        teamSlugOrId,
        id: taskRun.taskId,
      });
      if (task?.projectFullName) {
        const [owner] = task.projectFullName.split("/");
        try {
          const connections = await convex.query(api.github.listProviderConnections, {
            teamSlugOrId,
          });
          const targetConnection = connections.find(
            (co) =>
              co.isActive && co.accountLogin?.toLowerCase() === owner.toLowerCase()
          );
          if (targetConnection) {
            console.log(
              `[sandboxes.refresh-github-auth] Found GitHub App installation ${targetConnection.installationId} for ${owner}`
            );
            gitAuthToken = await generateGitHubInstallationToken({
              installationId: targetConnection.installationId,
              repositories: [task.projectFullName],
              permissions: {
                contents: "write",
                metadata: "read",
                workflows: "write",
              },
            });
            console.log(
              `[sandboxes.refresh-github-auth] Using GitHub App token for git authentication`
            );
          }
        } catch (error) {
          console.error(
            `[sandboxes.refresh-github-auth] Failed to get GitHub App token, falling back to user OAuth:`,
            error
          );
        }
      }
    }

    // Fall back to personal OAuth token if no GitHub App token
    if (!gitAuthToken) {
      const tokenResult = await getFreshGitHubToken(user);
      if ("error" in tokenResult) {
        return c.text(tokenResult.error, tokenResult.status);
      }
      gitAuthToken = tokenResult.token;
      console.log(
        `[sandboxes.refresh-github-auth] Using personal OAuth token for git authentication`
      );
    }

    try {
      if (provider !== "morph" && provider !== "pve-lxc") {
        return c.text("Unsupported sandbox provider", 400);
      }

      const instance = await getInstanceById(id, getMorphClientOrNull());

      const metadataTeamId = getInstanceTeamId(instance);
      if (metadataTeamId && metadataTeamId !== team.uuid) {
        return c.text("Forbidden", 403);
      }

      // Check instance is active (Morph uses "paused", PVE LXC uses "running" check)
      if (provider === "morph" && instance.status === "paused") {
        return c.text("Instance is paused - resume it first", 409);
      } else if (provider === "pve-lxc" && instance.status !== "running") {
        return c.text("Container is stopped - resume it first", 409);
      }

      await configureGithubAccess(instance, gitAuthToken);

      console.log(
        `[sandboxes.refresh-github-auth] Successfully refreshed GitHub auth for sandbox ${id}`
      );

      return c.json({ refreshed: true });
    } catch (error) {
      console.error(
        `[sandboxes.refresh-github-auth] Failed to refresh GitHub auth for sandbox ${id}:`,
        error
      );
      return c.text("Failed to refresh GitHub authentication", 500);
    }
  }
);

sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/env",
    tags: ["Sandboxes"],
    summary: "Apply environment variables to a running sandbox",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: UpdateSandboxEnvBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: UpdateSandboxEnvResponse,
          },
        },
        description: "Environment variables applied",
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Sandbox not found" },
      500: { description: "Failed to apply environment variables" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { id } = c.req.valid("param");
    const { teamSlugOrId, envVarsContent } = c.req.valid("json");

    try {
      const team = await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId,
      });
      const convex = getConvex({ accessToken });

      // For PVE LXC, verify via activity record (metadata not persisted reliably)
      if (isPveLxcInstanceId(id)) {
        const activity = await convex.query(api.sandboxInstances.getActivity, {
          instanceId: id,
        });
        if (!activity || !activity.teamId) {
          return c.text("Sandbox not found", 404);
        }
        if (activity.teamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }
      }

      // Get instance via provider dispatch (use nullable client for PVE-only deployments)
      const instance = await tryGetInstanceById(id, getMorphClientOrNull(), "sandboxes.env");
      if (!instance) {
        return c.text("Sandbox not found", 404);
      }

      // For Morph instances, verify team ownership via metadata
      if (!isPveLxcInstanceId(id)) {
        const metadataTeamId = getInstanceTeamId(instance);
        if (metadataTeamId && metadataTeamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }
      }

      const encodedEnv = encodeEnvContentForEnvctl(envVarsContent);
      const command = envctlLoadCommand(encodedEnv);
      const execResult = await instance.exec(command);
      if (execResult.exit_code !== 0) {
        console.error(
          `[sandboxes.env] envctl load failed exit=${execResult.exit_code} stderr=${(execResult.stderr || "").slice(0, 200)}`,
        );
        return c.text("Failed to apply environment variables", 500);
      }

      return c.json({ applied: true as const });
    } catch (error) {
      console.error(
        "[sandboxes.env] Failed to apply environment variables",
        error,
      );
      return c.text("Failed to apply environment variables", 500);
    }
  },
);

// Run maintenance and dev scripts in a sandbox
const RunScriptsBody = z
  .object({
    teamSlugOrId: z.string(),
    maintenanceScript: z.string().optional(),
    devScript: z.string().optional(),
  })
  .openapi("RunScriptsBody");

const RunScriptsResponse = z
  .object({
    started: z.literal(true),
  })
  .openapi("RunScriptsResponse");

sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/run-scripts",
    tags: ["Sandboxes"],
    summary: "Run maintenance and dev scripts in a sandbox",
    description:
      "Runs maintenance and/or dev scripts in tmux sessions within the sandbox. " +
      "This ensures scripts run in a managed way that can be properly cleaned up before snapshotting.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: RunScriptsBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: RunScriptsResponse,
          },
        },
        description: "Scripts started successfully",
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden" },
      404: { description: "Sandbox not found" },
      500: { description: "Failed to run scripts" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { id } = c.req.valid("param");
    const { teamSlugOrId, maintenanceScript, devScript } = c.req.valid("json");

    // Need at least one script to run
    if (!maintenanceScript && !devScript) {
      return c.json({ started: true as const });
    }

    try {
      const team = await verifyTeamAccess({
        req: c.req.raw,
        teamSlugOrId,
      });

      // Get instance via provider dispatch (use nullable client for PVE-only deployments)
      const instance = await tryGetInstanceById(id, getMorphClientOrNull(), "sandboxes.run-scripts");
      if (!instance) {
        return c.text("Sandbox not found", 404);
      }

      // For Morph instances, verify team ownership via metadata
      if (!isPveLxcInstanceId(id)) {
        const metadataTeamId = getInstanceTeamId(instance);
        if (metadataTeamId && metadataTeamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }
      }

      // Allocate script identifiers for tracking
      const scriptIdentifiers = allocateScriptIdentifiers();

      // Run scripts in background (don't await)
      (async () => {
        await runMaintenanceAndDevScripts({
          instance,
          maintenanceScript: maintenanceScript || undefined,
          devScript: devScript || undefined,
          identifiers: scriptIdentifiers,
          convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
          isCloudWorkspace: true,
        });
      })().catch((error) => {
        console.error(
          "[sandboxes.run-scripts] Background script execution failed:",
          error,
        );
      });

      return c.json({ started: true as const });
    } catch (error) {
      console.error(
        "[sandboxes.run-scripts] Failed to run scripts",
        error,
      );
      return c.text("Failed to run scripts", 500);
    }
  },
);

// Stop/pause a sandbox
sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/stop",
    tags: ["Sandboxes"],
    summary: "Stop or pause a sandbox instance",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      204: { description: "Sandbox stopped" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
      500: { description: "Failed to stop sandbox" },
    },
  }),
  async (c) => {
    const id = c.req.valid("param").id;
    const token = await getAccessTokenFromRequest(c.req.raw);
    if (!token) return c.text("Unauthorized", 401);

    try {
      // Get instance via provider dispatch and pause it
      // Morph preserves RAM state; PVE LXC pause() stops the container
      const instance = await tryGetInstanceById(
        id,
        getMorphClientOrNull(),
        "sandboxes.stop"
      );
      if (!instance) {
        // Instance doesn't exist - treat as already stopped (idempotent)
        console.warn(`[sandboxes.stop] Instance ${id} already stopped or deleted`);
        return c.body(null, 204);
      }
      await instance.pause();
      if (isPveLxcInstanceId(id)) {
        console.log(`[sandboxes.stop] PVE LXC container ${id} stopped`);
      }
      return c.body(null, 204);
    } catch (error) {
      console.error("Failed to stop sandbox:", error);
      return c.text("Failed to stop sandbox", 500);
    }
  },
);

// Query status of sandbox
sandboxesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/sandboxes/{id}/status",
    tags: ["Sandboxes"],
    summary: "Get sandbox status and URLs",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              running: z.boolean(),
              vscodeUrl: z.string().optional(),
              workerUrl: z.string().optional(),
              provider: z.enum(["morph", "pve-lxc"]).optional(),
            }),
          },
        },
        description: "Sandbox status",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to get status" },
    },
  }),
  async (c) => {
    const id = c.req.valid("param").id;
    const token = await getAccessTokenFromRequest(c.req.raw);
    if (!token) return c.text("Unauthorized", 401);
    try {
      // Get instance via provider dispatch
      const isPveLxc = isPveLxcInstanceId(id);
      const instance = await getInstanceById(id, getMorphClientOrNull());
      const vscodeService = instance.networking.httpServices.find(
        (s) => s.port === 39378,
      );
      // PVE-LXC uses port 39376 for Node.js worker (Go worker uses 39377)
      // Morph uses port 39377 for Node.js worker
      const workerPort = isPveLxc ? 39376 : 39377;
      const workerService = instance.networking.httpServices.find(
        (s) => s.port === workerPort,
      );
      const running = isPveLxc
        ? instance.status === "running" && Boolean(vscodeService)
        : Boolean(vscodeService);
      return c.json({
        running,
        vscodeUrl: vscodeService?.url,
        workerUrl: workerService?.url,
        provider: isPveLxc ? ("pve-lxc" as const) : ("morph" as const),
      });
    } catch (error) {
      console.error("Failed to get sandbox status:", error);
      return c.text("Failed to get status", 500);
    }
  },
);

// Publish devcontainer forwarded ports (read devcontainer.json inside instance, expose, persist to Convex)
sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/publish-devcontainer",
    tags: ["Sandboxes"],
    summary:
      "Expose forwarded ports from devcontainer.json and persist networking info",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              teamSlugOrId: z.string(),
              taskRunId: z.string(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                status: z.enum(["running"]).default("running"),
                port: z.number(),
                url: z.string(),
              }),
            ),
          },
        },
        description: "Exposed ports list",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to publish devcontainer networking" },
    },
  }),
  async (c) => {
    const token = await getAccessTokenFromRequest(c.req.raw);
    if (!token) return c.text("Unauthorized", 401);
    const { id } = c.req.valid("param");
    const { teamSlugOrId, taskRunId } = c.req.valid("json");
    try {
      // Get instance via provider dispatch
      const instance = await getInstanceById(id, getMorphClientOrNull());

      const isPveLxc = isPveLxcInstanceId(id);

      const reservedPorts = RESERVED_CMUX_PORT_SET;

      // Attempt to read devcontainer.json for declared forwarded ports
      const devcontainerJson = await instance.exec(
        "cat /root/workspace/.devcontainer/devcontainer.json",
      );
      const parsed =
        devcontainerJson.exit_code === 0
          ? (JSON.parse(devcontainerJson.stdout || "{}") as {
            forwardPorts?: number[];
          })
          : { forwardPorts: [] as number[] };

      const devcontainerPorts = Array.isArray(parsed.forwardPorts)
        ? (parsed.forwardPorts as number[])
        : [];

      // Get environmentId from the taskRun (PVE-LXC doesn't persist metadata on instances)
      const convex = getConvex({ accessToken: token });
      let environmentPorts: number[] | undefined;

      // First try to get environmentId from the taskRun
      let environmentId: string | undefined;
      try {
        const taskRun = await convex.query(api.taskRuns.get, {
          teamSlugOrId,
          id: taskRunId as unknown as string & { __tableName: "taskRuns" },
        });
        environmentId = taskRun?.environmentId;
      } catch {
        // ignore lookup errors
      }

      // If we have an environmentId, fetch the environment's exposedPorts
      if (environmentId) {
        try {
          const envDoc = await convex.query(api.environments.get, {
            teamSlugOrId,
            id: environmentId as string & {
              __tableName: "environments";
            },
          });
          environmentPorts = envDoc?.exposedPorts ?? undefined;
        } catch {
          // ignore lookup errors; fall back to devcontainer ports
        }
      }

      // Build the set of ports we want to expose and persist
      const allowedPorts = new Set<number>();
      const addAllowed = (p: number) => {
        if (!Number.isFinite(p)) return;
        const pn = Math.floor(p);
        if (pn > 0 && !reservedPorts.has(pn)) allowedPorts.add(pn);
      };

      // Prefer environment.exposedPorts if available; otherwise use devcontainer forwardPorts
      (environmentPorts && environmentPorts.length > 0
        ? environmentPorts
        : devcontainerPorts
      ).forEach(addAllowed);

      const desiredPorts = Array.from(allowedPorts.values()).sort(
        (a, b) => a - b,
      );
      const serviceNameForPort = (port: number) => `port-${port}`;

      let workingInstance = instance;
      const reloadInstance = async () => {
        workingInstance = await getInstanceById(instance.id, getMorphClientOrNull());
      };

      await reloadInstance();

      for (const service of workingInstance.networking.httpServices) {
        if (!service.name.startsWith("port-")) {
          continue;
        }
        if (reservedPorts.has(service.port)) {
          continue;
        }
        if (!allowedPorts.has(service.port)) {
          await workingInstance.hideHttpService(service.name);
        }
      }

      await reloadInstance();

      for (const port of desiredPorts) {
        const serviceName = serviceNameForPort(port);
        const alreadyExposed = workingInstance.networking.httpServices.some(
          (service) => service.name === serviceName,
        );
        if (alreadyExposed) {
          continue;
        }
        try {
          await workingInstance.exposeHttpService(serviceName, port);
        } catch (error) {
          console.error(
            `[sandboxes.publishNetworking] Failed to expose ${serviceName}`,
            error,
          );
        }
      }

      // For Morph, reload to get persisted state from their API
      // For PVE-LXC, skip reload as exposeHttpService only updates in-memory state
      // and reloading would wipe out the services we just added
      if (!isPveLxc) {
        await reloadInstance();
      }

      const networking = workingInstance.networking.httpServices
        .filter((s) => allowedPorts.has(s.port))
        .map((s) => ({ status: "running" as const, port: s.port, url: s.url }));

      // Persist to Convex
      await convex.mutation(api.taskRuns.updateNetworking, {
        teamSlugOrId,
        id: taskRunId as unknown as string & { __tableName: "taskRuns" },
        networking,
      });

      return c.json(networking);
    } catch (error) {
      console.error("Failed to publish devcontainer networking:", error);
      return c.text("Failed to publish devcontainer networking", 500);
    }
  },
);

// SSH connection info response schema
const SandboxSshResponse = z
  .object({
    morphInstanceId: z.string(),
    sshCommand: z.string().describe("Full SSH command to connect to this sandbox"),
    accessToken: z.string().describe("SSH access token for this sandbox"),
    user: z.string(),
    status: z.enum(["running", "paused"]).describe("Current instance status"),
  })
  .openapi("SandboxSshResponse");

// Get SSH connection details for a sandbox
sandboxesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/sandboxes/{id}/ssh",
    tags: ["Sandboxes"],
    summary: "Get SSH connection details for a sandbox",
    description:
      "Returns SSH connection info for a sandbox. Use the returned sshCommand or accessToken to connect.",
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        teamSlugOrId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SandboxSshResponse,
          },
        },
        description: "SSH connection details",
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden - not a team member" },
      404: { description: "Sandbox not found" },
      500: { description: "Failed to get SSH info" },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");

    try {
      const convex = getConvex({ accessToken });

      let morphInstanceId: string | null = null;

      // Check if the id is a Morph instance ID (starts with "morphvm_")
      if (id.startsWith("morphvm_")) {
        // Direct Morph instance ID - verify ownership via instance metadata
        const morphClient = getMorphClient();

        // First try to find in task runs if team is provided
        if (teamSlugOrId) {
          let taskRun = null;
          try {
            taskRun = await convex.query(api.taskRuns.getByContainerName, {
              teamSlugOrId,
              containerName: id,
            });
          } catch (convexError) {
            console.log(
              `[sandboxes.ssh] Convex query failed for ${id}:`,
              convexError,
            );
          }

          if (taskRun) {
            // Found in task runs - verify team access and that it's a Morph instance
            await verifyTeamAccess({
              req: c.req.raw,
              teamSlugOrId,
            });
            if (taskRun.vscode?.provider !== "morph") {
              return c.text("Sandbox type not supported for SSH", 404);
            }
            morphInstanceId = id;
          }
        }

        // If not found via task run, verify ownership via instance metadata
        if (!morphInstanceId) {
          const result = await verifyInstanceOwnership(
            morphClient,
            id,
            user.id,
            async () => {
              const memberships = await convex.query(api.teams.listTeamMemberships, {});
              return memberships.map((m) => ({ teamId: m.team.teamId }));
            }
          );
          if (!result.authorized) {
            return c.text(result.message, result.status);
          }
          morphInstanceId = result.instanceId;
        }
      } else {
        // For task-run IDs, team is required to look up the task run
        if (!teamSlugOrId) {
          return c.text("teamSlugOrId is required for task-run IDs", 400);
        }

        // Verify team access
        const team = await verifyTeamAccess({
          req: c.req.raw,
          teamSlugOrId,
        });
        // Assume it's a task-run ID - look up the sandbox
        let taskRun: Doc<"taskRuns"> | null = null;

        try {
          taskRun = await convex.query(api.taskRuns.get, {
            teamSlugOrId,
            id: id as Id<"taskRuns">,
          });
        } catch {
          // Not a valid task run ID
          return c.text("Invalid sandbox or task-run ID", 404);
        }

        if (!taskRun) {
          return c.text("Task run not found", 404);
        }

        // Verify the task run is in the correct team
        if (taskRun.teamId !== team.uuid) {
          return c.text("Forbidden", 403);
        }

        // Check if this task run has an active Morph sandbox
        if (!taskRun.vscode) {
          return c.text("No sandbox associated with this task run", 404);
        }

        if (taskRun.vscode.provider !== "morph") {
          return c.text("Sandbox type not supported for SSH", 404);
        }

        if (!taskRun.vscode.containerName) {
          return c.text("Sandbox container name not found", 404);
        }

        // Only return SSH info for running/starting sandboxes
        if (
          taskRun.vscode.status !== "running" &&
          taskRun.vscode.status !== "starting"
        ) {
          return c.text("Sandbox is not running", 404);
        }

        morphInstanceId = taskRun.vscode.containerName;
      }

      if (!morphInstanceId) {
        return c.text("Could not resolve sandbox instance", 404);
      }

      // Get SSH access token from Morph API
      const sshKeyResponse = await fetch(
        `https://cloud.morph.so/api/instance/${morphInstanceId}/ssh/key`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.MORPH_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!sshKeyResponse.ok) {
        const errorText = await sshKeyResponse.text();
        console.error(
          `[sandboxes.ssh] Morph API returned ${sshKeyResponse.status}: ${errorText}`
        );
        // Return 404 if the instance doesn't exist in Morph
        if (sshKeyResponse.status === 404 || errorText.includes("not found")) {
          return c.text("Sandbox not found", 404);
        }
        return c.text("Failed to get SSH credentials", 500);
      }

      const sshKeyData = (await sshKeyResponse.json()) as {
        private_key: string;
        public_key: string;
        password: string;
        access_token: string;
      };

      if (!sshKeyData.access_token) {
        console.error("[sandboxes.ssh] Morph API did not return access_token");
        return c.text("Failed to get SSH credentials", 500);
      }

      // Get instance status from Morph
      const morphClient = getMorphClient();
      const instance = await morphClient.instances.get({ instanceId: morphInstanceId });
      const status = instance.status === "paused" ? "paused" : "running";

      const sshCommand = `ssh ${sshKeyData.access_token}@ssh.cloud.morph.so`;
      return c.json({
        morphInstanceId,
        sshCommand,
        accessToken: sshKeyData.access_token,
        user: "root",
        status,
      });
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.text(error.message || "Request failed", error.status);
      }
      console.error("[sandboxes.ssh] Failed to get SSH info:", error);
      return c.text("Failed to get SSH info", 500);
    }
  },
);

// Resume a paused sandbox
const SandboxResumeResponse = z
  .object({
    resumed: z.literal(true),
  })
  .openapi("SandboxResumeResponse");

sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/resume",
    tags: ["Sandboxes"],
    summary: "Resume a paused sandbox",
    description: "Resumes a paused sandbox so it can accept SSH connections.",
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        teamSlugOrId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: SandboxResumeResponse,
          },
        },
        description: "Sandbox resumed successfully",
      },
      401: { description: "Unauthorized" },
      403: { description: "Forbidden - not a team member" },
      404: { description: "Sandbox not found" },
      500: { description: "Failed to resume sandbox" },
    },
  }),
  async (c) => {
    const user = await getUserFromRequest(c.req.raw);
    if (!user) {
      return c.text("Unauthorized", 401);
    }
    const { accessToken } = await user.getAuthJson();
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const { id } = c.req.valid("param");
    const { teamSlugOrId } = c.req.valid("query");

    try {
      const convex = getConvex({ accessToken });

      // Determine provider based on instance ID prefix
      const isPveLxc = isPveLxcInstanceId(id);
      const isMorphVm = id.startsWith("morphvm_");

      if (isPveLxc) {
        // PVE LXC instance - resume directly
        // Note: LXC doesn't support hibernate, so "paused" containers are actually "stopped"
        const pveClient = getPveLxcClient();
        const pveLxcInstance = await pveClient.instances.get({ instanceId: id });

        if (pveLxcInstance.status === "running") {
          // Already running, just return success
          return c.json({ resumed: true });
        }

        await pveLxcInstance.resume();
        console.log(`[sandboxes.resume] PVE LXC container ${id} started`);

        // Record resume activity for PVE LXC instance
        if (teamSlugOrId) {
          try {
            await convex.mutation(api.sandboxInstances.recordResume, {
              instanceId: id,
              teamSlugOrId,
            });
          } catch (recordError) {
            // Don't fail the resume if recording fails
            console.error("[sandboxes.resume] Failed to record PVE LXC resume activity:", recordError);
          }
        }

        return c.json({ resumed: true });
      }

      let morphInstanceId: string | null = null;

      // Check if the id is a direct VM ID
      if (isMorphVm) {
        // Direct Morph instance ID - verify ownership via instance metadata
        const morphClient = getMorphClient();

        // First try to find in task runs if team is provided
        if (teamSlugOrId) {
          let taskRun = null;
          try {
            taskRun = await convex.query(api.taskRuns.getByContainerName, {
              teamSlugOrId,
              containerName: id,
            });
          } catch (convexError) {
            console.log(
              `[sandboxes.resume] Convex query failed for ${id}:`,
              convexError,
            );
          }

          if (taskRun) {
            // Found in task runs - verify team access
            await verifyTeamAccess({
              req: c.req.raw,
              teamSlugOrId,
            });
            morphInstanceId = id;
          }
        }

        // If not found via task run, verify ownership via instance metadata
        if (!morphInstanceId) {
          const result = await verifyInstanceOwnership(
            morphClient,
            id,
            user.id,
            async () => {
              const memberships = await convex.query(api.teams.listTeamMemberships, {});
              return memberships.map((m) => ({ teamId: m.team.teamId }));
            }
          );
          if (!result.authorized) {
            return c.text(result.message, result.status);
          }
          morphInstanceId = result.instanceId;
        }
      } else {
        // Task-run ID - team is required
        if (!teamSlugOrId) {
          return c.text("teamSlugOrId is required for task-run IDs", 400);
        }

        await verifyTeamAccess({
          req: c.req.raw,
          teamSlugOrId,
        });

        const taskRun = await convex.query(api.taskRuns.get, {
          teamSlugOrId,
          id: id as Id<"taskRuns">,
        });

        if (!taskRun || !taskRun.vscode?.containerName) {
          return c.text("Sandbox not found", 404);
        }

        // Handle PVE LXC via task run lookup
        // Note: LXC doesn't support hibernate, so "paused" containers are actually "stopped"
        if (taskRun.vscode.provider === "pve-lxc") {
          const pveClient = getPveLxcClient();
          const pveLxcInstance = await pveClient.instances.get({ instanceId: taskRun.vscode.containerName });

          if (pveLxcInstance.status === "running") {
            return c.json({ resumed: true });
          }

          await pveLxcInstance.resume();
          console.log(`[sandboxes.resume] PVE LXC container ${taskRun.vscode.containerName} started`);

          // Record resume activity for PVE LXC instance
          try {
            await convex.mutation(api.sandboxInstances.recordResume, {
              instanceId: taskRun.vscode.containerName,
              teamSlugOrId,
            });
          } catch (recordError) {
            console.error("[sandboxes.resume] Failed to record PVE LXC resume activity:", recordError);
          }

          return c.json({ resumed: true });
        }

        if (taskRun.vscode.provider !== "morph") {
          return c.text("Sandbox type not supported", 404);
        }

        morphInstanceId = taskRun.vscode.containerName;
      }

      if (!morphInstanceId) {
        return c.text("Could not resolve sandbox instance", 404);
      }

      // Resume the instance using Morph API
      const morphClient = getMorphClient();
      const instance = await morphClient.instances.get({ instanceId: morphInstanceId });

      if (instance.status !== "paused") {
        // Already running, just return success
        return c.json({ resumed: true });
      }

      await instance.resume();

      // Morph preserves RAM state on pause/resume, so all processes (including agent sessions)
      // should resume exactly where they left off. No need to restart services.

      // Record the resume for activity tracking (used by cleanup cron)
      // Get teamSlugOrId from request or fall back to instance metadata
      const instanceMetadata = instance.metadata as Record<string, unknown> | undefined;
      const effectiveTeamSlugOrId = teamSlugOrId ?? (instanceMetadata?.teamId as string | undefined);
      if (effectiveTeamSlugOrId && morphInstanceId) {
        try {
          // Record resume activity for cleanup cron
          await convex.mutation(api.sandboxInstances.recordResume, {
            instanceId: morphInstanceId,
            teamSlugOrId: effectiveTeamSlugOrId,
          });
        } catch (recordError) {
          // Don't fail the resume if recording fails
          console.error("[sandboxes.resume] Failed to record resume activity:", recordError);
        }
      }

      return c.json({ resumed: true });
    } catch (error) {
      if (error instanceof HTTPException) {
        return c.text(error.message || "Request failed", error.status);
      }
      console.error("[sandboxes.resume] Failed to resume sandbox:", error);
      return c.text("Failed to resume sandbox", 500);
    }
  },
);

/**
 * Parse a git remote URL to extract owner/repo format.
 * Supports:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo
 */
function parseGitRemoteUrl(url: string): string | null {
  // HTTPS URL: https://github.com/owner/repo.git or https://github.com/owner/repo
  // Use non-greedy match to support repo names with dots (e.g., next.js)
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH URL: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}

// Discover git repositories inside a sandbox
// This scans the workspace for .git directories and returns their GitHub remote URLs
sandboxesRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/sandboxes/{id}/discover-repos",
    tags: ["Sandboxes"],
    summary: "Discover git repositories in sandbox workspace",
    description: "Scans the sandbox workspace for git repositories and returns their GitHub remote URLs in owner/repo format.",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              workspacePath: z.string().optional().describe("Path to scan for repos (default: /root/workspace)"),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              repos: z.array(z.string()).describe("Array of discovered repos in owner/repo format"),
              paths: z.array(z.object({
                path: z.string(),
                repo: z.string().nullable(),
              })).describe("Detailed info about each discovered .git directory"),
            }),
          },
        },
        description: "Discovered repositories",
      },
      400: { description: "Invalid workspace path" },
      401: { description: "Unauthorized" },
      404: { description: "Sandbox not found" },
      500: { description: "Failed to discover repos" },
    },
  }),
  async (c) => {
    const id = c.req.valid("param").id;
    const body = c.req.valid("json");
    const rawWorkspacePath = body.workspacePath ?? "/root/workspace";

    // Sanitize workspacePath to prevent shell injection
    // Only allow alphanumeric, /, -, _, and . characters (standard path characters)
    if (!/^[a-zA-Z0-9/_.-]+$/.test(rawWorkspacePath)) {
      return c.text("Invalid workspace path: contains disallowed characters", 400);
    }
    const workspacePath = rawWorkspacePath;

    const token = await getAccessTokenFromRequest(c.req.raw);
    if (!token) return c.text("Unauthorized", 401);

    try {
      // Get instance via provider dispatch
      const sandbox = await getInstanceById(id, getMorphClientOrNull());

      // Find all .git directories in the workspace
      const findResult = await sandbox.exec(
        `find "${workspacePath}" -maxdepth 3 -name ".git" -type d 2>/dev/null || true`,
        { timeoutMs: 10_000 }
      );

      const gitDirs = findResult.stdout
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // For each .git directory, get the remote URL
      const pathsWithRepos: Array<{ path: string; repo: string | null }> = [];
      const repos = new Set<string>();

      for (const gitDir of gitDirs) {
        // Get the parent directory (the actual repo directory)
        const repoDir = gitDir.replace(/\/\.git$/, "");

        try {
          const remoteResult = await sandbox.exec(
            `git -C "${repoDir}" remote get-url origin 2>/dev/null || echo ""`,
            { timeoutMs: 5_000 }
          );

          const remoteUrl = remoteResult.stdout.trim();
          const repo = remoteUrl ? parseGitRemoteUrl(remoteUrl) : null;

          pathsWithRepos.push({ path: repoDir, repo });

          if (repo) {
            repos.add(repo);
          }
        } catch {
          // If we can't get remote URL, skip this repo
          pathsWithRepos.push({ path: repoDir, repo: null });
        }
      }

      return c.json({
        repos: Array.from(repos),
        paths: pathsWithRepos,
      });
    } catch (error) {
      // Check if error indicates sandbox not found
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("not found") ||
        errorMessage.includes("does not exist") ||
        errorMessage.includes("404")
      ) {
        return c.text("Sandbox not found", 404);
      }
      console.error("[sandboxes.discover-repos] Failed to discover repos:", error);
      return c.text("Failed to discover repos", 500);
    }
  },
);
