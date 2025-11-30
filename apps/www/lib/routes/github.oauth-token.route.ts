import { stackServerAppJs } from "@/lib/utils/stack";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

export const githubOAuthTokenRouter = new OpenAPIHono();

const GithubOAuthTokenResponse = z
  .object({
    accessToken: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("GithubOAuthTokenResponse");

githubOAuthTokenRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/oauth-token",
    tags: ["Integrations"],
    summary: "Get the current user's GitHub OAuth access token",
    responses: {
      200: {
        description: "GitHub OAuth token response",
        content: {
          "application/json": {
            schema: GithubOAuthTokenResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.text("Unauthorized", 401);
    }

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({ accessToken: null, error: "GitHub account not connected" }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({ accessToken: null, error: "GitHub access token not found" }, 200);
      }

      return c.json({ accessToken: accessToken.trim(), error: null }, 200);
    } catch (error) {
      console.error("[github.oauth-token] Error getting GitHub token:", error);
      return c.json({
        accessToken: null,
        error: error instanceof Error ? error.message : "Failed to get GitHub token",
      }, 200);
    }
  }
);
