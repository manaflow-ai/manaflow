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
    repo: z
      .string()
      .min(1)
      .openapi({ description: "Repository full name (owner/repo)" }),
    search: z
      .string()
      .trim()
      .optional()
      .openapi({ description: "Optional search term to filter branches by name" }),
    cursor: z
      .string()
      .optional()
      .openapi({ description: "Pagination cursor to continue listing branches" }),
    limit: z.coerce
      .number()
      .min(1)
      .max(100)
      .default(30)
      .optional()
      .openapi({ description: "Max branches to return (default 30, max 100)" }),
  })
  .openapi("GithubBranchesQuery");

const BranchesPageInfo = z
  .object({
    endCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  })
  .openapi("GithubBranchesPageInfo");

const BranchesResponse = z
  .object({
    branches: z.array(GithubBranch),
    defaultBranch: z.string().nullable(),
    pageInfo: BranchesPageInfo,
    error: z.string().nullable(),
  })
  .openapi("GithubBranchesResponse");

const BRANCHES_GRAPHQL_QUERY = `
  query Branches($owner: String!, $repo: String!, $after: String, $perPage: Int!) {
    repository(owner: $owner, name: $repo) {
      defaultBranchRef {
        name
      }
      refs(
        refPrefix: "refs/heads/"
        first: $perPage
        after: $after
        orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
      ) {
        edges {
          cursor
          node {
            name
            target {
              __typename
              ... on Commit {
                oid
              }
              ... on Tag {
                target {
                  __typename
                  ... on Commit {
                    oid
                  }
                }
              }
            }
          }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  }
`;

type BranchTarget = {
  __typename: string;
  oid?: string;
  target?: { __typename: string; oid?: string } | null;
};

type BranchEdge = {
  cursor: string;
  node: {
    name: string;
    target: BranchTarget | null;
  };
};

type BranchRefs = {
  edges: BranchEdge[];
  pageInfo: { endCursor: string | null; hasNextPage: boolean };
};

type BranchesGraphqlResponse = {
  repository: {
    defaultBranchRef: { name: string } | null;
    refs: BranchRefs | null;
  } | null;
};

const resolveCommitSha = (
  target: BranchTarget | null | undefined
): string | undefined => {
  if (!target) return undefined;
  if (target.__typename === "Commit" && target.oid) return target.oid;
  if (target.__typename === "Tag") {
    const tagTarget = target.target;
    if (tagTarget?.__typename === "Commit" && tagTarget.oid) {
      return tagTarget.oid;
    }
  }
  return undefined;
};

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

    const { repo, search, limit = 30, cursor } = c.req.valid("query");

    try {
      const githubAccount = await user.getConnectedAccount("github");
      if (!githubAccount) {
        return c.json(
          {
            branches: [],
            defaultBranch: null,
            pageInfo: { endCursor: null, hasNextPage: false },
            error: "GitHub account not connected",
          },
          200
        );
      }

      const { accessToken } = await githubAccount.getAccessToken();
      if (!accessToken || accessToken.trim().length === 0) {
        return c.json(
          {
            branches: [],
            defaultBranch: null,
            pageInfo: { endCursor: null, hasNextPage: false },
            error: "GitHub access token not found",
          },
          200
        );
      }

      const octokit = new Octokit({ auth: accessToken.trim() });
      const [owner, repoName] = repo.split("/");

      if (!owner || !repoName) {
        return c.json(
          {
            branches: [],
            defaultBranch: null,
            pageInfo: { endCursor: null, hasNextPage: false },
            error: "Invalid repository format",
          },
          200
        );
      }

      const perPage = Math.min(100, Math.max(1, limit));
      const normalizedSearch = search?.trim().toLowerCase();
      const branches: Array<z.infer<typeof GithubBranch>> = [];
      let defaultBranchName: string | null = null;
      let endCursor: string | null = null;
      let hasNextPage = false;

      const fetchPage = async (after: string | null) => {
        return octokit.graphql<BranchesGraphqlResponse>(BRANCHES_GRAPHQL_QUERY, {
          owner,
          repo: repoName,
          after,
          perPage,
        });
      };

      if (!normalizedSearch) {
        const data = await fetchPage(cursor ?? null);
        const repoData = data.repository;
        defaultBranchName = repoData?.defaultBranchRef?.name ?? null;
        const refs = repoData?.refs;
        if (refs) {
          for (const edge of refs.edges) {
            const name = edge.node.name;
            branches.push({
              name,
              lastCommitSha: resolveCommitSha(edge.node.target),
              isDefault: name === defaultBranchName,
            });
          }
          endCursor = refs.pageInfo.endCursor;
          hasNextPage = refs.pageInfo.hasNextPage;
        }
      } else {
        let pageCursor = cursor ?? null;

        while (branches.length < limit) {
          const data = await fetchPage(pageCursor);
          const repoData = data.repository;
          if (!defaultBranchName) {
            defaultBranchName = repoData?.defaultBranchRef?.name ?? null;
          }
          const refs = repoData?.refs;
          if (!refs || refs.edges.length === 0) {
            endCursor = refs?.pageInfo.endCursor ?? endCursor;
            hasNextPage = false;
            break;
          }

          let reachedLimit = false;
          for (const edge of refs.edges) {
            pageCursor = edge.cursor;
            endCursor = edge.cursor;
            if (edge.node.name.toLowerCase().includes(normalizedSearch)) {
              branches.push({
                name: edge.node.name,
                lastCommitSha: resolveCommitSha(edge.node.target),
                isDefault: edge.node.name === defaultBranchName,
              });
              if (branches.length >= limit) {
                reachedLimit = true;
                break;
              }
            }
          }

          if (reachedLimit) {
            const stoppedEarly = endCursor !== refs.pageInfo.endCursor;
            hasNextPage = stoppedEarly || refs.pageInfo.hasNextPage;
            break;
          }

          if (!refs.pageInfo.hasNextPage) {
            endCursor = refs.pageInfo.endCursor ?? endCursor;
            hasNextPage = false;
            break;
          }

          const nextCursor = refs.pageInfo.endCursor;
          if (!nextCursor) {
            hasNextPage = false;
            break;
          }
          pageCursor = nextCursor;
          endCursor = nextCursor;
        }
      }

      return c.json(
        {
          branches,
          defaultBranch: defaultBranchName,
          pageInfo: { endCursor, hasNextPage },
          error: null,
        },
        200
      );
    } catch (error) {
      console.error("[github.branches] Error fetching branches:", error);
      return c.json({
        branches: [],
        defaultBranch: null,
        pageInfo: { endCursor: null, hasNextPage: false },
        error: error instanceof Error ? error.message : "Failed to fetch branches",
      }, 200);
    }
  }
);
