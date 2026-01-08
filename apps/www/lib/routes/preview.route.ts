import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { fetchPullRequest } from "@/lib/github/fetch-pull-request";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number
 */
function parsePrUrl(prUrl: string): {
  owner: string;
  repo: string;
  prNumber: number;
  repoFullName: string;
} | null {
  const match = prUrl.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i
  );
  if (!match) {
    return null;
  }
  const [, owner, repo, prNumberStr] = match;
  if (!owner || !repo || !prNumberStr) {
    return null;
  }
  return {
    owner,
    repo,
    prNumber: parseInt(prNumberStr, 10),
    repoFullName: `${owner}/${repo}`.toLowerCase(),
  };
}

export const previewRouter = new OpenAPIHono();

const PreviewConfigSchema = z
  .object({
    id: z.string(),
    repoFullName: z.string(),
    environmentId: z.string().optional().nullable(),
    repoInstallationId: z.number().optional().nullable(),
    repoDefaultBranch: z.string().optional().nullable(),
    status: z.enum(["active", "paused", "disabled"]),
    lastRunAt: z.number().optional().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .openapi("PreviewConfig");

const PreviewConfigListResponse = z
  .object({
    configs: z.array(PreviewConfigSchema),
  })
  .openapi("PreviewConfigListResponse");

const PreviewConfigMutationBody = z
  .object({
    previewConfigId: z.string().optional(),
    teamSlugOrId: z.string(),
    repoFullName: z.string(),
    environmentId: z.string().optional(),
    repoInstallationId: z.number().optional(),
    repoDefaultBranch: z.string().optional(),
    status: z.enum(["active", "paused", "disabled"]).optional(),
  })
  .openapi("PreviewConfigMutationBody");

const PreviewRunSchema = z
  .object({
    id: z.string(),
    prNumber: z.number(),
    prUrl: z.string(),
    headSha: z.string(),
    baseSha: z.string().optional().nullable(),
    status: z.enum(["pending", "running", "completed", "failed", "skipped", "superseded"]),
    createdAt: z.number(),
    updatedAt: z.number(),
    dispatchedAt: z.number().optional().nullable(),
    startedAt: z.number().optional().nullable(),
    completedAt: z.number().optional().nullable(),
  })
  .openapi("PreviewRun");

const PreviewRunsResponse = z
  .object({
    runs: z.array(PreviewRunSchema),
  })
  .openapi("PreviewRunsResponse");

type PreviewConfigDoc = Doc<"previewConfigs">;
type PreviewRunDoc = Doc<"previewRuns">;

function formatPreviewConfig(config: PreviewConfigDoc) {
  return {
    id: config._id,
    repoFullName: config.repoFullName,
    environmentId: config.environmentId ?? null,
    repoInstallationId: config.repoInstallationId ?? null,
    repoDefaultBranch: config.repoDefaultBranch ?? null,
    status: config.status ?? "active",
    lastRunAt: config.lastRunAt ?? null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  } satisfies z.infer<typeof PreviewConfigSchema>;
}

function formatPreviewRun(run: PreviewRunDoc) {
  return {
    id: run._id,
    prNumber: run.prNumber,
    prUrl: run.prUrl,
    headSha: run.headSha,
    baseSha: run.baseSha ?? null,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    dispatchedAt: run.dispatchedAt ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
  } satisfies z.infer<typeof PreviewRunSchema>;
}

const ListQuery = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("PreviewConfigsQuery");

previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/configs",
    tags: ["Preview"],
    summary: "List preview configurations for a team",
    request: {
      query: ListQuery,
    },
    responses: {
      200: {
        description: "Configurations fetched",
        content: {
          "application/json": {
            schema: PreviewConfigListResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    const configs = await convex.query(api.previewConfigs.listByTeam, {
      teamSlugOrId: query.teamSlugOrId,
    });
    return c.json({ configs: configs.map(formatPreviewConfig) });
  },
);

previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/configs",
    tags: ["Preview"],
    summary: "Create or update a preview configuration",
    request: {
      body: {
        content: {
          "application/json": {
            schema: PreviewConfigMutationBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Configuration saved",
        content: {
          "application/json": {
            schema: PreviewConfigSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const body = c.req.valid("json");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: body.teamSlugOrId });
    const convex = getConvex({ accessToken });

    const previewConfigId = await convex.mutation(api.previewConfigs.upsert, {
      teamSlugOrId: body.teamSlugOrId,
      repoFullName: body.repoFullName,
      environmentId: body.environmentId
        ? typedZid("environments").parse(body.environmentId)
        : undefined,
      repoInstallationId: body.repoInstallationId,
      repoDefaultBranch: body.repoDefaultBranch,
      status: body.status,
    });

    const saved = await convex.query(api.previewConfigs.get, {
      teamSlugOrId: body.teamSlugOrId,
      previewConfigId,
    });
    if (!saved) {
      throw new HTTPException(500, { message: "Failed to load saved configuration" });
    }
    return c.json(formatPreviewConfig(saved));
  },
);

previewRouter.openapi(
  createRoute({
    method: "delete",
    path: "/preview/configs/{previewConfigId}",
    tags: ["Preview"],
    summary: "Delete a preview configuration",
    request: {
      params: z.object({ previewConfigId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Deleted",
        content: {
          "application/json": {
            schema: z.object({ id: z.string() }),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    try {
      const result = await convex.mutation(api.previewConfigs.remove, {
        teamSlugOrId: query.teamSlugOrId,
        previewConfigId: typedZid("previewConfigs").parse(params.previewConfigId),
      });
      return c.json(result);
    } catch (error) {
      console.error("Failed to delete preview config", error);
      return c.text("Not found", 404);
    }
  },
);

previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/configs/{previewConfigId}/runs",
    tags: ["Preview"],
    summary: "List recent preview runs for a configuration",
    request: {
      params: z.object({ previewConfigId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
        limit: z.coerce.number().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: {
        description: "Runs fetched",
        content: {
          "application/json": {
            schema: PreviewRunsResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });
    const runs = await convex.query(api.previewRuns.listByConfig, {
      teamSlugOrId: query.teamSlugOrId,
      previewConfigId: typedZid("previewConfigs").parse(params.previewConfigId),
      limit: query.limit,
    });
    return c.json({ runs: runs.map(formatPreviewRun) });
  },
);

// ============================================================================
// Preview Test Jobs - for testing preview.new without GitHub integration
// ============================================================================

const PreviewTestImageSchema = z.object({
  storageId: z.string(),
  mimeType: z.string(),
  fileName: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  url: z.string().optional().nullable(),
});

const PreviewTestScreenshotSetSchema = z.object({
  _id: z.string(),
  status: z.enum(["completed", "failed", "skipped"]),
  hasUiChanges: z.boolean().optional().nullable(),
  capturedAt: z.number(),
  error: z.string().optional().nullable(),
  images: z.array(PreviewTestImageSchema),
});

const PreviewTestRunSchema = z.object({
  _id: z.string(),
  prNumber: z.number(),
  prUrl: z.string(),
  prTitle: z.string().optional().nullable(),
  repoFullName: z.string(),
  headSha: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  stateReason: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  taskRunId: z.string().optional().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  dispatchedAt: z.number().optional().nullable(),
  startedAt: z.number().optional().nullable(),
  completedAt: z.number().optional().nullable(),
  configRepoFullName: z.string().optional().nullable(),
  screenshotSet: PreviewTestScreenshotSetSchema.optional().nullable(),
});

const PreviewTestRunDetailSchema = PreviewTestRunSchema.extend({
  prDescription: z.string().optional().nullable(),
  baseSha: z.string().optional().nullable(),
  headRef: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  environmentId: z.string().optional().nullable(),
});

// Check if team has GitHub access to a repository (for a given PR URL)
previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/test/check-access",
    tags: ["Preview Test"],
    summary: "Check if team has GitHub access to the repository in a PR URL",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
        prUrl: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Access check result",
        content: {
          "application/json": {
            schema: z.object({
              hasAccess: z.boolean(),
              hasConfig: z.boolean(),
              hasActiveInstallation: z.boolean(),
              repoFullName: z.string().nullable(),
              errorCode: z
                .enum([
                  "invalid_url",
                  "no_config",
                  "no_installation",
                  "installation_inactive",
                ])
                .nullable(),
              errorMessage: z.string().nullable(),
              suggestedAction: z.string().nullable(),
            }),
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    const result = await convex.query(api.previewTestJobs.checkRepoAccess, {
      teamSlugOrId: query.teamSlugOrId,
      prUrl: query.prUrl,
    });
    return c.json(result);
  },
);

// Create a test preview job from PR URL
previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/test/jobs",
    tags: ["Preview Test"],
    summary: "Create a test preview job from a PR URL (fetches real PR data from GitHub)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              teamSlugOrId: z.string(),
              prUrl: z.string().url(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Test job created (task/taskRun will be created after VM starts)",
        content: {
          "application/json": {
            schema: z.object({
              previewRunId: z.string(),
              prNumber: z.number(),
              repoFullName: z.string(),
            }),
          },
        },
      },
      400: { description: "Invalid PR URL" },
      401: { description: "Unauthorized" },
      404: { description: "Preview config not found or PR not found on GitHub" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const body = c.req.valid("json");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: body.teamSlugOrId });
    const convex = getConvex({ accessToken });

    // Parse PR URL to get owner/repo/prNumber
    const parsed = parsePrUrl(body.prUrl);
    if (!parsed) {
      return c.json({ error: "Invalid PR URL format. Expected: https://github.com/owner/repo/pull/123" }, 400);
    }

    // Fetch real PR data from GitHub
    let prData: {
      headSha: string;
      baseSha: string | undefined;
      prTitle: string;
      prDescription: string | undefined;
      headRef: string | undefined;
      headRepoFullName: string | undefined;
      headRepoCloneUrl: string | undefined;
    };

    try {
      const ghPr = await fetchPullRequest(parsed.owner, parsed.repo, parsed.prNumber);
      prData = {
        headSha: ghPr.head.sha,
        baseSha: ghPr.base?.sha,
        prTitle: ghPr.title,
        prDescription: ghPr.body ?? undefined,
        headRef: ghPr.head.ref,
        headRepoFullName: ghPr.head.repo?.full_name,
        headRepoCloneUrl: ghPr.head.repo?.clone_url,
      };
    } catch (error) {
      console.error("[preview-test] Failed to fetch PR from GitHub:", error);
      return c.json({
        error: `Failed to fetch PR #${parsed.prNumber} from GitHub. Make sure the PR exists and is accessible.`
      }, 404);
    }

    try {
      const result = await convex.mutation(api.previewTestJobs.createTestRun, {
        teamSlugOrId: body.teamSlugOrId,
        prUrl: body.prUrl,
        // Pass the real PR metadata
        prMetadata: {
          headSha: prData.headSha,
          baseSha: prData.baseSha,
          prTitle: prData.prTitle,
          prDescription: prData.prDescription,
          headRef: prData.headRef,
          headRepoFullName: prData.headRepoFullName,
          headRepoCloneUrl: prData.headRepoCloneUrl,
        },
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("Invalid PR URL")) {
          return c.json({ error: error.message }, 400);
        }
        if (error.message.includes("No preview configuration")) {
          return c.json({ error: error.message }, 404);
        }
      }
      throw error;
    }
  },
);

// Dispatch (start) a test preview job
previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/test/jobs/{previewRunId}/dispatch",
    tags: ["Preview Test"],
    summary: "Start a test preview job (trigger screenshot capture)",
    request: {
      params: z.object({ previewRunId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Job dispatched",
        content: {
          "application/json": {
            schema: z.object({ dispatched: z.boolean() }),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Preview run not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    try {
      const result = await convex.action(api.previewTestJobs.dispatchTestJob, {
        teamSlugOrId: query.teamSlugOrId,
        previewRunId: typedZid("previewRuns").parse(params.previewRunId),
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  },
);

// List test preview jobs
previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/test/jobs",
    tags: ["Preview Test"],
    summary: "List test preview jobs for a team",
    request: {
      query: z.object({
        teamSlugOrId: z.string(),
        limit: z.coerce.number().min(1).max(100).optional(),
      }),
    },
    responses: {
      200: {
        description: "Test jobs listed",
        content: {
          "application/json": {
            schema: z.object({
              jobs: z.array(PreviewTestRunSchema),
            }),
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    const jobs = await convex.query(api.previewTestJobs.listTestRuns, {
      teamSlugOrId: query.teamSlugOrId,
      limit: query.limit,
    });
    return c.json({ jobs });
  },
);

// Get test preview job details
previewRouter.openapi(
  createRoute({
    method: "get",
    path: "/preview/test/jobs/{previewRunId}",
    tags: ["Preview Test"],
    summary: "Get detailed info about a test preview job",
    request: {
      params: z.object({ previewRunId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Test job details",
        content: {
          "application/json": {
            schema: PreviewTestRunDetailSchema,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Preview run not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    try {
      const job = await convex.query(api.previewTestJobs.getTestRunDetails, {
        teamSlugOrId: query.teamSlugOrId,
        previewRunId: typedZid("previewRuns").parse(params.previewRunId),
      });
      return c.json(job);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  },
);

// Retry a failed test preview job
previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/test/jobs/{previewRunId}/retry",
    tags: ["Preview Test"],
    summary: "Retry a failed test preview job (creates new run and dispatches)",
    request: {
      params: z.object({ previewRunId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "New job created and dispatched",
        content: {
          "application/json": {
            schema: z.object({
              newPreviewRunId: z.string(),
              dispatched: z.boolean(),
            }),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Preview run not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    try {
      const result = await convex.action(api.previewTestJobs.retryTestJob, {
        teamSlugOrId: query.teamSlugOrId,
        previewRunId: typedZid("previewRuns").parse(params.previewRunId),
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  },
);

// Delete a test preview job
previewRouter.openapi(
  createRoute({
    method: "delete",
    path: "/preview/test/jobs/{previewRunId}",
    tags: ["Preview Test"],
    summary: "Delete a test preview job",
    request: {
      params: z.object({ previewRunId: z.string() }),
      query: z.object({
        teamSlugOrId: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Test job deleted",
        content: {
          "application/json": {
            schema: z.object({ deleted: z.boolean() }),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Preview run not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) {
      return c.text("Unauthorized", 401);
    }

    const params = c.req.valid("param");
    const query = c.req.valid("query");
    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId: query.teamSlugOrId });
    const convex = getConvex({ accessToken });

    try {
      const result = await convex.mutation(api.previewTestJobs.deleteTestRun, {
        teamSlugOrId: query.teamSlugOrId,
        previewRunId: typedZid("previewRuns").parse(params.previewRunId),
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  },
);
