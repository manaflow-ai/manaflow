import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@cmux/convex/api";
import { env } from "@/lib/utils/www-env";

const ScreenshotCollectorReleaseSchema = z
  .object({
    version: z.string().openapi({
      example: "20250611123456-abc1234",
      description: "Version identifier for the release",
    }),
    downloadUrl: z.string().url().openapi({
      example: "https://convex.storage/...",
      description: "URL to download the screenshot collector bundle",
    }),
    sha256: z.string().length(64).openapi({
      example: "abc123...",
      description: "SHA256 checksum of the bundle",
    }),
    size: z.number().positive().openapi({
      example: 12345,
      description: "Size of the bundle in bytes",
    }),
    commitSha: z.string().min(7).openapi({
      example: "abc1234",
      description: "Git commit SHA that built this release",
    }),
    uploadedAt: z.number().openapi({
      example: 1718100000000,
      description: "Timestamp when this was uploaded to Convex",
    }),
  })
  .openapi("ScreenshotCollectorRelease");

const NotFoundSchema = z
  .object({
    code: z.literal(404).openapi({ example: 404 }),
    message: z.string().openapi({
      example: "No active screenshot collector release found",
    }),
  })
  .openapi("NotFound");

export const screenshotCollectorRouter = new OpenAPIHono();

/**
 * Get the latest screenshot collector release for the specified environment.
 * The environment is determined by the CMUX_IS_STAGING environment variable:
 * - staging (CMUX_IS_STAGING=true): Used by cmux-internal-dev-agent
 * - production (CMUX_IS_STAGING=false): Used by cmux-agent
 */
screenshotCollectorRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/screenshot-collector/latest",
    tags: ["Internal"],
    summary: "Get the latest screenshot collector release",
    description:
      "Returns the latest screenshot collector bundle for the current environment (staging or production based on CMUX_IS_STAGING)",
    responses: {
      200: {
        content: {
          "application/json": {
            schema: ScreenshotCollectorReleaseSchema,
          },
        },
        description: "Latest screenshot collector release",
      },
      404: {
        content: {
          "application/json": {
            schema: NotFoundSchema,
          },
        },
        description: "No active release found for this environment",
      },
    },
  }),
  async (c) => {
    // Determine if we're in staging mode from environment
    const isStaging = process.env.CMUX_IS_STAGING === "true";

    // Create a simple Convex client for this internal query (no auth needed)
    const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

    const release = await convex.query(
      api.screenshotCollector.getLatestRelease,
      { isStaging }
    );

    if (!release) {
      return c.json(
        {
          code: 404 as const,
          message: `No active screenshot collector release found for ${isStaging ? "staging" : "production"}`,
        },
        404
      );
    }

    return c.json(
      {
        version: release.version,
        downloadUrl: release.downloadUrl ?? "",
        sha256: release.sha256,
        size: release.size,
        commitSha: release.commitSha,
        uploadedAt: release.uploadedAt,
      },
      200
    );
  }
);
