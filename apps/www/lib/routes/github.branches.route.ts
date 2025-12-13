import { stackServerAppJs } from "@/lib/utils/stack";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Octokit } from "octokit";

export const githubBranchesRouter = new OpenAPIHono();

// Schema for branch data
const GithubBranch = z
  .object({
    name: z.string(),
    lastCommitSha: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .openapi("GithubBranch");

// --- Default Branch Endpoint (fast - single API call) ---

const DefaultBranchQuery = z
  .object({
    repo: z.string().min(1).openapi({ description: "Repository full name (owner/repo)" }),
  })
  .openapi("GithubDefaultBranchQuery");

const DefaultBranchResponse = z
  .object({
    defaultBranch: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("GithubDefaultBranchResponse");

githubBranchesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/default-branch",
    tags: ["Integrations"],
    summary: "Get the default branch for a repository (fast - single API call)",
    request: { query: DefaultBranchQuery },
    responses: {
      200: {
        description: "Default branch response",
        content: {
          "application/json": {
            schema: DefaultBranchResponse,
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

    const { repo } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({ defaultBranch: null, error: "GitHub account not connected" }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({ defaultBranch: null, error: "GitHub access token not found" }, 200);
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");

      const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
        owner: owner!,
        repo: repoName!,
      });

      return c.json({ defaultBranch: data.default_branch, error: null }, 200);
    } catch (error) {
      console.error("[github.branches] Error getting default branch:", error);
      return c.json({
        defaultBranch: null,
        error: error instanceof Error ? error.message : "Failed to get default branch",
      }, 200);
    }
  }
);

// --- Branches List Endpoint (with optional search) ---

const BranchesQuery = z
  .object({
    repo: z.string().min(1).openapi({ description: "Repository full name (owner/repo)" }),
    search: z
      .string()
      .trim()
      .optional()
      .openapi({ description: "Optional search term to filter branches by name" }),
    limit: z.coerce
      .number()
      .min(1)
      .max(100)
      .default(30)
      .optional()
      .openapi({ description: "Max branches to return (default 30, max 100)" }),
  })
  .openapi("GithubBranchesQuery");

const BranchesResponse = z
  .object({
    branches: z.array(GithubBranch),
    defaultBranch: z.string().nullable(),
    error: z.string().nullable(),
  })
  .openapi("GithubBranchesResponse");

githubBranchesRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/branches",
    tags: ["Integrations"],
    summary: "List branches for a repository with optional search filter",
    request: { query: BranchesQuery },
    responses: {
      200: {
        description: "Branches list response",
        content: {
          "application/json": {
            schema: BranchesResponse,
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

    const { repo, search, limit = 30 } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json({ branches: [], defaultBranch: null, error: "GitHub account not connected" }, 200);
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json({ branches: [], defaultBranch: null, error: "GitHub access token not found" }, 200);
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");

      // Get repo info for default branch
      let defaultBranchName: string | null = null;
      try {
        const { data: repoData } = await octokit.request("GET /repos/{owner}/{repo}", {
          owner: owner!,
          repo: repoName!,
        });
        defaultBranchName = repoData.default_branch;
      } catch {
        // Ignore - we'll continue without default branch info
      }

      type BranchResp = { name: string; commit: { sha: string } };
      const branches: Array<z.infer<typeof GithubBranch>> = [];

      if (!search) {
        // No search - just get first page of branches
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/branches", {
          owner: owner!,
          repo: repoName!,
          per_page: limit,
        }) as { data: BranchResp[] };

        for (const br of data) {
          branches.push({
            name: br.name,
            lastCommitSha: br.commit.sha,
            isDefault: br.name === defaultBranchName,
          });
        }
      } else {
        // With search - fetch pages until we find enough matches
        const searchLower = search.toLowerCase();
        let page = 1;
        const perPage = 100;

        while (branches.length < limit) {
          const { data } = await octokit.request("GET /repos/{owner}/{repo}/branches", {
            owner: owner!,
            repo: repoName!,
            per_page: perPage,
            page,
          }) as { data: BranchResp[] };

          if (data.length === 0) break;

          for (const br of data) {
            if (br.name.toLowerCase().includes(searchLower)) {
              branches.push({
                name: br.name,
                lastCommitSha: br.commit.sha,
                isDefault: br.name === defaultBranchName,
              });
              if (branches.length >= limit) break;
            }
          }

          if (data.length < perPage) break;
          page++;
        }
      }

      return c.json({ branches, defaultBranch: defaultBranchName, error: null }, 200);
    } catch (error) {
      console.error("[github.branches] Error fetching branches:", error);
      return c.json({
        branches: [],
        defaultBranch: null,
        error: error instanceof Error ? error.message : "Failed to fetch branches",
      }, 200);
    }
  }
);
