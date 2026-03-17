import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Get Content-Type from file extension
 */
function getContentType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    apng: "image/apng",
  };
  return mimeTypes[extension.toLowerCase()] ?? "application/octet-stream";
}

/**
 * Media proxy endpoint for serving Convex storage files with proper Content-Type headers.
 *
 * This is primarily needed for GitHub PR comments, which require:
 * 1. URLs ending in proper file extensions (e.g., .mp4)
 * 2. Proper Content-Type headers for the browser to recognize the file type
 * 3. Stable URLs that don't change over time
 *
 * Usage: GET /api/media/{storageId}.{ext}
 * Example: /api/media/kg2abc123def456.mp4
 *
 * The endpoint will:
 * 1. Validate the storage ID format
 * 2. Look up the file in Convex storage
 * 3. Fetch and serve the file with proper Content-Type headers
 */
export const serveMedia = httpAction(async (ctx, req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");

  // Expected path: /api/media/{storageId}.{ext} or /api/media/{storageId}
  // Find the storageId from the last path segment
  const lastSegment = pathParts[pathParts.length - 1];
  if (!lastSegment) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract file extension and storage ID
  const extensionMatch = lastSegment.match(/\.(mp4|webm|mov|avi|png|jpg|jpeg|gif|webp|apng)$/i);
  const extension = extensionMatch ? extensionMatch[1] : "mp4";
  const storageId = lastSegment.replace(/\.(mp4|webm|mov|avi|png|jpg|jpeg|gif|webp|apng)$/i, "");

  if (!storageId) {
    return new Response(JSON.stringify({ error: "Missing storage ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate storage ID format (Convex IDs are typically alphanumeric with specific patterns)
  // They look like "kg2abc123def456" - alphanumeric starting with "k" followed by more chars
  if (!/^[a-zA-Z0-9_-]+$/.test(storageId)) {
    return new Response(JSON.stringify({ error: "Invalid storage ID format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Get the storage URL from Convex
    const storageUrl = await ctx.storage.getUrl(storageId as Id<"_storage">);

    if (!storageUrl) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch the file from Convex storage
    const fileResponse = await fetch(storageUrl);
    if (!fileResponse.ok) {
      console.error("[media_proxy] Failed to fetch file from storage:", {
        storageId,
        status: fileResponse.status,
      });
      return new Response(JSON.stringify({ error: "Failed to fetch file" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get the file data
    const fileData = await fileResponse.arrayBuffer();
    const contentType = getContentType(extension);

    // Serve the file directly with proper headers
    return new Response(fileData, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileData.byteLength),
        // Allow browser caching
        "Cache-Control": "public, max-age=3600",
        // CORS headers for cross-origin access
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      },
    });
  } catch (error) {
    console.error("[media_proxy] Error serving media:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
