import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { stackServerAppJs } from "../utils/stack";
import {
  getConvexHttpActionBaseUrl,
  startCodeReviewJob,
} from "../services/code-review/start-code-review";
import {
  parseModelConfigFromUrlSearchParams,
  parseTooltipLanguageFromUrlSearchParams,
} from "../services/code-review/model-config";
import { runSimpleAnthropicReviewStream } from "../services/code-review/run-simple-anthropic-review";
import { getUserFromRequest } from "../utils/auth";

const CODE_REVIEW_STATES = ["pending", "running", "completed", "failed"] as const;
const JSON_CONTENT_TYPE = "application/json";

const isJsonContentType = (
  contentType: string | null | undefined,
): boolean =>
  typeof contentType === "string" &&
  contentType.toLowerCase().includes(JSON_CONTENT_TYPE);

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

const FileDiffSchema = z.object({
  filePath: z.string(),
  diffText: z.string(),
});

const SimpleReviewBodySchema = z
  .object({
    fileDiffs: z.array(FileDiffSchema).min(1),
    diffLabel: z.string().optional(),
  })
  .openapi("CodeReviewSimpleBody");

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
    /** Pre-fetched diffs from the client to avoid re-fetching from GitHub API */
    fileDiffs: z.array(FileDiffSchema).optional(),
    /** Model selection for heatmap review (e.g., "anthropic-opus-4-5", "cmux-heatmap-2") */
    heatmapModel: z.string().optional(),
    /** Language for tooltip text (e.g., "en", "zh-Hant", "ja") */
    tooltipLanguage: z.string().optional(),
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
        fileDiffs: body.fileDiffs,
        heatmapModel: body.heatmapModel,
        tooltipLanguage: body.tooltipLanguage,
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

codeReviewRouter.post("/code-review/simple", async (c) => {
  const user = await getUserFromRequest(c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const { accessToken } = await user.getAuthJson();
  if (!accessToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!isJsonContentType(c.req.header("content-type"))) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }

  let parsedBody: unknown;
  try {
    parsedBody = await c.req.json();
  } catch (error) {
    console.error("[simple-review][api] Failed to parse request body", error);
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodyResult = SimpleReviewBodySchema.safeParse(parsedBody);
  if (!bodyResult.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const body = bodyResult.data;
  const searchParams = new URL(c.req.raw.url).searchParams;
  const modelConfig = parseModelConfigFromUrlSearchParams(searchParams);
  const tooltipLanguage = parseTooltipLanguageFromUrlSearchParams(searchParams);
  const diffLabel =
    typeof body.diffLabel === "string" && body.diffLabel.trim().length > 0
      ? body.diffLabel.trim()
      : "cmux-diff-review";

  console.info("[simple-review][api] Diff review request", {
    diffLabel,
    fileCount: body.fileDiffs.length,
    model: searchParams.get("model") ?? "default",
    tooltipLanguage,
  });

  return streamSSE(c, async (stream) => {
    let isClosed = false;

    const enqueue = async (payload: unknown) => {
      if (isClosed) {
        return;
      }
      try {
        await stream.writeSSE({
          data: JSON.stringify(payload),
        });
      } catch (error) {
        console.error("[simple-review][api] Failed to write SSE payload", error);
        isClosed = true;
      }
    };

    await enqueue({ type: "status", message: "starting" });

    try {
      await runSimpleAnthropicReviewStream({
        prIdentifier: diffLabel,
        fileDiffs: body.fileDiffs,
        modelConfig,
        tooltipLanguage,
        signal: c.req.raw.signal,
        onEvent: async (event) => {
          switch (event.type) {
            case "file":
              await enqueue({
                type: "file",
                filePath: event.filePath,
              });
              break;
            case "skip":
              await enqueue({
                type: "skip",
                filePath: event.filePath,
                reason: event.reason,
              });
              break;
            case "hunk":
              await enqueue({
                type: "hunk",
                filePath: event.filePath,
                header: event.header,
              });
              break;
            case "file-complete":
              await enqueue({
                type: "file-complete",
                filePath: event.filePath,
                status: event.status,
                summary: event.summary,
              });
              break;
            case "line":
              await enqueue({
                type: "line",
                filePath: event.filePath,
                changeType: event.line.changeType,
                diffLine: event.line.diffLine,
                codeLine: event.line.codeLine,
                mostImportantWord: event.line.mostImportantWord,
                shouldReviewWhy: event.line.shouldReviewWhy,
                score: event.line.score,
                scoreNormalized: event.line.scoreNormalized,
                oldLineNumber: event.line.oldLineNumber,
                newLineNumber: event.line.newLineNumber,
                line: event.line,
              });
              break;
            default:
              break;
          }
        },
      });

      await enqueue({ type: "complete" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const isAbortError =
        message.includes("Stream aborted") || message.includes("aborted");
      if (isAbortError) {
        console.info("[simple-review][api] Stream aborted by client", {
          diffLabel,
        });
      } else {
        console.error("[simple-review][api] Stream failed", {
          diffLabel,
          message,
          error,
        });
      }
      await enqueue({ type: "error", message });
    } finally {
      if (!isClosed) {
        isClosed = true;
        stream.close();
      }
    }
  });
});
