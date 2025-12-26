import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function ensureJsonRequest(
  req: Request
): Promise<{ json: unknown } | Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  try {
    const json = await req.json();
    return { json };
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
}

const StartRecordingSchema = z.object({
  taskRunId: z.string(),
  screenshotSetId: z.string().optional(),
  includeVideo: z.boolean().default(true),
  includeTrajectory: z.boolean().default(true),
});

const CompleteRecordingSchema = z.object({
  recordingId: z.string(),
  videoSizeBytes: z.number().optional(),
  videoDurationMs: z.number().optional(),
  videoWidth: z.number().optional(),
  videoHeight: z.number().optional(),
  trajectorySizeBytes: z.number().optional(),
  trajectoryMessageCount: z.number().optional(),
});

const FailRecordingSchema = z.object({
  recordingId: z.string(),
  errorMessage: z.string(),
});

export const startRecording = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[session-recordings]" });
  if (!auth) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = StartRecordingSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn("[session-recordings] Invalid start recording payload", validation.error);
    return jsonResponse({ code: 400, message: "Invalid input", details: validation.error.issues }, 400);
  }

  const payload = validation.data;

  const run = await ctx.runQuery(internal.taskRuns.getById, {
    id: payload.taskRunId as Id<"taskRuns">,
  });
  if (!run) {
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }

  if (run.teamId !== auth.payload.teamId || run.userId !== auth.payload.userId) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    const result = await ctx.runAction(internal.sessionRecordingsActions.startRecording, {
      taskRunId: payload.taskRunId as Id<"taskRuns">,
      screenshotSetId: payload.screenshotSetId as Id<"taskRunScreenshotSets"> | undefined,
      teamId: auth.payload.teamId,
      userId: auth.payload.userId,
      includeVideo: payload.includeVideo,
      includeTrajectory: payload.includeTrajectory,
    });

    return jsonResponse({
      ok: true,
      recordingId: result.recordingId,
      videoUploadUrl: result.videoUploadUrl,
      videoR2Key: result.videoR2Key,
      trajectoryUploadUrl: result.trajectoryUploadUrl,
      trajectoryR2Key: result.trajectoryR2Key,
    });
  } catch (error) {
    console.error("[session-recordings] Failed to start recording", error);
    return jsonResponse({ code: 500, message: "Failed to start recording" }, 500);
  }
});

export const completeRecording = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[session-recordings]" });
  if (!auth) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = CompleteRecordingSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn("[session-recordings] Invalid complete recording payload", validation.error);
    return jsonResponse({ code: 400, message: "Invalid input", details: validation.error.issues }, 400);
  }

  const payload = validation.data;

  try {
    await ctx.runAction(internal.sessionRecordingsActions.completeRecording, {
      recordingId: payload.recordingId as Id<"sessionRecordings">,
      videoSizeBytes: payload.videoSizeBytes,
      videoDurationMs: payload.videoDurationMs,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
      trajectorySizeBytes: payload.trajectorySizeBytes,
      trajectoryMessageCount: payload.trajectoryMessageCount,
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[session-recordings] Failed to complete recording", error);
    return jsonResponse({ code: 500, message: "Failed to complete recording" }, 500);
  }
});

export const failRecording = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[session-recordings]" });
  if (!auth) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = FailRecordingSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn("[session-recordings] Invalid fail recording payload", validation.error);
    return jsonResponse({ code: 400, message: "Invalid input", details: validation.error.issues }, 400);
  }

  const payload = validation.data;

  try {
    await ctx.runAction(internal.sessionRecordingsActions.failRecording, {
      recordingId: payload.recordingId as Id<"sessionRecordings">,
      errorMessage: payload.errorMessage,
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("[session-recordings] Failed to fail recording", error);
    return jsonResponse({ code: 500, message: "Failed to update recording status" }, 500);
  }
});
