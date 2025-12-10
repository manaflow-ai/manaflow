import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const scriptsRouter = new OpenAPIHono();

// Cache the script content in memory after first read
let cachedScriptContent: string | null = null;
let cachedScriptHash: string | null = null;

async function getScriptContent(): Promise<{ content: string; hash: string }> {
  if (cachedScriptContent && cachedScriptHash) {
    return { content: cachedScriptContent, hash: cachedScriptHash };
  }

  // Try multiple possible locations for the bundled script
  const possiblePaths = [
    // Production: script is copied to www/public/scripts during build
    path.join(process.cwd(), "public/scripts/screenshot-collector.js"),
    // Development: read from worker dist
    path.join(process.cwd(), "../worker/dist/screenshot-collector.js"),
  ];

  for (const scriptPath of possiblePaths) {
    try {
      const content = await fs.readFile(scriptPath, "utf-8");

      // Compute a simple hash for caching purposes
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

      cachedScriptContent = content;
      cachedScriptHash = hash.slice(0, 16); // Short hash for ETag

      return { content, hash: cachedScriptHash };
    } catch {
      // Try next path
      continue;
    }
  }

  throw new Error("Screenshot collector script not found. Run the build script first.");
}

// Endpoint to get the screenshot collector script
scriptsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/scripts/screenshot-collector",
    tags: ["Scripts"],
    summary: "Get the screenshot collector script",
    description:
      "Returns the bundled screenshot collector script that can be executed by workers",
    responses: {
      200: {
        content: {
          "application/javascript": {
            schema: z.string(),
          },
        },
        description: "The bundled screenshot collector script",
      },
      500: {
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
        description: "Script not found or build error",
      },
    },
  }),
  async (c) => {
    try {
      const { content, hash } = await getScriptContent();

      // Check If-None-Match header for caching
      const ifNoneMatch = c.req.header("If-None-Match");
      if (ifNoneMatch === hash) {
        return new Response(null, { status: 304 });
      }

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=60", // Cache for 1 minute
          ETag: hash,
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to load script" },
        500
      );
    }
  }
);

// Endpoint to get script metadata (hash, etc.) for cache invalidation checks
scriptsRouter.openapi(
  createRoute({
    method: "head" as const,
    path: "/scripts/screenshot-collector",
    tags: ["Scripts"],
    summary: "Get screenshot collector script metadata",
    description: "Returns headers with script hash for cache validation",
    responses: {
      200: {
        description: "Script metadata in headers",
      },
      500: {
        description: "Script not found",
      },
    },
  }),
  async (_c) => {
    try {
      const { hash } = await getScriptContent();

      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "application/javascript",
          ETag: hash,
        },
      });
    } catch {
      return new Response(null, { status: 500 });
    }
  }
);

// Endpoint to invalidate the cache (useful during development)
scriptsRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/scripts/screenshot-collector/invalidate",
    tags: ["Scripts"],
    summary: "Invalidate the script cache",
    description: "Forces the next request to reload the script from disk",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
            }),
          },
        },
        description: "Cache invalidated",
      },
    },
  }),
  async (c) => {
    cachedScriptContent = null;
    cachedScriptHash = null;
    return c.json({ success: true });
  }
);
