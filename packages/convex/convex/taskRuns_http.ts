import { verifyTaskRunToken } from "../../shared/src/convex-safe";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { z } from "zod";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: {
      "Content-Type": "application/json",
    }
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

const ReportEnvironmentErrorSchema = z.object({
  maintenanceError: z.string().optional(),
  devError: z.string().optional(),
});

type ReportEnvironmentErrorInput = z.infer<
  typeof ReportEnvironmentErrorSchema
>;

export const reportEnvironmentError = httpAction(async (ctx, req) => {
  const authorizationHeader = req.headers.get("authorization");
  const bearerToken = extractBearerToken(authorizationHeader);

  if (!bearerToken) {
    console.warn("[convex.taskRuns] Missing bearer token for environment error");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415,
    );
  }

  let payload: ReportEnvironmentErrorInput;
  try {
    const parsed = await req.json();
    const validation = ReportEnvironmentErrorSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn(
        "[convex.taskRuns] Invalid environment error payload",
        validation.error.flatten(),
      );
      return jsonResponse({ code: 400, message: "Invalid payload" }, 400);
    }
    payload = validation.data;
  } catch (error) {
    console.error(
      "[convex.taskRuns] Failed to parse environment error payload",
      error,
    );
    return jsonResponse({ code: 400, message: "Invalid JSON" }, 400);
  }

  let taskRunId: Id<"taskRuns">;
  let teamId: string;
  let userId: string;

  try {
    const tokenPayload = await verifyTaskRunToken(
      bearerToken,
      env.CMUX_TASK_RUN_JWT_SECRET,
    );
    taskRunId = tokenPayload.taskRunId as Id<"taskRuns">;
    teamId = tokenPayload.teamId;
    userId = tokenPayload.userId;
  } catch (error) {
    console.error(
      "[convex.taskRuns] Failed to verify task run token",
      error,
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    await ctx.runMutation(internal.taskRuns.updateEnvironmentErrorFromWorker, {
      id: taskRunId,
      teamId,
      userId,
      maintenanceError: payload.maintenanceError,
      devError: payload.devError,
    });
  } catch (error) {
    console.error(
      "[convex.taskRuns] Failed to persist environment error",
      error,
    );
    return jsonResponse({ code: 500, message: "Failed to persist error" }, 500);
  }

  return jsonResponse({ ok: true });
});
