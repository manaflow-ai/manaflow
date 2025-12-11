import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import type { DiffStatus, ReplaceDiffEntry } from "@cmux/shared";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { getConvex } from "../utils/get-convex";
import { githubPrivateKey } from "../utils/githubPrivateKey";

export const githubCompareRouter = new OpenAPIHono();

// Schema for diff entry (matches ReplaceDiffEntry from @cmux/shared)
const DiffEntrySchema = z
  .object({
    filePath: z.string(),
    oldPath: z.string().optional(),
    status: z.enum(["added", "modified", "deleted", "renamed"]),
    additions: z.number(),
    deletions: z.number(),
    patch: z.string().optional(),
    oldContent: z.string().optional(),
    newContent: z.string().optional(),
    isBinary: z.boolean(),
    contentOmitted: z.boolean().optional(),
    oldSize: z.number().optional(),
    newSize: z.number().optional(),
    patchSize: z.number().optional(),
  })
  .openapi("GithubCompareDiffEntry");

// --- Compare Endpoint ---

const CompareQuery = z
  .object({
    team: z.string().min(1).openapi({ description: "Team slug or UUID" }),
    owner: z.string().min(1).openapi({ description: "GitHub owner/org" }),
    repo: z.string().min(1).openapi({ description: "GitHub repo name" }),
    base: z.string().min(1).openapi({ description: "Base ref (branch, tag, or commit SHA)" }),
    head: z.string().min(1).openapi({ description: "Head ref (branch, tag, or commit SHA)" }),
    includeContents: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((v) => v === "true")
      .openapi({ description: "Whether to include file contents (slower)" }),
    maxBytes: z.coerce
      .number()
      .min(1)
      .max(10_000_000)
      .optional()
      .default(1_000_000)
      .openapi({ description: "Max bytes per file content (default 1MB)" }),
    maxFiles: z.coerce
      .number()
      .min(1)
      .max(3000)
      .optional()
      .default(300)
      .openapi({ description: "Max files to return (default 300, max 3000)" }),
  })
  .openapi("GithubCompareQuery");

const CompareResponse = z
  .object({
    diffs: z.array(DiffEntrySchema),
    baseSha: z.string().optional(),
    headSha: z.string().optional(),
    aheadBy: z.number().optional(),
    behindBy: z.number().optional(),
    totalCommits: z.number().optional(),
    error: z.string().nullable(),
  })
  .openapi("GithubCompareResponse");

githubCompareRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/compare",
    tags: ["Integrations"],
    summary: "Compare two refs and get diff entries (replaces socket git-diff for web mode)",
    request: { query: CompareQuery },
    responses: {
      200: {
        description: "Comparison result with diff entries",
        content: {
          "application/json": {
            schema: CompareResponse,
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "Repository or installation not found" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, owner, repo, base, head, includeContents, maxBytes, maxFiles } =
      c.req.valid("query");

    try {
      const convex = getConvex({ accessToken });
      const connections = await convex.query(api.github.listProviderConnections, {
        teamSlugOrId: team,
      });

      type Conn = {
        installationId: number;
        accountLogin?: string | null;
        isActive?: boolean | null;
      };

      const target = (connections as Conn[]).find(
        (co) =>
          (co.isActive ?? true) &&
          (co.accountLogin ?? "").toLowerCase() === owner.toLowerCase()
      );

      if (!target) {
        return c.text("Installation not found for owner", 404);
      }

      const octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: env.CMUX_GITHUB_APP_ID,
          privateKey: githubPrivateKey,
          installationId: target.installationId,
        },
      });

      // Get comparison between base and head
      const compareRes = await octokit.request(
        "GET /repos/{owner}/{repo}/compare/{basehead}",
        {
          owner,
          repo,
          basehead: `${base}...${head}`,
          per_page: Math.min(maxFiles, 100), // GitHub API max per page is 100
        }
      );

      const comparison = compareRes.data as {
        base_commit?: { sha?: string };
        merge_base_commit?: { sha?: string };
        ahead_by?: number;
        behind_by?: number;
        total_commits?: number;
        files?: Array<{
          filename: string;
          previous_filename?: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
          patch?: string;
        }>;
        commits?: Array<{ sha?: string }>;
      };

      // If we need more files, paginate
      let allFiles = comparison.files ?? [];
      if (allFiles.length >= 100 && allFiles.length < maxFiles) {
        // GitHub compare API doesn't support pagination directly for files,
        // but we can use the PR files endpoint pattern if needed
        // For now, we'll work with what we have
      }

      // Limit to maxFiles
      allFiles = allFiles.slice(0, maxFiles);

      // Map GitHub status to our DiffStatus
      const mapStatus = (ghStatus: string): DiffStatus => {
        switch (ghStatus) {
          case "added":
            return "added";
          case "removed":
            return "deleted";
          case "renamed":
            return "renamed";
          case "modified":
          case "changed":
          default:
            return "modified";
        }
      };

      // Check if a file appears to be binary based on patch
      const isBinaryFile = (patch?: string): boolean => {
        // If there's no patch and it's not a new empty file, it's likely binary
        if (!patch) return true;
        // Check for binary marker
        if (patch.includes("Binary files")) return true;
        return false;
      };

      const diffs: ReplaceDiffEntry[] = [];

      // Get the head SHA from commits array if available
      const headSha =
        comparison.commits && comparison.commits.length > 0
          ? comparison.commits[comparison.commits.length - 1]?.sha
          : undefined;
      const baseSha = comparison.base_commit?.sha ?? comparison.merge_base_commit?.sha;

      for (const file of allFiles) {
        const status = mapStatus(file.status);
        const hasPatch = Boolean(file.patch);
        const binary = !hasPatch && file.additions === 0 && file.deletions === 0;

        const entry: ReplaceDiffEntry = {
          filePath: file.filename,
          oldPath: file.previous_filename,
          status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          isBinary: binary || isBinaryFile(file.patch),
          patchSize: file.patch?.length,
        };

        // Fetch file contents if requested
        if (includeContents && !entry.isBinary) {
          try {
            // Fetch new content (head)
            if (status !== "deleted") {
              const headContent = await fetchFileContent(
                octokit,
                owner,
                repo,
                file.filename,
                head,
                maxBytes
              );
              if (headContent) {
                entry.newContent = headContent.content;
                entry.newSize = headContent.size;
                if (headContent.truncated) {
                  entry.contentOmitted = true;
                }
              }
            }

            // Fetch old content (base)
            if (status !== "added") {
              const oldPath = file.previous_filename ?? file.filename;
              const baseContent = await fetchFileContent(
                octokit,
                owner,
                repo,
                oldPath,
                base,
                maxBytes
              );
              if (baseContent) {
                entry.oldContent = baseContent.content;
                entry.oldSize = baseContent.size;
                if (baseContent.truncated) {
                  entry.contentOmitted = true;
                }
              }
            }
          } catch (err) {
            console.error(
              `[github.compare] Error fetching contents for ${file.filename}:`,
              err
            );
            entry.contentOmitted = true;
          }
        }

        diffs.push(entry);
      }

      return c.json({
        diffs,
        baseSha,
        headSha,
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        totalCommits: comparison.total_commits,
        error: null,
      });
    } catch (error) {
      console.error("[github.compare] Error comparing refs:", error);
      return c.json(
        {
          diffs: [],
          error: error instanceof Error ? error.message : "Failed to compare refs",
        },
        200
      );
    }
  }
);

async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  maxBytes: number
): Promise<{ content: string; size: number; truncated: boolean } | null> {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path,
      ref,
    });

    const data = res.data as {
      type?: string;
      size?: number;
      encoding?: string;
      content?: string;
    };

    if (data.type !== "file") {
      return null;
    }

    const size = data.size ?? 0;
    if (size > maxBytes) {
      return { content: "", size, truncated: true };
    }

    if (data.encoding === "base64" && data.content) {
      // Decode base64 content
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      return { content: decoded, size, truncated: false };
    }

    return null;
  } catch {
    return null;
  }
}
