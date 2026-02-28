/**
 * HTTP Actions for Orchestration with JWT Authentication
 *
 * These endpoints allow agents to spawn sub-agents using their task-run JWT
 * instead of requiring Stack Auth Bearer tokens.
 */

import { verifyTaskRunToken } from "../../shared/src/convex-safe";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { z } from "zod";

/**
 * Pre-fetched spawn configuration data type.
 * This is returned by the getSpawnConfig endpoint and passed to spawnAgent.
 */
export interface SpawnConfigData {
  apiKeys: Record<string, string>;
  workspaceSettings: {
    bypassAnthropicProxy: boolean;
  } | null;
  providerOverrides: Array<{
    providerId: string;
    baseUrl?: string;
    apiFormat?: string;
    apiKeyEnvVar?: string;
    customHeaders?: Record<string, string>;
    fallbacks?: Array<{ modelName: string; priority: number }>;
    enabled: boolean;
  }>;
  previousKnowledge: string | null;
  previousMailbox: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function extractBearerToken(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

const CreateTaskAndRunSchema = z.object({
  text: z.string().min(1),
  projectFullName: z.string().optional(),
  baseBranch: z.string().optional(),
  prompt: z.string().min(1),
  agentName: z.string().optional(),
  newBranch: z.string().optional(),
  environmentId: z.string().optional(),
  pullRequestTitle: z.string().optional(),
});

type CreateTaskAndRunInput = z.infer<typeof CreateTaskAndRunSchema>;

/**
 * HTTP action to create a task and task run in one call.
 *
 * Authenticates via task-run JWT (X-Task-Run-JWT header).
 * Used by agents to spawn sub-agents.
 *
 * Returns: { taskId, taskRunId, jwt }
 */
export const createTaskAndRun = httpAction(async (ctx, req) => {
  // Support both X-Task-Run-JWT header and Bearer token with task-run JWT
  const taskRunJwt = req.headers.get("x-task-run-jwt");
  const authHeader = req.headers.get("authorization");
  const bearerToken = extractBearerToken(authHeader);
  const token = taskRunJwt ?? bearerToken;

  if (!token) {
    console.warn("[orchestration_http] Missing JWT token");
    return jsonResponse(
      {
        code: 401,
        message: "Unauthorized: Missing X-Task-Run-JWT header or Bearer token",
      },
      401
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  let payload: CreateTaskAndRunInput;
  try {
    const parsed = await req.json();
    const validation = CreateTaskAndRunSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn(
        "[orchestration_http] Invalid payload",
        validation.error.flatten()
      );
      return jsonResponse({ code: 400, message: "Invalid payload" }, 400);
    }
    payload = validation.data;
  } catch (error) {
    console.error("[orchestration_http] Failed to parse payload", error);
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  // Verify the JWT
  let teamId: string;
  let userId: string;

  try {
    const tokenPayload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    teamId = tokenPayload.teamId;
    userId = tokenPayload.userId;
  } catch (error) {
    console.error("[orchestration_http] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    // Create task
    const taskResult = await ctx.runMutation(internal.tasks.createInternal, {
      teamId,
      userId,
      text: payload.text,
      projectFullName: payload.projectFullName ?? "",
      baseBranch: payload.baseBranch,
      pullRequestTitle: payload.pullRequestTitle,
    });

    // Create task run
    const taskRunResult = await ctx.runMutation(
      internal.taskRuns.createInternal,
      {
        teamId,
        userId,
        taskId: taskResult.taskId,
        prompt: payload.prompt,
        agentName: payload.agentName,
        newBranch: payload.newBranch,
        environmentId: payload.environmentId as Id<"environments"> | undefined,
      }
    );

    return jsonResponse({
      taskId: taskResult.taskId,
      taskRunId: taskRunResult.taskRunId,
      jwt: taskRunResult.jwt,
    });
  } catch (error) {
    console.error("[orchestration_http] Failed to create task/run", error);
    return jsonResponse(
      { code: 500, message: "Failed to create task and run" },
      500
    );
  }
});

const CreateOrchestrationTaskSchema = z.object({
  prompt: z.string().min(1),
  taskId: z.string().min(1),
  taskRunId: z.string().min(1),
  priority: z.number().optional(),
  dependencies: z.array(z.string()).optional(),
});

type CreateOrchestrationTaskInput = z.infer<
  typeof CreateOrchestrationTaskSchema
>;

/**
 * HTTP action to create an orchestration task.
 *
 * Authenticates via task-run JWT.
 * Used by agents to track their spawned sub-tasks.
 */
export const createOrchestrationTask = httpAction(async (ctx, req) => {
  const taskRunJwt = req.headers.get("x-task-run-jwt");
  const authHeader = req.headers.get("authorization");
  const bearerToken = extractBearerToken(authHeader);
  const token = taskRunJwt ?? bearerToken;

  if (!token) {
    return jsonResponse(
      {
        code: 401,
        message: "Unauthorized: Missing X-Task-Run-JWT header or Bearer token",
      },
      401
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  let payload: CreateOrchestrationTaskInput;
  try {
    const parsed = await req.json();
    const validation = CreateOrchestrationTaskSchema.safeParse(parsed);
    if (!validation.success) {
      return jsonResponse({ code: 400, message: "Invalid payload" }, 400);
    }
    payload = validation.data;
  } catch (error) {
    console.error("[orchestration_http.createOrchestrationTask] Failed to parse JSON", error);
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  let teamId: string;
  let userId: string;

  try {
    const tokenPayload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    teamId = tokenPayload.teamId;
    userId = tokenPayload.userId;
  } catch (error) {
    console.error("[orchestration_http.createOrchestrationTask] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    const orchestrationTaskId = await ctx.runMutation(
      internal.orchestrationQueries.createTaskInternal,
      {
        teamId,
        userId,
        prompt: payload.prompt,
        taskId: payload.taskId as Id<"tasks">,
        taskRunId: payload.taskRunId as Id<"taskRuns">,
        priority: payload.priority ?? 5,
        dependencies: payload.dependencies?.map(
          (id) => id as Id<"orchestrationTasks">
        ),
      }
    );

    return jsonResponse({ orchestrationTaskId });
  } catch (error) {
    console.error(
      "[orchestration_http] Failed to create orchestration task",
      error
    );
    return jsonResponse({ code: 500, message: "Failed to create task" }, 500);
  }
});

const UpdateOrchestrationTaskSchema = z.object({
  orchestrationTaskId: z.string().min(1),
  status: z
    .enum(["assigned", "running", "completed", "failed", "cancelled"])
    .optional(),
  agentName: z.string().optional(),
  sandboxId: z.string().optional(),
  errorMessage: z.string().optional(),
  result: z.string().optional(),
});

type UpdateOrchestrationTaskInput = z.infer<
  typeof UpdateOrchestrationTaskSchema
>;

/**
 * HTTP action to update an orchestration task status.
 *
 * Authenticates via task-run JWT.
 */
export const updateOrchestrationTask = httpAction(async (ctx, req) => {
  const taskRunJwt = req.headers.get("x-task-run-jwt");
  const authHeader = req.headers.get("authorization");
  const bearerToken = extractBearerToken(authHeader);
  const token = taskRunJwt ?? bearerToken;

  if (!token) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  let payload: UpdateOrchestrationTaskInput;
  try {
    const parsed = await req.json();
    const validation = UpdateOrchestrationTaskSchema.safeParse(parsed);
    if (!validation.success) {
      return jsonResponse({ code: 400, message: "Invalid payload" }, 400);
    }
    payload = validation.data;
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  // Verify JWT and extract teamId for authorization check
  let tokenTeamId: string;
  try {
    const tokenPayload = await verifyTaskRunToken(token, env.CMUX_TASK_RUN_JWT_SECRET);
    tokenTeamId = tokenPayload.teamId;
  } catch {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const orchestrationTaskId = payload.orchestrationTaskId as Id<
    "orchestrationTasks"
  >;

  try {
    // Verify the orchestration task belongs to the same team as the JWT
    const task = await ctx.runQuery(
      internal.orchestrationQueries.getTaskInternal,
      { taskId: orchestrationTaskId }
    );
    if (!task) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }
    if (task.teamId !== tokenTeamId) {
      console.warn(
        "[orchestration_http] TeamId mismatch in updateOrchestrationTask",
        { taskTeamId: task.teamId, tokenTeamId }
      );
      return jsonResponse({ code: 403, message: "Forbidden: Team mismatch" }, 403);
    }

    // Handle different status updates
    if (payload.status === "assigned" && payload.agentName) {
      await ctx.runMutation(internal.orchestrationQueries.assignTaskInternal, {
        taskId: orchestrationTaskId,
        agentName: payload.agentName,
        sandboxId: payload.sandboxId,
      });
    } else if (payload.status === "running") {
      await ctx.runMutation(internal.orchestrationQueries.startTaskInternal, {
        taskId: orchestrationTaskId,
      });
    } else if (payload.status === "failed" && payload.errorMessage) {
      await ctx.runMutation(internal.orchestrationQueries.failTaskInternal, {
        taskId: orchestrationTaskId,
        errorMessage: payload.errorMessage,
      });
    } else if (payload.status === "completed") {
      // Note: completeTask is an authMutation, need to add internal version
      await ctx.runMutation(internal.orchestrationQueries.completeTaskInternal, {
        taskId: orchestrationTaskId,
        result: payload.result,
      });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error(
      "[orchestration_http] Failed to update orchestration task",
      error
    );
    return jsonResponse({ code: 500, message: "Failed to update task" }, 500);
  }
});

/**
 * HTTP action to get spawn configuration data for JWT-based auth.
 *
 * This endpoint fetches all the data that spawnAgent needs from Convex,
 * allowing JWT-authenticated spawn paths to work without Stack Auth context.
 *
 * Authenticates via task-run JWT.
 * Returns: SpawnConfigData
 */
export const getSpawnConfig = httpAction(async (ctx, req) => {
  const taskRunJwt = req.headers.get("x-task-run-jwt");
  const authHeader = req.headers.get("authorization");
  const bearerToken = extractBearerToken(authHeader);
  const token = taskRunJwt ?? bearerToken;

  if (!token) {
    return jsonResponse(
      {
        code: 401,
        message: "Unauthorized: Missing X-Task-Run-JWT header or Bearer token",
      },
      401
    );
  }

  // Verify the JWT
  let teamId: string;
  let userId: string;

  try {
    const tokenPayload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    teamId = tokenPayload.teamId;
    userId = tokenPayload.userId;
  } catch (error) {
    console.error("[orchestration_http] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    // Fetch all spawn configuration data in parallel
    const [apiKeys, workspaceSettings, providerOverrides, previousKnowledge, previousMailbox] =
      await Promise.all([
        ctx.runQuery(internal.apiKeys.getAllForAgentsInternal, { teamId, userId }),
        ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, { teamId, userId }),
        ctx.runQuery(internal.providerOverrides.getAllEnabledForTeam, { teamId }),
        ctx.runQuery(internal.agentMemoryQueries.getLatestTeamKnowledgeInternal, { teamId }),
        ctx.runQuery(internal.agentMemoryQueries.getLatestTeamMailboxInternal, { teamId }),
      ]);

    const config: SpawnConfigData = {
      apiKeys,
      workspaceSettings: workspaceSettings
        ? { bypassAnthropicProxy: workspaceSettings.bypassAnthropicProxy ?? false }
        : null,
      providerOverrides: providerOverrides.map((o) => ({
        providerId: o.providerId,
        baseUrl: o.baseUrl,
        apiFormat: o.apiFormat,
        apiKeyEnvVar: o.apiKeyEnvVar,
        customHeaders: o.customHeaders,
        fallbacks: o.fallbacks,
        enabled: o.enabled,
      })),
      previousKnowledge,
      previousMailbox,
    };

    return jsonResponse(config);
  } catch (error) {
    console.error("[orchestration_http] Failed to get spawn config", error);
    return jsonResponse(
      { code: 500, message: "Failed to get spawn configuration" },
      500
    );
  }
});

// ============================================================================
// Orchestration State Pull API (Phase 1 - Bi-directional Sync)
// ============================================================================

/**
 * Response type for orchestration state pull API.
 * Returns aggregated state for head agents to sync local PLAN.json.
 */
export interface OrchestrationStateUpdate {
  orchestrationId: string;
  tasks: Array<{
    id: string;
    status: string;
    result?: string;
    errorMessage?: string;
    completedAt?: number;
    assignedAgentName?: string;
    assignedSandboxId?: string;
  }>;
  messages: Array<{
    id: string;
    from: string;
    to: string;
    type: string;
    message: string;
    timestamp: number;
    read: boolean;
  }>;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  runningCount: number;
}

/**
 * HTTP action to pull orchestration state updates for head agents.
 *
 * Head agents can call this to get:
 * - Current status of all sub-agent tasks
 * - Unread messages from the mailbox
 * - Aggregated completion counts
 *
 * Authenticates via task-run JWT only (X-Task-Run-JWT header).
 * GET /api/orchestration/pull?orchestrationId=...&taskRunId=...
 */
export const pullOrchestrationState = httpAction(async (ctx, req) => {
  const taskRunJwt = req.headers.get("x-task-run-jwt");

  if (!taskRunJwt) {
    return jsonResponse(
      {
        code: 401,
        message: "Unauthorized: Missing X-Task-Run-JWT header",
      },
      401
    );
  }

  // Parse query params
  const url = new URL(req.url);
  const orchestrationId = url.searchParams.get("orchestrationId") || undefined;
  const taskRunId = url.searchParams.get("taskRunId") || undefined;

  // Verify the JWT
  let teamId: string;
  let taskRunIdFromToken: string | undefined;

  try {
    const tokenPayload = await verifyTaskRunToken(
      taskRunJwt,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    teamId = tokenPayload.teamId;
    taskRunIdFromToken = tokenPayload.taskRunId;
  } catch (error) {
    console.error("[orchestration_http.pullOrchestrationState] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized: Invalid task-run JWT" }, 401);
  }

  // Use taskRunId from params or from JWT
  const effectiveTaskRunId = taskRunId || taskRunIdFromToken;

  try {
    // Fetch orchestration tasks for this team
    const tasks = await ctx.runQuery(
      internal.orchestrationQueries.getOrchestrationStateInternal,
      {
        teamId,
        orchestrationId,
        taskRunId: effectiveTaskRunId as Id<"taskRuns"> | undefined,
      }
    );

    // Fetch messages for this task run (if available)
    let messages: OrchestrationStateUpdate["messages"] = [];
    if (effectiveTaskRunId) {
      const rawMessages = await ctx.runQuery(
        internal.orchestrationQueries.getMessagesForTaskRunInternal,
        { taskRunId: effectiveTaskRunId as Id<"taskRuns"> }
      );
      messages = rawMessages.map((m) => ({
        id: m.messageId,
        from: m.senderName,
        to: m.recipientName || "*",
        type: m.messageType,
        message: m.content,
        timestamp: m.timestamp,
        read: m.read,
      }));
    }

    // Calculate counts
    const completedCount = tasks.filter((t) => t.status === "completed").length;
    const pendingCount = tasks.filter((t) => t.status === "pending").length;
    const failedCount = tasks.filter((t) => t.status === "failed").length;
    const runningCount = tasks.filter((t) => t.status === "running" || t.status === "assigned").length;

    const response: OrchestrationStateUpdate = {
      orchestrationId: orchestrationId || "default",
      tasks: tasks.map((t) => ({
        id: t._id,
        status: t.status,
        result: t.result,
        errorMessage: t.errorMessage,
        completedAt: t.completedAt,
        assignedAgentName: t.assignedAgentName,
        assignedSandboxId: t.assignedSandboxId,
      })),
      messages,
      completedCount,
      pendingCount,
      failedCount,
      runningCount,
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("[orchestration_http.pullOrchestrationState] Failed to pull state", error);
    return jsonResponse(
      { code: 500, message: "Failed to pull orchestration state" },
      500
    );
  }
});

// ============================================================================
// Orchestration Results API (Phase 2 - Results Aggregation)
// ============================================================================

/**
 * Response type for orchestration results API.
 * Returns aggregated results from all sub-agents.
 */
export interface OrchestrationResults {
  orchestrationId: string;
  status: "running" | "completed" | "failed" | "partial";
  totalTasks: number;
  completedTasks: number;
  results: Array<{
    taskId: string;
    agentName?: string;
    status: string;
    prompt: string;
    result?: string;
    errorMessage?: string;
    taskRunId?: string;
  }>;
}

/**
 * HTTP action to get aggregated results from all sub-agents.
 *
 * Authenticates via task-run JWT only (X-Task-Run-JWT header).
 * GET /api/orchestration/results?orchestrationId=...
 */
export const getOrchestrationResults = httpAction(async (ctx, req) => {
  const taskRunJwt = req.headers.get("x-task-run-jwt");

  if (!taskRunJwt) {
    return jsonResponse(
      {
        code: 401,
        message: "Unauthorized: Missing X-Task-Run-JWT header",
      },
      401
    );
  }

  // Parse query params
  const url = new URL(req.url);
  const orchestrationId = url.searchParams.get("orchestrationId");

  if (!orchestrationId) {
    return jsonResponse(
      { code: 400, message: "Missing required query param: orchestrationId" },
      400
    );
  }

  // Verify the JWT
  let teamId: string;

  try {
    const tokenPayload = await verifyTaskRunToken(
      taskRunJwt,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    teamId = tokenPayload.teamId;
  } catch (error) {
    console.error("[orchestration_http.getOrchestrationResults] Failed to verify JWT", error);
    return jsonResponse({ code: 401, message: "Unauthorized: Invalid task-run JWT" }, 401);
  }

  try {
    // Fetch orchestration tasks
    const tasks = await ctx.runQuery(
      internal.orchestrationQueries.getOrchestrationStateInternal,
      { teamId, orchestrationId }
    );

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const failedTasks = tasks.filter((t) => t.status === "failed").length;

    // Determine overall status
    let status: OrchestrationResults["status"];
    if (totalTasks === 0) {
      status = "completed";
    } else if (completedTasks === totalTasks) {
      status = "completed";
    } else if (failedTasks > 0 && completedTasks + failedTasks === totalTasks) {
      status = "failed";
    } else if (completedTasks > 0 || failedTasks > 0) {
      status = "partial";
    } else {
      status = "running";
    }

    const response: OrchestrationResults = {
      orchestrationId,
      status,
      totalTasks,
      completedTasks,
      results: tasks.map((t) => ({
        taskId: t._id,
        agentName: t.assignedAgentName,
        status: t.status,
        prompt: t.prompt,
        result: t.result,
        errorMessage: t.errorMessage,
        taskRunId: t.taskRunId,
      })),
    };

    return jsonResponse(response);
  } catch (error) {
    console.error("[orchestration_http.getOrchestrationResults] Failed to get results", error);
    return jsonResponse(
      { code: 500, message: "Failed to get orchestration results" },
      500
    );
  }
});
