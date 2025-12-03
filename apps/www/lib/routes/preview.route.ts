import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { stackServerAppJs } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";
import { typedZid } from "@cmux/shared/utils/typed-zid";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Octokit } from "octokit";

export const previewRouter = new OpenAPIHono();

const PreviewConfigSchema = z
  .object({
    id: z.string(),
    repoFullName: z.string(),
    environmentId: z.string().optional().nullable(),
    repoInstallationId: z.number(),
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
    repoInstallationId: z.number(),
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
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
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
    repoInstallationId: config.repoInstallationId,
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

// Test PR creation endpoint
const CreateTestPRBody = z
  .object({
    teamSlugOrId: z.string(),
    previewConfigId: z.string(),
    repoFullName: z.string(),
    baseBranch: z.string().optional(),
  })
  .openapi("CreateTestPRBody");

const CreateTestPRResponse = z
  .object({
    success: z.boolean(),
    prUrl: z.string().optional(),
    prNumber: z.number().optional(),
    error: z.string().optional(),
  })
  .openapi("CreateTestPRResponse");

previewRouter.openapi(
  createRoute({
    method: "post",
    path: "/preview/test-pr",
    tags: ["Preview"],
    summary: "Create a test PR to verify preview configuration",
    request: {
      body: {
        content: {
          "application/json": {
            schema: CreateTestPRBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Test PR created",
        content: {
          "application/json": {
            schema: CreateTestPRResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
      500: { description: "Internal server error" },
    },
  }),
  async (c) => {
    const user = await stackServerAppJs.getUser({ tokenStore: c.req.raw });
    if (!user) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    const [{ accessToken }, githubAccount] = await Promise.all([
      user.getAuthJson(),
      user.getConnectedAccount("github"),
    ]);

    if (!accessToken) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }

    if (!githubAccount) {
      return c.json(
        { success: false, error: "GitHub account is not connected" },
        401,
      );
    }

    const { accessToken: githubAccessToken } = await githubAccount.getAccessToken();
    if (!githubAccessToken) {
      return c.json(
        { success: false, error: "GitHub access token unavailable" },
        401,
      );
    }

    const body = c.req.valid("json");
    const { teamSlugOrId, repoFullName, baseBranch = "main" } = body;

    await verifyTeamAccess({ req: c.req.raw, teamSlugOrId });

    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) {
      return c.json(
        { success: false, error: "Invalid repository name" },
        400,
      );
    }

    const octokit = new Octokit({
      auth: githubAccessToken,
      request: { timeout: 30_000 },
    });

    try {
      // Get the SHA of the base branch
      const { data: baseBranchData } = await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: baseBranch,
      });
      const baseSha = baseBranchData.commit.sha;

      // Create a unique branch name
      const timestamp = Date.now();
      const testBranchName = `cmux-test-preview-${timestamp}`;

      // Create the test branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${testBranchName}`,
        sha: baseSha,
      });

      // Create a test HTML page in public/ so it's accessible as a page
      const testFileName = "public/cmux-test-preview.html";
      const testFileContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Preview Test - cmux</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      background: #0a0a0f;
      padding: 48px 24px;
      color: #fff;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 48px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 9999px;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    h1 {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    .subtitle {
      font-size: 16px;
      color: #71717a;
      line-height: 1.5;
    }
    .card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 16px;
    }
    .check-list {
      list-style: none;
    }
    .check-list li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      font-size: 14px;
      color: #a1a1aa;
    }
    .check-list li:last-child {
      border-bottom: none;
    }
    .check-icon {
      width: 20px;
      height: 20px;
      background: rgba(16, 185, 129, 0.15);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .check-icon svg {
      width: 12px;
      height: 12px;
      color: #10b981;
    }
    .check-text strong {
      color: #fff;
      font-weight: 500;
    }
    .promo-card {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.02) 100%);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }
    .promo-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .promo-label {
      font-size: 12px;
      color: #71717a;
    }
    .promo-logo {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
    }
    .promo-logo span {
      color: #10b981;
    }
    .promo-text {
      font-size: 14px;
      color: #a1a1aa;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .promo-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #fff;
      color: #000;
    }
    .btn-primary:hover {
      background: #e4e4e7;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .btn svg {
      width: 16px;
      height: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">Test Successful</span>
      <h1>Preview Environment Verified</h1>
      <p class="subtitle">Your cmux preview configuration is working correctly. This page was automatically generated to verify the setup.</p>
    </div>

    <div class="card">
      <div class="card-title">What was tested</div>
      <ul class="check-list">
        <li>
          <div class="check-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="check-text"><strong>GitHub webhook received</strong> - PR events are being sent to cmux</div>
        </li>
        <li>
          <div class="check-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="check-text"><strong>Dev server started</strong> - Your application is running in the preview environment</div>
        </li>
        <li>
          <div class="check-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div class="check-text"><strong>Screenshot captured</strong> - The agent can browse and screenshot your UI</div>
        </li>
      </ul>
    </div>

    <div class="card promo-card">
      <div class="promo-header">
        <span class="promo-label">From the creators of</span>
        <span class="promo-logo">c<span>mux</span>.dev</span>
      </div>
      <p class="promo-text">Get AI-powered screenshot previews for every pull request. cmux boots your dev server, captures screenshots of UI changes, and posts them directly to your PR.</p>
      <div class="promo-buttons">
        <a href="https://github.com/manaflow-ai/cmux" class="btn btn-secondary" target="_blank">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          Star on GitHub
        </a>
        <a href="https://cmux.dev" class="btn btn-primary" target="_blank">
          Explore cmux
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </a>
      </div>
    </div>
  </div>
</body>
</html>
`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: testFileName,
        message: "test: add cmux preview test page",
        content: Buffer.from(testFileContent).toString("base64"),
        branch: testBranchName,
      });

      // Create the pull request
      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: "Test cmux Preview Configuration",
        head: testBranchName,
        base: baseBranch,
        body: `## Test Preview Configuration

This PR was automatically created by cmux to test your preview configuration.

### What this PR adds

A test HTML page at \`public/cmux-test-preview.html\` that will be accessible at \`/cmux-test-preview.html\` in your preview environment.

### What to expect

A preview environment will be created for this PR. This typically takes **2-5 minutes**.

Once complete, you'll see a comment on this PR with a screenshot of the test page and a link to the preview environment.

### After testing

- If the preview works correctly, you can close this PR
- The test branch \`${testBranchName}\` will be automatically deleted when the PR is closed

---

*Created by [cmux](https://cmux.sh)*
`,
        draft: false,
      });

      return c.json({
        success: true,
        prUrl: pr.html_url,
        prNumber: pr.number,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to create test PR:", error);
      return c.json(
        { success: false, error: message },
        500,
      );
    }
  },
);
