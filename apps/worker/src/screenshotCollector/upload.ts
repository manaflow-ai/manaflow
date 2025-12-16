import type {
  ScreenshotUploadPayload,
  ScreenshotUploadResponse,
  ScreenshotUploadUrlResponse,
} from "@cmux/shared";

import { convexRequest } from "../crown/convex";
import { log } from "../logger";

interface CreateUploadUrlOptions {
  token: string;
  contentType: string;
  baseUrlOverride?: string;
}

export async function createScreenshotUploadUrl(
  options: CreateUploadUrlOptions,
): Promise<string> {
  const response = await convexRequest<ScreenshotUploadUrlResponse>(
    "/api/screenshots/upload-url",
    options.token,
    { contentType: options.contentType },
    options.baseUrlOverride,
  );

  if (!response?.ok || !response.uploadUrl) {
    throw new Error("Failed to create screenshot upload URL");
  }

  return response.uploadUrl;
}

interface UploadScreenshotOptions {
  token: string;
  payload: ScreenshotUploadPayload;
  baseUrlOverride?: string;
}

export async function uploadScreenshot(
  options: UploadScreenshotOptions,
): Promise<void> {
  const response = await convexRequest<ScreenshotUploadResponse>(
    "/api/screenshots/upload",
    options.token,
    options.payload,
    options.baseUrlOverride,
  );

  if (!response?.ok) {
    log("ERROR", "Failed to upload screenshot metadata", {
      taskId: options.payload.taskId,
      taskRunId: options.payload.runId,
    });
  } else {
    log("INFO", "Screenshot metadata uploaded", {
      taskId: options.payload.taskId,
      taskRunId: options.payload.runId,
      storageIds: response.storageIds,
      screenshotSetId: response.screenshotSetId,
      status: options.payload.status,
    });
  }
}
