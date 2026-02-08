/**
 * Daytona devbox CLI HTTP API (v3) - Convex httpActions that proxy Daytona sandbox operations.
 *
 * All endpoints require Stack Auth authentication and inject the DAYTONA_API_KEY server-side.
 * Instance data is tracked in daytonaInstances table, with provider info in daytonaInfo.
 *
 * Endpoints are at /api/v3/devbox/...
 */
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";

const DAYTONA_API_BASE_URL = "https://app.daytona.io/api";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

// cmux devbox service ports (match the E2B template ports for CLI parity)
const DEVBOX_WORKER_PORT = 39377;
const DEVBOX_VSCODE_PORT = 39378;
const DEVBOX_VNC_PORT = 39380;

// Security: Validate instance ID format to prevent injection attacks
// IDs should be cmux_ followed by 8+ alphanumeric characters
const INSTANCE_ID_REGEX = /^cmux_[a-zA-Z0-9]{8,}$/;

function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_REGEX.test(id);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProxyBaseDomain(): string {
  // Defaults to production proxy domain.
  return process.env.CMUX_PROXY_DOMAIN ?? "cmux.sh";
}

function getProxyScheme(): "http" | "https" {
  const scheme = (process.env.CMUX_PROXY_SCHEME ?? "https").toLowerCase();
  return scheme === "http" ? "http" : "https";
}

function buildCmuxProxyUrl(port: number, providerSandboxId: string): string {
  const baseDomain = getProxyBaseDomain();
  const scheme = getProxyScheme();
  return `${scheme}://port-${port}-daytona-${providerSandboxId}.${baseDomain}`;
}

const previewCodesApi = internal.daytonaPreviewCodes;

/**
 * Build URL with authentication token from Daytona preview-url response.
 * This is used internally when we need the direct URL with token.
 */
function buildAuthenticatedUrl(previewData: { url: string; token?: string }, suffix?: string): string {
  let url = previewData.url;
  if (suffix) {
    url = url + suffix;
  }
  if (previewData.token) {
    url = url + (url.includes('?') ? '&' : '?') + `token=${previewData.token}`;
  }
  return url;
}

/**
 * Build a secure preview URL that hides the Daytona token.
 * Uses the preview codes table to store the token, and returns a Convex
 * redirect URL that serves the content in an iframe (token never visible in browser URL bar).
 */
async function createSecurePreviewUrl(
  ctx: ActionCtx,
  convexOrigin: string,
  daytonaId: string,
  previewData: { url: string; token?: string },
  port: number,
  userId: string,
  suffix?: string
): Promise<string> {
  let targetUrl = previewData.url;
  if (suffix) {
    targetUrl = targetUrl + suffix;
  }

  if (!previewData.token) {
    return targetUrl;
  }

  // Store URL + token in preview codes table, get back a short code
  const code = await ctx.runMutation(previewCodesApi.getOrCreate, {
    daytonaId,
    targetUrl,
    token: previewData.token,
    port,
    userId,
  });

  // Return a Convex URL that will serve an iframe with the token hidden
  return `${convexOrigin}/api/v3/devbox/preview/${code}`;
}

/**
 * Wrap a command in bash -c for execution via the Daytona toolbox API.
 * The toolbox API does NOT use a shell by default, so shell features like
 * &&, ||, $VAR, pipes, redirects, etc. won't work without this wrapper.
 */
function shellCmd(cmd: string): string {
  // Escape single quotes in the command by replacing ' with '\''
  const escaped = cmd.replace(/'/g, "'\\''");
  return `bash -c '${escaped}'`;
}

/**
 * Ensure the cmux devbox services are running inside a Daytona sandbox.
 *
 * Daytona sandboxes do not run the Dockerfile CMD; they boot with a Daytona init
 * process and sleep. We must start our services explicitly.
 *
 * This function is intentionally idempotent: it starts services only if the
 * expected auth token/health endpoint is not already available.
 */
async function ensureDevboxServicesStarted(
  providerSandboxId: string
): Promise<void> {
  const startCmd =
    "if [ -f /home/user/.worker-auth-token ] && curl -sf --max-time 2 http://localhost:39377/health >/dev/null 2>&1; then echo already_running; else nohup /usr/local/bin/start-services.sh >/tmp/start-services.log 2>&1 </dev/null & echo started; fi";

  try {
    const resp = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(startCmd),
          timeout: 10,
        }),
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[daytona.ensureServices] Daytona API error:", {
        status: resp.status,
        body: body.slice(0, 500),
      });
      return;
    }

    const result = (await resp.json()) as { exitCode?: number; result?: string };
    const output = result.result?.trim() ?? "";
    if (output) {
      console.log(`[daytona.ensureServices] ${providerSandboxId}: ${output}`);
    }
  } catch (error) {
    console.error("[daytona.ensureServices] Error:", error);
  }
}

/**
 * Verify content type is JSON for non-GET requests
 */
function verifyContentType(req: Request): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    req.method !== "GET" &&
    req.method !== "DELETE" &&
    !contentType.toLowerCase().includes("application/json")
  ) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }
  return null;
}

/**
 * Get authenticated user identity from Convex auth.
 */
async function getAuthenticatedUser(
  ctx: ActionCtx
): Promise<{
  identity: { subject: string; name?: string; email?: string } | null;
  error: Response | null;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return {
      identity: null,
      error: jsonResponse({ code: 401, message: "Unauthorized" }, 401),
    };
  }
  return { identity, error: null };
}

/**
 * Get Daytona API key from environment.
 */
function getDaytonaApiKey(): string | null {
  // Access environment variable directly since we can't use the typed env here
  return process.env.DAYTONA_API_KEY ?? null;
}

/**
 * Make an authenticated request to the Daytona API.
 */
