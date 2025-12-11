import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { z } from "zod";

// Note: The action is in screenshotCollectorActions.ts (with "use node")

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UploadRequestSchema = z.object({
  version: z.string().min(1),
  downloadUrl: z.string().url(),
  sha256: z.string().length(64),
  size: z.number().positive(),
  commitSha: z.string().min(7),
  isStaging: z.boolean(),
});

/**
 * HTTP endpoint for GitHub Actions to trigger upload of a new screenshot collector release.
 * This is called by the screenshot-collector.yml workflow after a new release is created.
 */
export const uploadScreenshotCollector = httpAction(async (ctx, req) => {
  // Validate content type
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  // Validate request schema
  const validation = UploadRequestSchema.safeParse(body);
  if (!validation.success) {
    console.warn(
      "[screenshot-collector] Invalid upload request",
      validation.error
    );
    return jsonResponse(
      { code: 400, message: "Invalid request body", errors: validation.error.issues },
      400
    );
  }

  const payload = validation.data;

  console.log(
    `[screenshot-collector] Upload request received: version=${payload.version}, isStaging=${payload.isStaging}`
  );

  try {
    // Trigger the upload action (from screenshotCollectorActions)
    const result = await ctx.runAction(api.screenshotCollectorActions.uploadFromGitHub, {
      version: payload.version,
      downloadUrl: payload.downloadUrl,
      sha256: payload.sha256,
      size: payload.size,
      commitSha: payload.commitSha,
      isStaging: payload.isStaging,
    });

    console.log(`[screenshot-collector] Upload completed: ${JSON.stringify(result)}`);

    return jsonResponse(result);
  } catch (error) {
    console.error(
      "[screenshot-collector] Upload failed:",
      error instanceof Error ? error.message : String(error)
    );
    return jsonResponse(
      {
        code: 500,
        message: "Upload failed",
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * HTTP endpoint to get the latest screenshot collector release URL.
 * Used by workers to download the collector at runtime.
 */
export const getLatestScreenshotCollector = httpAction(async (ctx, req) => {
  // Parse isStaging from query params
  const url = new URL(req.url);
  const isStagingParam = url.searchParams.get("isStaging");
  const isStaging = isStagingParam === "true" || isStagingParam === "1";

  const release = await ctx.runQuery(api.screenshotCollector.getLatestRelease, {
    isStaging,
  });

  if (!release) {
    return jsonResponse(
      {
        code: 404,
        message: `No active screenshot collector release found for ${isStaging ? "staging" : "production"}`,
      },
      404
    );
  }

  return jsonResponse({
    ok: true,
    version: release.version,
    downloadUrl: release.downloadUrl,
    sha256: release.sha256,
    size: release.size,
    commitSha: release.commitSha,
    uploadedAt: release.uploadedAt,
  });
});
