import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { detectFrameworkAndPackageManager, type PackageManager } from "@/lib/github/framework-detection";
import { stackServerApp } from "@/lib/utils/stack";

export const githubFrameworkDetectionRouter = new OpenAPIHono();

const Query = z
  .object({
    repo: z.string().min(1).openapi({ description: "Full repository name (owner/repo)" }),
  })
  .openapi("GithubFrameworkDetectionQuery");

const FrameworkPreset = z.enum([
  "other",
  "next",
  "vite",
  "remix",
  "nuxt",
  "sveltekit",
  "angular",
  "cra",
  "vue",
]).openapi("FrameworkPreset");

const PackageManagerSchema = z.enum(["npm", "yarn", "pnpm", "bun"]).openapi("PackageManager");

const FrameworkDetectionResponse = z
  .object({
    framework: FrameworkPreset,
    packageManager: PackageManagerSchema,
    maintenanceScript: z.string(),
    devScript: z.string(),
  })
  .openapi("FrameworkDetectionResponse");

githubFrameworkDetectionRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/framework-detection",
    tags: ["Integrations"],
    summary: "Detect framework and package manager for a GitHub repository",
    request: { query: Query },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: FrameworkDetectionResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { repo } = c.req.valid("query");

    // Get GitHub access token from user's connected account
    let githubAccessToken: string | undefined;
    try {
      const user = await stackServerApp.getUser({ tokenStore: c.req.raw });
      if (user) {
        const githubAccount = await user.getConnectedAccount("github");
        if (githubAccount) {
          const tokenResult = await githubAccount.getAccessToken();
          if (tokenResult.accessToken) {
            githubAccessToken = tokenResult.accessToken;
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch GitHub access token", error);
    }

    const result = await detectFrameworkAndPackageManager(repo, githubAccessToken);

    return c.json({
      framework: result.framework,
      packageManager: result.packageManager as PackageManager,
      maintenanceScript: result.maintenanceScript,
      devScript: result.devScript,
    });
  }
);