async function daytonaFetch(
  path: string,
  options: RequestInit = {},
  orgId?: string,
  timeoutMs = 30_000
): Promise<Response> {
  const apiKey = getDaytonaApiKey();
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY not configured");
  }

  const url = `${DAYTONA_API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (orgId) {
    headers["X-Daytona-Organization-ID"] = orgId;
  }

  // Convex runs in a fetch-based runtime; external requests can hang indefinitely
  // if the upstream never responds. Always apply a hard timeout.
  const controller = options.signal ? null : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    return await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? controller?.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const daytonaApi = api.daytonaInstances;
const daytonaInternalApi = internal.daytonaInstances;

/**
 * Get the provider sandbox ID for a Daytona ID
 */
async function getProviderSandboxId(
  ctx: ActionCtx,
  daytonaId: string
): Promise<string | null> {
  const info = await ctx.runQuery(daytonaInternalApi.getInfo, {
    daytonaId,
  });
  return info?.providerSandboxId ?? null;
}

/**
 * Map Daytona sandbox state to our standard status
 */
type DaytonaInstanceStatus =
  | "running"
  | "paused"
  | "stopped"
  | "archived"
  | "starting"
  | "stopping"
  | "error"
  | "unknown";

function mapDaytonaState(state: string): DaytonaInstanceStatus {
  switch (state.toLowerCase()) {
    case "running":
    case "started":
      return "running";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "archived":
      return "archived";
    case "creating":
    case "starting":
      return "starting";
    case "stopping":
      return "stopping";
    case "error":
    case "failed":
      return "error";
    default:
      return "unknown";
  }
}

// ============================================================================
// POST /api/v3/devbox/instances - Create a new sandbox
// ============================================================================
export const createInstance = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  let body: {
    teamSlugOrId: string;
    name?: string;
    image?: string;
    cpu?: number;
    memory?: number;
    disk?: number;
    gpu?: number;
    gpuModel?: string;
    region?: string;
    labels?: Record<string, string>;
    env?: Record<string, string>;
    snapshot?: string;
    metadata?: Record<string, string>;
    public?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  const apiKey = getDaytonaApiKey();
  if (!apiKey) {
    return jsonResponse(
      { code: 503, message: "Daytona API not configured" },
      503
    );
  }

  try {
    const startTime = Date.now();
    const timings: Record<string, number> = {};

    // Create a new Daytona sandbox
    console.log("[daytona.create] Creating sandbox...");
    const createStart = Date.now();

    const createBody: Record<string, unknown> = {
      public: true, // Always public to avoid Daytona preview warning page
      labels: {
        app: "cmux-devbox",
        userId: identity!.subject,
        ...(body.labels ?? {}),
      },
    };

    // Always set a unique name to avoid Daytona 409 conflicts.
    // Daytona requires unique sandbox names per org.
    const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    createBody.name = body.name ? `${body.name}-${uniqueSuffix}` : `cmux-${uniqueSuffix}`;
    if (body.image) createBody.image = body.image;
    // Use our custom snapshot with all services pre-installed (4 cores, 8GB RAM, 10GB disk)
    // Daytona doesn't allow specifying resources when using a snapshot
    createBody.snapshot = body.snapshot || "cmux-devbox-full";
    if (body.gpu) createBody.gpu = body.gpu;
    if (body.gpuModel) createBody.gpuModel = body.gpuModel;
    if (body.region) createBody.region = body.region;
    if (body.env) createBody.env = body.env;

    const daytonaResponse = await daytonaFetch(
      "/sandbox",
      {
        method: "POST",
        body: JSON.stringify(createBody),
      },
      undefined,
      120_000
    );
    timings.create = Date.now() - createStart;
    console.log(`[daytona.create] Create completed in ${timings.create}ms`);

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.create] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to create sandbox" },
        502
      );
    }

    const daytonaData = (await daytonaResponse.json()) as {
      id: string;
      state: string;
      name?: string;
      cpu?: number;
      memory?: number;
      disk?: number;
      region?: string;
      previewUrl?: string;
    };

    // Helper to clean up orphaned Daytona sandbox on failure
    const cleanupDaytonaSandbox = async (reason: string) => {
      console.warn(
        `[daytona.create] Cleaning up orphaned sandbox ${daytonaData.id}: ${reason}`
      );
      try {
        const deleteResponse = await daytonaFetch(`/sandbox/${daytonaData.id}`, {
          method: "DELETE",
        });
        if (deleteResponse.ok) {
          console.log(
            `[daytona.create] Successfully deleted orphaned sandbox ${daytonaData.id}`
          );
        } else {
          console.error(
            `[daytona.create] Failed to delete orphaned sandbox ${daytonaData.id}: ${deleteResponse.status}`
          );
        }
      } catch (cleanupError) {
        console.error(
          `[daytona.create] Error deleting orphaned sandbox ${daytonaData.id}:`,
          cleanupError
        );
      }
    };

    // Store the instance in Convex with provider mapping
    console.log("[daytona.create] Storing in Convex...");
    const convexStart = Date.now();
    let result: { id: string; isExisting: boolean };
    try {
      result = (await ctx.runMutation(daytonaApi.create, {
        teamSlugOrId: body.teamSlugOrId,
        providerSandboxId: daytonaData.id,
        name: body.name ?? daytonaData.name,
        image: body.image,
        metadata: body.metadata,
        source: "cli",
      })) as { id: string; isExisting: boolean };
    } catch (convexError) {
      // Convex mutation failed (e.g., invalid team) - clean up the Daytona sandbox
      await cleanupDaytonaSandbox(
        `Convex mutation failed: ${convexError instanceof Error ? convexError.message : "unknown error"}`
      );
      throw convexError;
    }
    timings.convexStore = Date.now() - convexStart;
    console.log(`[daytona.create] Convex store completed in ${timings.convexStore}ms`);

    timings.total = Date.now() - startTime;
    console.log(`[daytona.create] TOTAL: ${timings.total}ms | Breakdown:`, timings);

    // Daytona doesn't run the Dockerfile CMD on sandbox boot; start devbox services explicitly.
    await ensureDevboxServicesStarted(daytonaData.id);

    return jsonResponse({
      id: result.id,
      status: mapDaytonaState(daytonaData.state),
      name: daytonaData.name,
      previewUrl: daytonaData.previewUrl,
      workerUrl: buildCmuxProxyUrl(DEVBOX_WORKER_PORT, daytonaData.id),
      vscodeUrl: buildCmuxProxyUrl(DEVBOX_VSCODE_PORT, daytonaData.id),
      vncUrl: buildCmuxProxyUrl(DEVBOX_VNC_PORT, daytonaData.id),
      spec: {
        cpu: daytonaData.cpu,
        memory: daytonaData.memory,
        disk: daytonaData.disk,
        region: daytonaData.region,
      },
    });
  } catch (error) {
    console.error("[daytona.create] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to create sandbox" },
      500
    );
  }
});

// ============================================================================
// GET /api/v3/devbox/instances - List instances
// ============================================================================
export const listInstances = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  try {
    const rawInstances = (await ctx.runQuery(daytonaApi.list, {
      teamSlugOrId,
    })) as Array<{
      daytonaId: string;
      status: string;
      name?: string;
      createdAt: number;
      updatedAt: number;
    }>;

    // Return basic instance info
    const instances = rawInstances.map((inst) => ({
      id: inst.daytonaId,
      status: inst.status,
      name: inst.name,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    }));

    return jsonResponse({ instances });
  } catch (error) {
    console.error("[daytona.list] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to list instances" },
      500
    );
  }
});

// ============================================================================
// GET /api/v3/devbox/instances/{id} - Get instance details
// ============================================================================
async function handleGetInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = (await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    })) as { daytonaId: string; status: string; name?: string } | null;

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse({ id, status: instance.status, name: instance.name });
    }

    const devboxUrls = {
      workerUrl: buildCmuxProxyUrl(DEVBOX_WORKER_PORT, providerSandboxId),
      vscodeUrl: buildCmuxProxyUrl(DEVBOX_VSCODE_PORT, providerSandboxId),
      vncUrl: buildCmuxProxyUrl(DEVBOX_VNC_PORT, providerSandboxId),
    };

    // Get fresh status from Daytona
    const daytonaResponse = await daytonaFetch(`/sandbox/${providerSandboxId}`);

    if (!daytonaResponse.ok) {
      if (daytonaResponse.status === 404) {
        await ctx.runMutation(daytonaApi.updateStatus, {
          teamSlugOrId,
          id,
          status: "stopped",
        });
        return jsonResponse({
          id,
          status: "stopped",
          name: instance.name,
          ...devboxUrls,
        });
      }
      return jsonResponse({ id, status: instance.status, name: instance.name, ...devboxUrls });
    }

    const daytonaData = (await daytonaResponse.json()) as {
      id: string;
      state: string;
      name?: string;
      cpu?: number;
      memory?: number;
      disk?: number;
      region?: string;
      previewUrl?: string;
    };

    const status = mapDaytonaState(daytonaData.state);

    // Update status in Convex if changed
    if (status !== instance.status) {
      await ctx.runMutation(daytonaApi.updateStatus, {
        teamSlugOrId,
        id,
        status,
      });
    }

    return jsonResponse({
      id,
      status,
      name: instance.name ?? daytonaData.name,
      previewUrl: daytonaData.previewUrl,
      ...devboxUrls,
      spec: {
        cpu: daytonaData.cpu,
        memory: daytonaData.memory,
        disk: daytonaData.disk,
        region: daytonaData.region,
      },
    });
  } catch (error) {
    console.error("[daytona.get] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to get instance" }, 500);
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/token - Get cmux devbox auth token
// ============================================================================
async function handleGetAuthToken(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, { teamSlugOrId, id });
    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Make sure services are started (token file is generated by start-services.sh).
    await ensureDevboxServicesStarted(providerSandboxId);

    // Token location matches the cmux-devbox template.
    const tokenRead = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(
            "cat /home/user/.worker-auth-token 2>/dev/null || cat /home/daytona/.worker-auth-token 2>/dev/null || cat $HOME/.worker-auth-token 2>/dev/null || true"
          ),
          timeout: 10,
        }),
      }
    );

    if (!tokenRead.ok) {
      const errorText = await tokenRead.text();
      console.error("[daytona.token] Daytona API error:", {
        status: tokenRead.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to get auth token" },
        502
      );
    }

    const result = (await tokenRead.json()) as {
      result?: string;
      exitCode?: number;
    };
    const token = result.result?.trim() ?? "";
    if (!token) {
      return jsonResponse(
        { code: 503, message: "Auth token not ready yet" },
        503
      );
    }

    await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });

    return jsonResponse({ token });
  } catch (error) {
    console.error("[daytona.token] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get auth token" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/exec - Execute command
// ============================================================================
async function handleExecCommand(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  command: string,
  timeout?: number
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Execute command via Daytona toolbox API (wrap in shell for &&, pipes, etc.)
    const daytonaResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(command),
          timeout: timeout ?? 60,
        }),
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.exec] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to execute command" },
        502
      );
    }

    const result = (await daytonaResponse.json()) as {
      exitCode: number;
      result: string;
    };

    // Record access
    await ctx.runMutation(daytonaApi.recordAccess, {
      teamSlugOrId,
      id,
    });

    // Map Daytona response format to our expected format
    return jsonResponse({
      stdout: result.result ?? "",
      stderr: "",
      exitCode: result.exitCode ?? 0,
    });
  } catch (error) {
    console.error("[daytona.exec] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to execute command" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/start - Start (resume) instance
// ============================================================================
async function handleStartInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Start via Daytona API
    const daytonaResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/start`,
      {
        method: "POST",
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.start] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to start sandbox" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(daytonaApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "running",
    });

    return jsonResponse({ started: true });
  } catch (error) {
    console.error("[daytona.start] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to start sandbox" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/stop - Stop instance
// ============================================================================
async function handleStopInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Stop via Daytona API
    const daytonaResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/stop`,
      {
        method: "POST",
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      const msg = errorText.toLowerCase();
      // Idempotency: stopping an already stopped sandbox returns 400 in Daytona.
      // Treat this as success so `cmux stop` is reliable.
      const alreadyStopped =
        daytonaResponse.status === 400 && msg.includes("not started");
      const notFound = daytonaResponse.status === 404;
      if (alreadyStopped || notFound) {
        // Continue as if the stop succeeded.
      } else {
      console.error("[daytona.stop] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to stop sandbox" },
        502
      );
      }
    }

    // Update status in Convex
    await ctx.runMutation(daytonaApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "stopped",
    });

    return jsonResponse({ stopped: true });
  } catch (error) {
    console.error("[daytona.stop] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to stop sandbox" }, 500);
  }
}

// ============================================================================
// DELETE /api/v3/devbox/instances/{id} - Delete instance
// ============================================================================
async function handleDeleteInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (providerSandboxId) {
      // Daytona can return errors like "Sandbox state change in progress" right
      // after a stop request. Retry briefly so `cmux stop && cmux delete` is reliable.
      const maxAttempts = 12;
      let deleted = false;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const daytonaResponse = await daytonaFetch(
          `/sandbox/${providerSandboxId}`,
          {
            method: "DELETE",
          }
        );

        if (daytonaResponse.ok || daytonaResponse.status === 404) {
          deleted = true;
          break;
        }

        const errorText = await daytonaResponse.text();
        const msg = errorText.toLowerCase();
        const retryable =
          daytonaResponse.status === 400 &&
          msg.includes("state change in progress");

        if (retryable && attempt < maxAttempts-1) {
          const delayMs = Math.min(1000 * (attempt + 1), 5000);
          console.warn(
            "[daytona.delete] Delete retryable error, retrying...",
            {
              attempt: attempt + 1,
              maxAttempts,
              delayMs,
              status: daytonaResponse.status,
              body: errorText.slice(0, 200),
            }
          );
          await sleep(delayMs);
          continue;
        }

        console.error("[daytona.delete] Daytona API error:", {
          status: daytonaResponse.status,
          body: errorText.slice(0, 500),
        });
        return jsonResponse({ code: 502, message: "Failed to delete sandbox" }, 502);
      }

      if (!deleted) {
        return jsonResponse(
          { code: 502, message: "Failed to delete sandbox" },
          502
        );
      }
    }

    // Remove from Convex
    await ctx.runMutation(daytonaApi.remove, {
      teamSlugOrId,
      id,
    });

    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error("[daytona.delete] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to delete sandbox" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/archive - Archive instance
// ============================================================================
async function handleArchiveInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Archive via Daytona API
    const daytonaResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/archive`,
      {
        method: "POST",
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.archive] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to archive sandbox" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(daytonaApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "archived",
    });

    return jsonResponse({ archived: true });
  } catch (error) {
    console.error("[daytona.archive] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to archive sandbox" },
      500
    );
  }
}

