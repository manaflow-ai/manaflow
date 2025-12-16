import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { stackServerAppJs } from "../utils/stack";
import {
  getConvexHttpActionBaseUrl,
  startCodeReviewJob,
} from "../services/code-review/start-code-review";

const CODE_REVIEW_STATES = ["pending", "running", "completed", "failed"] as const;

const CodeReviewJobSchema = z.object({
  jobId: z.string(),
  teamId: z.string().nullable(),
  repoFullName: z.string(),
  repoUrl: z.string(),
  prNumber: z.number().nullable(),
  commitRef: z.string(),
  headCommitRef: z.string(),
  baseCommitRef: z.string().nullable(),
  jobType: z.enum(["pull_request", "comparison"]),
  comparisonSlug: z.string().nullable(),
  comparisonBaseOwner: z.string().nullable(),
  comparisonBaseRef: z.string().nullable(),
  comparisonHeadOwner: z.string().nullable(),
  comparisonHeadRef: z.string().nullable(),
  requestedByUserId: z.string(),
  state: z.enum(CODE_REVIEW_STATES),
  createdAt: z.number(),
  updatedAt: z.number(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  sandboxInstanceId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  codeReviewOutput: z.record(z.string(), z.any()).nullable(),
});

const StartBodySchema = z
  .object({
    teamSlugOrId: z.string().optional(),
    githubLink: z.string().url(),
    prNumber: z.number().int().positive().optional(),
    commitRef: z.string().optional(),
    headCommitRef: z.string().optional(),
    baseCommitRef: z.string().optional(),
    force: z.boolean().optional(),
    comparison: z
      .object({
        slug: z.string(),
        base: z.object({
          owner: z.string(),
          repo: z.string(),
          ref: z.string(),
          label: z.string(),
        }),
        head: z.object({
          owner: z.string(),
          repo: z.string(),
          ref: z.string(),
          label: z.string(),
        }),
      })
      .optional(),
  })
  .openapi("CodeReviewStartBody");

const StartResponseSchema = z
  .object({
    job: CodeReviewJobSchema,
    deduplicated: z.boolean(),
  })
  .openapi("CodeReviewStartResponse");

type CodeReviewStartBody = z.infer<typeof StartBodySchema>;

export const codeReviewRouter = new OpenAPIHono();

codeReviewRouter.openapi(
  createRoute({
    method: "post",
    path: "/code-review/start",
    tags: ["Code Review"],
    summary: "Start an automated code review for a pull request",
    request: {
      body: {
        content: {
          "application/json": {
            schema: StartBodySchema,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: StartResponseSchema,
          },
        },
        description: "Job created or reused",
      },
      401: { description: "Unauthorized" },
      500: { description: "Failed to start code review" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const [{ accessToken }, githubAccount] = await Promise.all([
      user.getAuthJson(),
      user.getConnectedAccount("github"),
    ]);
    if (!accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!githubAccount) {
      return c.json({ error: "GitHub account is not connected" }, 401);
    }
    const { accessToken: githubAccessToken } =
      await githubAccount.getAccessToken();
    if (!githubAccessToken) {
      return c.json({ error: "GitHub access token unavailable" }, 401);
    }

    const body = c.req.valid("json") as CodeReviewStartBody;
    const convexHttpBase = getConvexHttpActionBaseUrl();
    if (!convexHttpBase) {
      return c.json({ error: "Convex HTTP base URL is not configured" }, 500);
    }
    if (!body.prNumber && !body.comparison) {
      return c.json(
        { error: "Either prNumber or comparison metadata is required" },
        400,
      );
    }
    const jobType = body.comparison ? "comparison" : "pull_request";
    const headCommitProvided = Boolean(body.headCommitRef ?? body.commitRef);
    if (!headCommitProvided) {
      return c.json(
        { error: "headCommitRef is required to start a code review run" },
        400,
      );
    }
    if (jobType === "pull_request" && !body.baseCommitRef) {
      return c.json(
        { error: "baseCommitRef is required when starting a pull request review" },
        400,
      );
    }
    if (jobType === "comparison" && !body.baseCommitRef) {
      return c.json(
        { error: "baseCommitRef is required when starting a comparison review" },
        400,
      );
    }

    const { job, deduplicated, backgroundTask } = await startCodeReviewJob({
      accessToken,
      githubAccessToken,
      callbackBaseUrl: convexHttpBase,
      payload: {
        teamSlugOrId: body.teamSlugOrId,
        githubLink: body.githubLink,
        prNumber: body.prNumber,
        commitRef: body.commitRef,
        headCommitRef: body.headCommitRef,
        baseCommitRef: body.baseCommitRef,
        force: body.force,
        comparison: body.comparison
          ? {
              slug: body.comparison.slug,
              base: body.comparison.base,
              head: body.comparison.head,
            }
          : undefined,
      },
      request: c.req.raw,
    });

    if (backgroundTask) {
      void backgroundTask;
    }

    return c.json(
      {
        job,
        deduplicated,
      },
      200,
    );
  },
);
