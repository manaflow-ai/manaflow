import type { ScreenshotUploadPayload } from "@cmux/shared";
import type { Id } from "@cmux/convex/dataModel";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { log } from "../logger";
import { startScreenshotCollection } from "./startScreenshotCollection";
import { createScreenshotUploadUrl, uploadScreenshot } from "./upload";

/**
 * Memory optimization: Process uploads with bounded concurrency to prevent
 * loading all screenshot files into memory simultaneously.
 * Each screenshot can be 100KB-1MB, so uploading 20 screenshots in parallel
 * could use 20MB+ of memory just for file buffers.
 */
const MAX_CONCURRENT_UPLOADS = 3;

async function processWithConcurrencyLimit<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrencyLimit: number
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let currentIndex = 0;

  async function processNext(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];
      if (!item) continue;

      try {
        const result = await processor(item, index);
        results[index] = { status: "fulfilled", value: result };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  // Start concurrent workers up to the limit
  const workers = Array.from(
    { length: Math.min(concurrencyLimit, items.length) },
    () => processNext()
  );

  await Promise.all(workers);
  return results;
}

export interface RunTaskScreenshotsOptions {
  taskId: Id<"tasks">;
  taskRunId: Id<"taskRuns">;
  token: string;
  convexUrl?: string;
  anthropicApiKey?: string | null;
  taskRunJwt?: string | null;
  /** Command to install dependencies (e.g., "bun install") */
  installCommand?: string | null;
  /** Command to start the dev server (e.g., "bun run dev") */
  devCommand?: string | null;
}

function resolveContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

async function uploadScreenshotFile(params: {
  screenshotPath: string;
  fileName?: string;
  commitSha: string;
  token: string;
  convexUrl?: string;
  description?: string;
}): Promise<NonNullable<ScreenshotUploadPayload["images"]>[number]> {
  const { screenshotPath, fileName, commitSha, token, convexUrl, description } =
    params;
  const resolvedFileName = fileName ?? path.basename(screenshotPath);
  const contentType = resolveContentType(screenshotPath);

  const uploadUrl = await createScreenshotUploadUrl({
    token,
    baseUrlOverride: convexUrl,
    contentType,
  });

  const bytes = await fs.readFile(screenshotPath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body: new Uint8Array(bytes),
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(
      `Upload failed with status ${uploadResponse.status}: ${body}`
    );
  }

  const uploadResult = (await uploadResponse.json()) as {
    storageId?: string;
  };
  if (!uploadResult.storageId) {
    throw new Error("Upload response missing storageId");
  }

  return {
    storageId: uploadResult.storageId,
    mimeType: contentType,
    fileName: resolvedFileName,
    commitSha,
    description,
  };
}

export async function runTaskScreenshots(
  options: RunTaskScreenshotsOptions
): Promise<void> {
  const { taskId, taskRunId, token, convexUrl, anthropicApiKey } = options;
  const taskRunJwt = options.taskRunJwt ?? token;

  log("INFO", "Starting automated screenshot workflow", {
    taskId,
    taskRunId,
    hasAnthropicKey: Boolean(anthropicApiKey ?? process.env.ANTHROPIC_API_KEY),
  });

  const result = await startScreenshotCollection({
    anthropicApiKey: anthropicApiKey ?? undefined,
    taskRunJwt,
    convexUrl,
    installCommand: options.installCommand,
    devCommand: options.devCommand,
  });

  let images: ScreenshotUploadPayload["images"];
  let hasUiChanges: boolean | undefined;
  let status: ScreenshotUploadPayload["status"] = "failed";
  let error: string | undefined;
  let commitSha: string | undefined;

  if (result.status === "completed") {
    commitSha = result.commitSha;
    const capturedScreens = result.screenshots ?? [];
    hasUiChanges = result.hasUiChanges;
    if (capturedScreens.length === 0) {
      status = "failed";
      error = "Claude collector returned no screenshots";
      log("ERROR", error, { taskRunId });
    } else {
      // Memory optimization: Use bounded concurrency instead of Promise.allSettled
      // to avoid loading all screenshot files into memory simultaneously
      const settledUploads = await processWithConcurrencyLimit(
        capturedScreens,
        (screenshot) =>
          uploadScreenshotFile({
            screenshotPath: screenshot.path,
            fileName: screenshot.fileName,
            commitSha: result.commitSha,
            token,
            convexUrl,
            description: screenshot.description,
          }),
        MAX_CONCURRENT_UPLOADS
      );
      const successfulScreens: NonNullable<ScreenshotUploadPayload["images"]> =
        [];
      const failures: { index: number; reason: string }[] = [];

      settledUploads.forEach((settled, index) => {
        if (settled.status === "fulfilled") {
          successfulScreens.push(settled.value);
        } else {
          const reason =
            settled.reason instanceof Error
              ? settled.reason.message
              : String(settled.reason);
          failures.push({ index, reason });
          log("ERROR", "Failed to upload screenshot", {
            taskRunId,
            screenshotPath: capturedScreens[index]?.path,
            error: reason,
          });
        }
      });

      if (failures.length === 0) {
        images = successfulScreens;
        status = "completed";
        log("INFO", "Screenshots uploaded", {
          taskRunId,
          screenshotCount: successfulScreens.length,
          commitSha: result.commitSha,
        });
      } else {
        status = "failed";
        error =
          failures.length === 1
            ? failures[0]?.reason
            : `Failed to upload ${failures.length} screenshots`;
      }
    }
  } else if (result.status === "skipped") {
    status = "skipped";
    error = result.reason;
    commitSha = result.commitSha;
    log("INFO", "Screenshot workflow skipped", {
      taskRunId,
      reason: result.reason,
    });
  } else if (result.status === "failed") {
    status = "failed";
    error = result.error;
    commitSha = result.commitSha;
    log("ERROR", "Screenshot workflow failed", {
      taskRunId,
      error: result.error,
    });
  } else {
    status = "failed";
    error = "Unknown screenshot workflow result";
    log("ERROR", "Screenshot workflow returned unknown status", {
      taskRunId,
      result,
    });
  }
  // For completed status, commitSha is required
  if (status === "completed" && !commitSha) {
    log("ERROR", "Cannot upload completed screenshot result without commitSha", {
      taskRunId,
      status,
      error,
    });
    return;
  }

  await uploadScreenshot({
    token,
    baseUrlOverride: convexUrl,
    payload: {
      taskId,
      runId: taskRunId,
      status,
      // Only include commitSha if available (required for completed, optional for failed/skipped)
      ...(commitSha && { commitSha }),
      images,
      error,
      hasUiChanges,
    },
  });
}