// ============================================================================
// GET /api/v3/devbox/instances/{id}/ssh - Get terminal access info
// Since Daytona doesn't have native SSH, we use ttyd for WebSocket-based terminal
// ============================================================================
async function handleGetInstanceSsh(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Get the preview URL for the terminal port (7681 is ttyd default)
    const TERMINAL_PORT = 7681;
    const previewResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/ports/${TERMINAL_PORT}/preview-url`
    );

    if (!previewResponse.ok) {
      // Terminal daemon might not be running yet
      return jsonResponse(
        {
          code: 503,
          message:
            "Terminal not available. Start it with: cmux-daytona exec <id> 'ttyd -W bash &'",
          hint: "Install ttyd first if needed: apt-get update && apt-get install -y ttyd",
        },
        503
      );
    }

    const previewData = (await previewResponse.json()) as { url: string; token?: string };

    // Record access
    await ctx.runMutation(daytonaApi.recordAccess, {
      teamSlugOrId,
      id,
    });

    return jsonResponse({
      id,
      type: "websocket-terminal",
      terminalUrl: buildAuthenticatedUrl(previewData),
      port: TERMINAL_PORT,
      message: "Open the terminal URL in your browser for interactive access",
    });
  } catch (error) {
    console.error("[daytona.ssh] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get terminal access" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/autostop - Set autostop interval
// ============================================================================
async function handleSetAutostop(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  minutes: number
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    // Set autostop via Daytona API
    const daytonaResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/autostop/${minutes}`,
      {
        method: "POST",
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.autostop] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to set autostop" },
        502
      );
    }

    return jsonResponse({ updated: true, minutes });
  } catch (error) {
    console.error("[daytona.autostop] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to set autostop" }, 500);
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/terminal - Start terminal daemon (ttyd)
// ============================================================================
async function handleStartTerminal(
  ctx: ActionCtx,
  convexOrigin: string,
  id: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const TERMINAL_PORT = 7681;

    // Check if ttyd is already running by testing the port
    const checkResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${TERMINAL_PORT}/`),
          timeout: 10,
        }),
      }
    );

    let ttydRunning = false;
    if (checkResponse.ok) {
      const checkResult = (await checkResponse.json()) as { result: string };
      ttydRunning = checkResult.result?.trim() === "200";
    }

    if (ttydRunning) {
      // ttyd is already running, just get the URL
      const previewResponse = await daytonaFetch(
        `/sandbox/${providerSandboxId}/ports/${TERMINAL_PORT}/preview-url`
      );
      if (previewResponse.ok) {
        const previewData = (await previewResponse.json()) as { url: string; token?: string };
        await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
        const secureUrl = await createSecurePreviewUrl(
          ctx,
          convexOrigin,
          id,
          previewData,
          TERMINAL_PORT,
          userId
        );
        return jsonResponse({
          id,
          status: "already_running",
          terminalUrl: secureUrl,
          port: TERMINAL_PORT,
        });
      }
    }

    // Download and install ttyd, then start it
    console.log("[daytona.terminal] Downloading and installing ttyd...");
    const ttydInstallResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("curl -sL https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /tmp/ttyd && chmod +x /tmp/ttyd"),
          timeout: 60,
        }),
      }
    );

    if (!ttydInstallResponse.ok) {
      console.error("[daytona.terminal] Failed to download ttyd");
      return jsonResponse(
        { code: 502, message: "Failed to download terminal daemon" },
        502
      );
    }

    // Start ttyd in background
    console.log("[daytona.terminal] Starting ttyd daemon...");
    await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`nohup /tmp/ttyd -W -p ${TERMINAL_PORT} /bin/bash > /tmp/ttyd.log 2>&1 &`),
          timeout: 5,
        }),
      }
    );

    // Wait for ttyd to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const verifyResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${TERMINAL_PORT}/`),
          timeout: 10,
        }),
      }
    );

    if (verifyResponse.ok) {
      const verifyResult = (await verifyResponse.json()) as { result: string };
      if (verifyResult.result?.trim() === "200") {
        const previewResponse = await daytonaFetch(
          `/sandbox/${providerSandboxId}/ports/${TERMINAL_PORT}/preview-url`
        );
        if (previewResponse.ok) {
          const previewData = (await previewResponse.json()) as { url: string; token?: string };
          await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
          const secureUrl = await createSecurePreviewUrl(
            ctx,
            convexOrigin,
            id,
            previewData,
            TERMINAL_PORT,
            userId
          );
          return jsonResponse({
            id,
            status: "started",
            terminalUrl: secureUrl,
            port: TERMINAL_PORT,
            message: "Terminal daemon started. Open the URL in your browser.",
          });
        }
      }
    }

    return jsonResponse(
      {
        code: 500,
        message: "Terminal daemon failed to start. Try manually: curl -sL https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 -o /tmp/ttyd && chmod +x /tmp/ttyd && /tmp/ttyd -W -p 7681 /bin/bash &",
      },
      500
    );
  } catch (error) {
    console.error("[daytona.terminal] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to start terminal" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/code - Start VS Code server (OpenVSCode)
// ============================================================================
async function handleStartCode(
  ctx: ActionCtx,
  convexOrigin: string,
  id: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const CODE_PORT = 8000;

    // Check if code-server is already running
    const checkResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${CODE_PORT}/`),
          timeout: 10,
        }),
      }
    );

    let codeRunning = false;
    if (checkResponse.ok) {
      const checkResult = (await checkResponse.json()) as { result: string };
      codeRunning = checkResult.result?.trim() === "200";
    }

    if (codeRunning) {
      const previewResponse = await daytonaFetch(
        `/sandbox/${providerSandboxId}/ports/${CODE_PORT}/preview-url`
      );
      if (previewResponse.ok) {
        const previewData = (await previewResponse.json()) as { url: string; token?: string };
        await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
        const secureUrl = await createSecurePreviewUrl(
          ctx,
          convexOrigin,
          id,
          previewData,
          CODE_PORT,
          userId
        );
        return jsonResponse({
          id,
          status: "already_running",
          codeUrl: secureUrl,
          port: CODE_PORT,
        });
      }
    }

    // Download and install cmux-code (our VSCode fork with OpenVSIX marketplace)
    console.log("[daytona.code] Installing cmux-code...");

    // Detect home directory inside sandbox (needs shell for $HOME expansion)
    const homeResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({ command: shellCmd("echo $HOME"), timeout: 5 }),
      }
    );
    let homeDir = "/home/daytona"; // fallback for Daytona sandboxes
    if (homeResponse.ok) {
      const homeResult = (await homeResponse.json()) as { result: string; exitCode: number };
      const h = homeResult.result?.trim();
      if (h && h.startsWith("/")) homeDir = h;
    }
    console.log(`[daytona.code] Home directory: ${homeDir}`);

    const installDir = `${homeDir}/.cmux-code`;

    // Check if cmux-code is already installed (needs shell for && and test)
    const checkInstallResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`test -x ${installDir}/bin/code-server-oss && echo installed`),
          timeout: 5,
        }),
      }
    );
    let alreadyInstalled = false;
    if (checkInstallResponse.ok) {
      const checkResult = (await checkInstallResponse.json()) as { result: string; exitCode: number };
      alreadyInstalled = checkResult.result?.trim() === "installed";
    }

    if (!alreadyInstalled) {
      // Fetch latest version from GitHub API directly (server-side, no jq needed)
      let cmuxCodeVersion = "0.9.0"; // fallback
      try {
        const releaseApiResponse = await fetch(
          "https://api.github.com/repos/manaflow-ai/vscode-1/releases/latest",
          { headers: { Accept: "application/json", "User-Agent": "cmux-convex" } }
        );
        if (releaseApiResponse.ok) {
          const releaseData = (await releaseApiResponse.json()) as { tag_name?: string };
          if (releaseData.tag_name) {
            cmuxCodeVersion = releaseData.tag_name.replace(/^v/, "");
          }
        }
      } catch (e) {
        console.warn("[daytona.code] Failed to fetch latest version, using fallback:", e);
      }
      console.log(`[daytona.code] Using cmux-code v${cmuxCodeVersion}`);

      // Detect arch (single command, no shell features needed)
      const archResponse = await daytonaFetch(
        `/toolbox/${providerSandboxId}/toolbox/process/execute`,
        {
          method: "POST",
          body: JSON.stringify({ command: "uname -m", timeout: 5 }),
        }
      );
      let arch = "x64";
      if (archResponse.ok) {
        const archResult = (await archResponse.json()) as { result: string };
        if (archResult.result?.trim() === "aarch64") arch = "arm64";
      }

      const downloadUrl = `https://github.com/manaflow-ai/vscode-1/releases/download/v${cmuxCodeVersion}/vscode-server-linux-${arch}-web.tar.gz`;
      console.log(`[daytona.code] Download URL: ${downloadUrl}`);

      // Download and install (needs shell for && chaining)
      const installCmd = `curl -fSL --retry 3 --max-time 300 -o /tmp/cmux-code.tar.gz ${downloadUrl} && mkdir -p ${installDir} && tar xf /tmp/cmux-code.tar.gz -C ${installDir}/ --strip-components=1 && rm -f /tmp/cmux-code.tar.gz`;

      const downloadResponse = await daytonaFetch(
        `/toolbox/${providerSandboxId}/toolbox/process/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            command: shellCmd(installCmd),
            timeout: 300,
          }),
        }
      );

      if (!downloadResponse.ok) {
        const errorText = await downloadResponse.text();
        console.error("[daytona.code] Failed to install cmux-code, API error:", errorText.slice(0, 500));
        return jsonResponse(
          { code: 502, message: "Failed to install cmux-code" },
          502
        );
      }

      const downloadResult = (await downloadResponse.json()) as { result: string; exitCode: number };
      console.log(`[daytona.code] Install result: exitCode=${downloadResult.exitCode}, output=${downloadResult.result?.slice(0, 200)}`);

      if (downloadResult.exitCode !== 0) {
        console.error("[daytona.code] Install command failed:", downloadResult.result);
        return jsonResponse(
          { code: 500, message: `Failed to install cmux-code: ${downloadResult.result?.slice(0, 200)}` },
          500
        );
      }
    } else {
      console.log("[daytona.code] cmux-code already installed, skipping download");
    }

    // Ensure workspace directory exists
    await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`mkdir -p ${homeDir}/workspace`),
          timeout: 5,
        }),
      }
    );

    // Start cmux-code in background (needs shell for nohup, redirection, &)
    console.log("[daytona.code] Starting cmux-code...");
    const startCmd = `nohup ${installDir}/bin/code-server-oss --host 0.0.0.0 --port ${CODE_PORT} --without-connection-token --disable-workspace-trust --disable-telemetry --telemetry-level off ${homeDir}/workspace > /tmp/cmux-code.log 2>&1 &`;
    await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(startCmd),
          timeout: 10,
        }),
      }
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Verify server is running (needs shell for curl format string)
    const verifyResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${CODE_PORT}/`),
          timeout: 10,
        }),
      }
    );

    if (verifyResponse.ok) {
      const verifyResult = (await verifyResponse.json()) as { result: string };
      if (verifyResult.result?.trim() === "200") {
        const previewResponse = await daytonaFetch(
          `/sandbox/${providerSandboxId}/ports/${CODE_PORT}/preview-url`
        );
        if (previewResponse.ok) {
          const previewData = (await previewResponse.json()) as { url: string; token?: string };
          await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
          const secureUrl = await createSecurePreviewUrl(
            ctx,
            convexOrigin,
            id,
            previewData,
            CODE_PORT,
            userId
          );
          return jsonResponse({
            id,
            status: "started",
            codeUrl: secureUrl,
            port: CODE_PORT,
            message: "VS Code server started. Open the URL in your browser.",
          });
        }
      }
    }

    return jsonResponse(
      {
        code: 500,
        message: "VS Code server failed to start. It may still be initializing - try again in a few seconds.",
      },
      500
    );
  } catch (error) {
    console.error("[daytona.code] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to start VS Code server" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/vnc - Start VNC desktop (noVNC + Xvfb)
// ============================================================================
async function handleStartVnc(
  ctx: ActionCtx,
  convexOrigin: string,
  id: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const VNC_PORT = 6080;

    // Check if noVNC is already running
    const checkResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${VNC_PORT}/`),
          timeout: 10,
        }),
      }
    );

    let vncRunning = false;
    if (checkResponse.ok) {
      const checkResult = (await checkResponse.json()) as { result: string };
      vncRunning = checkResult.result?.trim() === "200";
    }

    if (vncRunning) {
      const previewResponse = await daytonaFetch(
        `/sandbox/${providerSandboxId}/ports/${VNC_PORT}/preview-url`
      );
      if (previewResponse.ok) {
        const previewData = (await previewResponse.json()) as { url: string; token?: string };
        await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
        const secureUrl = await createSecurePreviewUrl(
          ctx,
          convexOrigin,
          id,
          previewData,
          VNC_PORT,
          userId,
          "/vnc.html?autoconnect=true"
        );
        return jsonResponse({
          id,
          status: "already_running",
          vncUrl: secureUrl,
          port: VNC_PORT,
        });
      }
    }

    // Check if VNC deps are already installed (pre-installed in snapshot)
    const depsCheckResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("which vncserver && which websockify && which xfwm4 && which google-chrome-stable && echo preinstalled"),
          timeout: 5,
        }),
      }
    );
    let depsPreinstalled = false;
    if (depsCheckResponse.ok) {
      const depsResult = (await depsCheckResponse.json()) as { result: string };
      depsPreinstalled = depsResult.result?.includes("preinstalled") ?? false;
    }

    if (depsPreinstalled) {
      console.log("[daytona.vnc] All deps pre-installed in snapshot, skipping install");
    } else {
      // Install dependencies (not pre-installed)
      console.log("[daytona.vnc] Installing TigerVNC + dependencies...");

      // Step 1a: Install base packages (websockify, noVNC, window manager)
      const baseInstallResponse = await daytonaFetch(
        `/toolbox/${providerSandboxId}/toolbox/process/execute`,
        {
          method: "POST",
          body: JSON.stringify({
            command: shellCmd("sudo apt-get update --allow-insecure-repositories -o Acquire::AllowInsecureRepositories=true 2>/dev/null; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-unauthenticated xfwm4 novnc websockify xterm wget dbus-x11"),
            timeout: 180,
          }),
        }
      );

      if (!baseInstallResponse.ok) {
        console.error("[daytona.vnc] Failed to install base VNC dependencies");
        return jsonResponse(
          { code: 502, message: "Failed to install VNC dependencies" },
          502
        );
      }
      const baseResult = (await baseInstallResponse.json()) as { result: string; exitCode: number };
      console.log(`[daytona.vnc] Base deps install: exitCode=${baseResult.exitCode}`);
    }

    if (!depsPreinstalled) {
    // Step 1b: Install TigerVNC separately (avoids bulk install failures)
    const tigerInstallResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("sudo DEBIAN_FRONTEND=noninteractive apt-get install -y tigervnc-standalone-server tigervnc-common"),
          timeout: 120,
        }),
      }
    );

    if (!tigerInstallResponse.ok) {
      console.error("[daytona.vnc] Failed to install TigerVNC");
      return jsonResponse(
        { code: 502, message: "Failed to install TigerVNC" },
        502
      );
    }
    const tigerResult = (await tigerInstallResponse.json()) as { result: string; exitCode: number };
    console.log(`[daytona.vnc] TigerVNC install: exitCode=${tigerResult.exitCode}`);

    // Step 2: Install Google Chrome
    console.log("[daytona.vnc] Installing Chrome...");
    const chromeInstallResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb && (sudo dpkg -i /tmp/chrome.deb || sudo apt-get install -f -y) && rm -f /tmp/chrome.deb"),
          timeout: 120,
        }),
      }
    );

    if (chromeInstallResponse.ok) {
      const chromeResult = (await chromeInstallResponse.json()) as { result: string; exitCode: number };
      console.log(`[daytona.vnc] Chrome install: exitCode=${chromeResult.exitCode}`);
    } else {
      console.warn("[daytona.vnc] Chrome install API call failed, continuing without Chrome");
    }

    } // end if (!depsPreinstalled)

    // Step 3: Set up TigerVNC config and xstartup (launches xfwm4 + Chrome)
    // IMPORTANT: xstartup must NOT exit quickly (< 3 seconds) or TigerVNC kills the X server.
    // We use "exec xfwm4" as the last command to keep the script alive.
    const xstartup = [
      "#!/bin/bash",
      "unset SESSION_MANAGER",
      "unset DBUS_SESSION_BUS_ADDRESS",
      "export DISPLAY=:1",
      "# Start dbus for Chrome",
      "sudo mkdir -p /run/dbus && sudo dbus-daemon --system --fork 2>/dev/null || true",
      "# Start Chrome in background before window manager",
      "if command -v google-chrome-stable >/dev/null 2>&1; then",
      "  google-chrome-stable --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-setuid-sandbox --remote-debugging-port=9222 --start-maximized &",
      "fi",
      "sleep 1",
      "# exec replaces shell with xfwm4 - keeps session alive for TigerVNC",
      "exec xfwm4",
    ].join("\n");
    const xstartupBase64 = btoa(xstartup);

    // TigerVNC 1.15+ uses ~/.config/tigervnc for config; remove legacy ~/.vnc to avoid migration errors
    await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`rm -rf $HOME/.vnc && mkdir -p $HOME/.config/tigervnc && echo ${xstartupBase64} | base64 -d > $HOME/.config/tigervnc/xstartup && chmod +x $HOME/.config/tigervnc/xstartup`),
          timeout: 10,
        }),
      }
    );

    // Step 4: Start TigerVNC on display :1 (port 5901) + noVNC proxy on port 6080
    const vncStartScript = [
      "#!/bin/bash",
      "vncserver :1 -geometry 1920x1080 -depth 24 -SecurityTypes None 2>/dev/null",
      "sleep 2",
      "websockify --web=/usr/share/novnc 6080 localhost:5901 &",
      "exit 0",
    ].join("\n");
    const vncStartBase64 = btoa(vncStartScript);

    console.log("[daytona.vnc] Starting TigerVNC + noVNC...");
    await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`echo ${vncStartBase64} | base64 -d > /tmp/start-vnc.sh && chmod +x /tmp/start-vnc.sh && bash /tmp/start-vnc.sh`),
          timeout: 15,
        }),
      }
    );

    // Wait for VNC + noVNC to start
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const verifyResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`curl -s -o /dev/null -w "%{http_code}" http://localhost:${VNC_PORT}/`),
          timeout: 10,
        }),
      }
    );

    if (verifyResponse.ok) {
      const verifyResult = (await verifyResponse.json()) as { result: string };
      if (verifyResult.result?.trim() === "200") {
        const previewResponse = await daytonaFetch(
          `/sandbox/${providerSandboxId}/ports/${VNC_PORT}/preview-url`
        );
        if (previewResponse.ok) {
          const previewData = (await previewResponse.json()) as { url: string; token?: string };
          await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
          const secureUrl = await createSecurePreviewUrl(
            ctx,
            convexOrigin,
            id,
            previewData,
            VNC_PORT,
            userId,
            "/vnc.html?autoconnect=true"
          );
          return jsonResponse({
            id,
            status: "started",
            vncUrl: secureUrl,
            port: VNC_PORT,
            message: "VNC desktop started. Open the URL in your browser.",
          });
        }
      }
    }

    return jsonResponse(
      {
        code: 500,
        message: "VNC desktop failed to start. It may still be initializing - try again in a few seconds.",
      },
      500
    );
  } catch (error) {
    console.error("[daytona.vnc] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to start VNC desktop" },
      500
    );
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/ssh-setup - Setup SSH + WebSocket bridge for rsync
// ============================================================================
async function handleSetupSsh(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, { teamSlugOrId, id });
    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    const SSH_PORT = 10000;
    const WS_BRIDGE_PORT = 10001;

    // Check if SSH bridge is already running
    const checkResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(`ss -tlnp 2>/dev/null | grep -q :${WS_BRIDGE_PORT} && cat ~/.ssh/cmux_key 2>/dev/null && echo "===RUNNING==="`),
          timeout: 5,
        }),
      }
    );

    if (checkResponse.ok) {
      const result = (await checkResponse.json()) as { result: string };
      if (result.result?.includes("===RUNNING===")) {
        const key = result.result.split("===RUNNING===")[0].trim();
        const previewResponse = await daytonaFetch(
          `/sandbox/${providerSandboxId}/ports/${WS_BRIDGE_PORT}/preview-url`
        );
        if (previewResponse.ok && key) {
          const previewData = (await previewResponse.json()) as { url: string; token?: string };
          await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });
          return jsonResponse({
            wsUrl: buildAuthenticatedUrl(previewData),
            sshKey: key,
            sshUser: "daytona",
          });
        }
      }
    }

    // Install openssh-server and websockify if needed
    console.log("[daytona.ssh-setup] Installing SSH + websockify...");
    const installResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("(which sshd && which websockify) || (sudo apt-get update --allow-insecure-repositories -o Acquire::AllowInsecureRepositories=true 2>/dev/null; sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-unauthenticated openssh-server python3-websockify)"),
          timeout: 120,
        }),
      }
    );

    if (!installResponse.ok) {
      return jsonResponse({ code: 502, message: "Failed to install SSH" }, 502);
    }
    const installResult = (await installResponse.json()) as { result: string; exitCode: number };
    console.log(`[daytona.ssh-setup] Install: exitCode=${installResult.exitCode}`);

    // Setup SSH: generate keys, configure, start sshd + websockify bridge
    console.log("[daytona.ssh-setup] Configuring SSH and starting bridge...");
    const setupCmd = [
      "sudo ssh-keygen -A 2>/dev/null",
      "mkdir -p ~/.ssh",
      "rm -f ~/.ssh/cmux_key ~/.ssh/cmux_key.pub",
      `ssh-keygen -t ed25519 -f ~/.ssh/cmux_key -N "" -q`,
      "cat ~/.ssh/cmux_key.pub >> ~/.ssh/authorized_keys",
      "chmod 700 ~/.ssh",
      "chmod 600 ~/.ssh/authorized_keys",
      "sudo mkdir -p /run/sshd",
      // Subshell so || true only catches sshd failure, not the whole chain
      `(sudo /usr/sbin/sshd -p ${SSH_PORT} -o PubkeyAuthentication=yes -o PasswordAuthentication=no 2>/dev/null || true)`,
      // Subshell so & doesn't terminate the && chain (& && is a bash syntax error)
      `(nohup websockify ${WS_BRIDGE_PORT} localhost:${SSH_PORT} > /tmp/ws-ssh-bridge.log 2>&1 &)`,
      "sleep 1",
    ].join(" && ");

    const setupResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd(setupCmd),
          timeout: 30,
        }),
      }
    );

    if (!setupResponse.ok) {
      return jsonResponse({ code: 502, message: "Failed to setup SSH" }, 502);
    }
    const setupResult = (await setupResponse.json()) as { result: string; exitCode?: number };
    const setupExitCode = setupResult.exitCode ?? 0;
    if (setupExitCode !== 0) {
      console.error("[daytona.ssh-setup] Setup failed (exit code", setupExitCode, "):", setupResult.result);
      return jsonResponse({ code: 500, message: "SSH setup failed" }, 500);
    }

    // Read private key
    const keyResponse = await daytonaFetch(
      `/toolbox/${providerSandboxId}/toolbox/process/execute`,
      {
        method: "POST",
        body: JSON.stringify({
          command: shellCmd("cat ~/.ssh/cmux_key"),
          timeout: 5,
        }),
      }
    );

    let privateKey = "";
    if (keyResponse.ok) {
      const keyResult = (await keyResponse.json()) as { result: string };
      privateKey = keyResult.result?.trim() ?? "";
    }

    if (!privateKey) {
      return jsonResponse({ code: 500, message: "Failed to get SSH key" }, 500);
    }

    // Get preview URL for WebSocket bridge port
    const previewResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/ports/${WS_BRIDGE_PORT}/preview-url`
    );

    if (!previewResponse.ok) {
      return jsonResponse({ code: 502, message: "Failed to get SSH bridge URL" }, 502);
    }

    const previewData = (await previewResponse.json()) as { url: string; token?: string };
    await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });

    console.log("[daytona.ssh-setup] SSH bridge ready");
    return jsonResponse({
      wsUrl: buildAuthenticatedUrl(previewData),
      sshKey: privateKey,
      sshUser: "daytona",
    });
  } catch (error) {
    console.error("[daytona.ssh-setup] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to setup SSH" }, 500);
  }
}

// ============================================================================
// POST /api/v3/devbox/instances/{id}/resize - Resize instance
// ============================================================================
async function handleResizeInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  cpu?: number,
  memory?: number,
  disk?: number
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const resizeBody: Record<string, number> = {};
    if (cpu !== undefined) resizeBody.cpu = cpu;
    if (memory !== undefined) resizeBody.memory = memory;
    if (disk !== undefined) resizeBody.disk = disk;

    // Resize via Daytona API
    const daytonaResponse = await daytonaFetch(
      `/sandbox/${providerSandboxId}/resize`,
      {
        method: "POST",
        body: JSON.stringify(resizeBody),
      }
    );

    if (!daytonaResponse.ok) {
      const errorText = await daytonaResponse.text();
      console.error("[daytona.resize] Daytona API error:", {
        status: daytonaResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to resize sandbox" },
        502
      );
    }

    const result = await daytonaResponse.json();
    return jsonResponse(result);
  } catch (error) {
    console.error("[daytona.resize] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to resize sandbox" }, 500);
  }
}

// ============================================================================
// GET /api/v3/devbox/instances/{id}/preview - Get preview URL for a port
// ============================================================================
async function handleGetPreviewUrl(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  port: number
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(daytonaApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerSandboxId = await getProviderSandboxId(ctx, id);
    if (!providerSandboxId) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    await ctx.runMutation(daytonaApi.recordAccess, { teamSlugOrId, id });

    // Return cmux proxy URL (global-proxy adds required Daytona headers).
    // This avoids Daytona's preview warning interstitial and keeps Daytona tokens out of user-facing URLs.
    return jsonResponse({ url: buildCmuxProxyUrl(port, providerSandboxId) });
  } catch (error) {
    console.error("[daytona.preview] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get preview URL" },
      500
    );
  }
}

// ============================================================================
// GET /api/v3/devbox/me - Get current user profile including team
// ============================================================================
export const getMe = httpAction(async (ctx) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const userId = identity!.subject;

    // Look up user in users table by their Stack Auth subject (userId)
    const user = await ctx.runQuery(internal.users.getByUserIdInternal, {
      userId,
    });

    // Get user's team memberships to find a valid team
    const memberships = await ctx.runQuery(
      internal.teams.getMembershipsByUserIdInternal,
      {
        userId,
      }
    );

    let teamId: string | null = null;
    let teamSlug: string | null = null;
    let teamDisplayName: string | null = null;

    // First, check if user's selectedTeamId is valid (they have membership)
    if (user?.selectedTeamId) {
      const hasMembership = memberships.some(
        (m: { teamId: string }) => m.teamId === user.selectedTeamId
      );
      if (hasMembership) {
        const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
          teamId: user.selectedTeamId,
        });
        if (team) {
          teamId = user.selectedTeamId;
          teamSlug = team.slug ?? team.uuid;
          teamDisplayName = team.displayName ?? team.name ?? null;
        }
      }
    }

    // Fall back to first team membership if selectedTeamId is invalid
    if (!teamId && memberships.length > 0) {
      const firstMembership = memberships[0];
      const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
        teamId: firstMembership.teamId,
      });
      if (team) {
        teamId = firstMembership.teamId;
        teamSlug = team.slug ?? team.uuid;
        teamDisplayName = team.displayName ?? team.name ?? null;
      } else {
        // Team doesn't exist in teams table, use raw teamId as slug
        teamId = firstMembership.teamId;
        teamSlug = firstMembership.teamId;
      }
    }

    return jsonResponse({
      userId,
      email: user?.primaryEmail ?? identity!.email,
      name: user?.displayName ?? identity!.name,
      teamId,
      teamSlug,
      teamDisplayName,
    });
  } catch (err) {
    console.error("[daytona.me] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to get user profile" },
      500
    );
  }
});

// ============================================================================
// Route handler for instance-specific POST actions
// ============================================================================
export const instanceActionRouter = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;
  const userId = identity!.subject;

  const url = new URL(req.url);
  const convexOrigin = url.origin;
  const path = url.pathname;

  // Parse path to get id and action
  // Path format: /api/v3/devbox/instances/{id}/{action}
  const pathParts = path.split("/").filter(Boolean);
  // pathParts: ["api", "v3", "devbox", "instances", "{id}", "{action}"]

  const id = pathParts[4];
  const action = pathParts[5];

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  let body: {
    teamSlugOrId: string;
    command?: string;
    timeout?: number;
    minutes?: number;
    timeoutMs?: number;
    cpu?: number;
    memory?: number;
    disk?: number;
    port?: number;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  // Route based on the action
  switch (action) {
    case "exec":
      if (!body.command) {
        return jsonResponse({ code: 400, message: "command is required" }, 400);
      }
      return handleExecCommand(
        ctx,
        id,
        body.teamSlugOrId,
        body.command,
        body.timeout
      );

    case "token":
      return handleGetAuthToken(ctx, id, body.teamSlugOrId);

    case "extend":
      if (body.timeoutMs === undefined) {
        return jsonResponse(
          { code: 400, message: "timeoutMs is required" },
          400
        );
      }
      return handleSetAutostop(
        ctx,
        id,
        body.teamSlugOrId,
        Math.max(1, Math.ceil(body.timeoutMs / 60000))
      );

    case "start":
      return handleStartInstance(ctx, id, body.teamSlugOrId);

    case "stop":
      return handleStopInstance(ctx, id, body.teamSlugOrId);

    case "archive":
      return handleArchiveInstance(ctx, id, body.teamSlugOrId);

    case "autostop":
      if (body.minutes === undefined) {
        return jsonResponse({ code: 400, message: "minutes is required" }, 400);
      }
      return handleSetAutostop(ctx, id, body.teamSlugOrId, body.minutes);

    case "resize":
      return handleResizeInstance(
        ctx,
        id,
        body.teamSlugOrId,
        body.cpu,
        body.memory,
        body.disk
      );

    case "terminal":
      return handleStartTerminal(ctx, convexOrigin, id, body.teamSlugOrId, userId);

    case "code":
      return handleStartCode(ctx, convexOrigin, id, body.teamSlugOrId, userId);

    case "vnc":
      return handleStartVnc(ctx, convexOrigin, id, body.teamSlugOrId, userId);

    case "ssh-setup":
      return handleSetupSsh(ctx, id, body.teamSlugOrId);

    default:
      return jsonResponse({ code: 404, message: "Not found" }, 404);
  }
});

// ============================================================================
// Route handler for instance-specific GET actions
// ============================================================================
export const instanceGetRouter = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path to get id and action
  const pathParts = path.split("/").filter(Boolean);
  // pathParts: ["api", "v3", "devbox", "instances", "{id}", "{action}?"]

  const id = pathParts[4];
  const action = pathParts[5]; // May be undefined for GET /instances/{id}

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  // Route based on the action suffix
  if (action === "ssh") {
    return handleGetInstanceSsh(ctx, id, teamSlugOrId);
  }

  if (action === "preview") {
    const portStr = url.searchParams.get("port");
    if (!portStr) {
      return jsonResponse(
        { code: 400, message: "port query parameter is required" },
        400
      );
    }
    const port = parseInt(portStr, 10);
    if (isNaN(port)) {
      return jsonResponse({ code: 400, message: "Invalid port number" }, 400);
    }
    return handleGetPreviewUrl(ctx, id, teamSlugOrId, port);
  }

  // Default: get instance details
  return handleGetInstance(ctx, id, teamSlugOrId);
});

// ============================================================================
// Route handler for instance-specific DELETE actions
// ============================================================================
export const instanceDeleteRouter = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path: /api/v3/devbox/instances/{id}
  const pathParts = path.split("/").filter(Boolean);
  const id = pathParts[4];

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  return handleDeleteInstance(ctx, id, teamSlugOrId);
});

// ============================================================================
// GET /api/v3/devbox/preview/{code} - Secure preview redirect (token hidden)
// This endpoint serves an HTML page that redirects to Daytona with the token
// in a way that the token never appears in the browser's address bar.
// ============================================================================
export const previewRedirect = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Parse path: /api/v3/devbox/preview/{code}
  const pathParts = path.split("/").filter(Boolean);
  const code = pathParts[4]; // api/v3/devbox/preview/{code}

  if (!code) {
    return new Response("Missing preview code", { status: 400 });
  }

  // Look up the preview code to get the target URL and token
  const previewData = await ctx.runQuery(internal.daytonaPreviewCodes.getByCode, { code });

  if (!previewData) {
    return new Response("Invalid or expired preview code", { status: 404 });
  }

  const { targetUrl, token } = previewData;

  // Build the final URL with token
  const finalUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);

  // Return an HTML page that embeds the preview in a fullscreen iframe.
  // This way the token is never visible in the browser's address bar.
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>cmux Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; }
    .loading {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; justify-content: center; align-items: center;
      background: #1a1a2e; color: #eee; font-family: system-ui, sans-serif;
    }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; margin-right: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loaded .loading { display: none; }
  </style>
</head>
<body>
  <div class="loading">
    <div class="spinner"></div>
    <div>Loading preview...</div>
  </div>
  <iframe id="preview" src="${finalUrl.replace(/"/g, '&quot;')}" onload="document.body.classList.add('loaded')"></iframe>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
});
