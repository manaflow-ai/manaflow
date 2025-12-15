import { httpAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

/**
 * HTTP endpoint for syncing host screenshot collector releases from GitHub Actions
 *
 * Expected request format:
 * POST /api/host-screenshot-collector/sync
 * Headers:
 *   Content-Type: application/octet-stream
 *   X-Version: <version string>
 *   X-Commit-SHA: <full commit sha>
 *   X-Is-Staging: true|false
 *   X-Release-URL: <optional github release url>
 *   Authorization: Bearer <CONVEX_DEPLOY_KEY>
 * Body: Raw JavaScript file content
 */
export const syncRelease = httpAction(async (ctx, request) => {
  // Validate required headers
  const version = request.headers.get("X-Version");
  const commitSha = request.headers.get("X-Commit-SHA");
  const isStagingHeader = request.headers.get("X-Is-Staging");
  const releaseUrl = request.headers.get("X-Release-URL") ?? undefined;

  if (!version || !commitSha || !isStagingHeader) {
    return new Response(
      JSON.stringify({
        error: "Missing required headers: X-Version, X-Commit-SHA, X-Is-Staging",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const isStaging = isStagingHeader.toLowerCase() === "true";

  // Get file content from request body
  const fileContent = await request.arrayBuffer();
  if (fileContent.byteLength === 0) {
    return new Response(
      JSON.stringify({ error: "Empty request body" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  try {
    const result = await ctx.runAction(internal.hostScreenshotCollectorActions.syncReleaseFromHttp, {
      version,
      commitSha,
      isStaging,
      releaseUrl,
      fileContent,
    });

    return new Response(
      JSON.stringify({
        success: true,
        version,
        isStaging,
        releaseId: result.releaseId,
        storageId: result.storageId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Failed to sync release:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to sync release",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * HTTP endpoint to get the latest release URL
 * GET /api/host-screenshot-collector/latest?staging=true|false
 */
export const getLatest = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const stagingParam = url.searchParams.get("staging");
  const isStaging = stagingParam?.toLowerCase() === "true";

  const release = await ctx.runQuery(api.hostScreenshotCollector.getLatestReleaseUrl, {
    isStaging,
  });

  if (!release) {
    return new Response(
      JSON.stringify({
        error: "No release found",
        isStaging,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response(JSON.stringify(release), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
