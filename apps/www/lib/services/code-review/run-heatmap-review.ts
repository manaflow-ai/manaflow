import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import {
  CLOUDFLARE_ANTHROPIC_BASE_URL,
  CLOUDFLARE_OPENAI_BASE_URL,
} from "@cmux/shared";
import { getConvex } from "@/lib/utils/get-convex";
import {
  collectPrDiffs,
  collectComparisonDiffs,
  mapWithConcurrency,
} from "@/scripts/pr-review-heatmap";
import { formatUnifiedDiffWithLineNumbers } from "@/scripts/pr-review/diff-utils";
import type { ModelConfig } from "./run-simple-anthropic-review";
import { getDefaultHeatmapModelConfig } from "./model-config";
import {
  buildHeatmapPrompt,
  heatmapSchema,
  type HeatmapLine,
} from "./heatmap-shared";

interface HeatmapComparisonConfig {
  owner: string;
  repo: string;
  base: string;
  head: string;
}

interface FileDiff {
  filePath: string;
  diffText: string;
}

interface HeatmapReviewConfig {
  jobId: string;
  teamId?: string;
  prUrl: string;
  prNumber?: number;
  accessToken: string;
  callbackToken: string;
  githubAccessToken?: string | null;
  modelConfig?: ModelConfig;
  tooltipLanguage?: string;
  /** If provided, use branch comparison instead of PR diff */
  comparison?: HeatmapComparisonConfig;
  /** Pre-fetched diffs from the client to avoid re-fetching from GitHub API */
  fileDiffs?: FileDiff[];
}

// Placeholder sandbox ID for heatmap strategy (no Morph VM used)
const HEATMAP_SANDBOX_ID = "heatmap-no-vm";

/**
 * Run PR review using the heatmap strategy without Morph.
 * This calls OpenAI API directly and processes the PR via GitHub API.
 * Results are streamed file-by-file to Convex.
 */
export async function runHeatmapReview(
  config: HeatmapReviewConfig
): Promise<void> {
  console.info("[heatmap-review] Starting heatmap review (no Morph)", {
    jobId: config.jobId,
    prUrl: config.prUrl,
  });

  // Determine the effective model configuration (defaults to Anthropic Opus 4.5)
  const effectiveModelConfig: ModelConfig =
    config.modelConfig ?? getDefaultHeatmapModelConfig();

  // Validate API keys based on provider
  const openAiApiKey = process.env.OPENAI_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (effectiveModelConfig.provider === "openai" && !openAiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required for OpenAI models");
  }
  if (effectiveModelConfig.provider === "anthropic" && !anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required for Anthropic models");
  }

  const convex = getConvex({ accessToken: config.accessToken });
  const jobStart = Date.now();

  try {
    // Fetch diffs - either from pre-fetched client data, PR, or branch comparison
    let fileDiffs: { filePath: string; diffText: string }[];
    let reviewMetadata: {
      type: "pr" | "comparison";
      url: string;
      repo: string;
      title: string | null;
      prNumber?: number;
      baseRef: string;
      headRef: string;
    };

    // Use pre-fetched diffs if available (no GitHub API call needed)
    if (config.fileDiffs && config.fileDiffs.length > 0) {
      console.info("[heatmap-review] Using pre-fetched diffs from client", {
        jobId: config.jobId,
        fileCount: config.fileDiffs.length,
      });

      fileDiffs = config.fileDiffs;

      // Build review metadata from config (comparison or PR mode)
      if (config.comparison) {
        reviewMetadata = {
          type: "comparison",
          url: `https://github.com/${config.comparison.owner}/${config.comparison.repo}/compare/${config.comparison.base}...${config.comparison.head}`,
          repo: `${config.comparison.owner}/${config.comparison.repo}`,
          title: `${config.comparison.base}...${config.comparison.head}`,
          baseRef: config.comparison.base,
          headRef: config.comparison.head,
        };
      } else {
        // PR mode with pre-fetched diffs
        const prUrlMatch = config.prUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
        const [, owner, repo] = prUrlMatch ?? [];
        reviewMetadata = {
          type: "pr",
          url: config.prUrl,
          repo: owner && repo ? `${owner}/${repo}` : config.prUrl,
          title: null,
          prNumber: config.prNumber,
          baseRef: "unknown",
          headRef: "unknown",
        };
      }
    } else {
      // Fall back to fetching diffs from GitHub API
      const githubToken =
        config.githubAccessToken ??
        process.env.GITHUB_TOKEN ??
        process.env.GH_TOKEN ??
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN ??
        null;
      if (!githubToken) {
        throw new Error(
          "GitHub access token is required to run the heatmap review strategy (no pre-fetched diffs provided)."
        );
      }

      if (config.comparison) {
        // Branch comparison mode - use GitHub Compare API
        console.info("[heatmap-review] Fetching branch comparison diffs from GitHub", {
          jobId: config.jobId,
          owner: config.comparison.owner,
          repo: config.comparison.repo,
          base: config.comparison.base,
          head: config.comparison.head,
        });

        const { metadata, fileDiffs: comparisonDiffs } = await collectComparisonDiffs({
          owner: config.comparison.owner,
          repo: config.comparison.repo,
          base: config.comparison.base,
          head: config.comparison.head,
          includePaths: [],
          maxFiles: null,
          githubToken,
        });

        fileDiffs = comparisonDiffs;
        reviewMetadata = {
          type: "comparison",
          url: metadata.compareUrl,
          repo: `${metadata.owner}/${metadata.repo}`,
          title: `${metadata.baseRef}...${metadata.headRef}`,
          baseRef: metadata.baseRef,
          headRef: metadata.headRef,
        };

        console.info("[heatmap-review] Comparison metadata", {
          jobId: config.jobId,
          aheadBy: metadata.aheadBy,
          behindBy: metadata.behindBy,
          totalCommits: metadata.totalCommits,
          fileCount: fileDiffs.length,
        });
      } else {
        // PR mode - use PR API
        console.info("[heatmap-review] Fetching PR diffs from GitHub", {
          jobId: config.jobId,
          prUrl: config.prUrl,
        });

        const { metadata, fileDiffs: prDiffs } = await collectPrDiffs({
          prIdentifier: config.prUrl,
          includePaths: [],
          maxFiles: null,
          githubToken,
        });

        fileDiffs = prDiffs;
        reviewMetadata = {
          type: "pr",
          url: metadata.prUrl,
          repo: `${metadata.owner}/${metadata.repo}`,
          title: metadata.title,
          prNumber: metadata.number,
          baseRef: metadata.baseRefName,
          headRef: metadata.headRefName,
        };
      }
    }

    // Sort files alphabetically by path
    const sortedFiles = [...fileDiffs].sort((a, b) =>
      a.filePath.localeCompare(b.filePath)
    );

    console.info("[heatmap-review] Processing files with heatmap strategy", {
      jobId: config.jobId,
      fileCount: sortedFiles.length,
      provider: effectiveModelConfig.provider,
      model: effectiveModelConfig.model,
    });

    // Create provider clients
    const anthropic = createAnthropic({
      apiKey: anthropicApiKey ?? "",
      baseURL: CLOUDFLARE_ANTHROPIC_BASE_URL,
    });
    const openai = createOpenAI({
      apiKey: openAiApiKey ?? "",
      baseURL: CLOUDFLARE_OPENAI_BASE_URL,
    });

    // Create the model instance based on provider
    const modelInstance =
      effectiveModelConfig.provider === "anthropic"
        ? anthropic(effectiveModelConfig.model)
        : openai(effectiveModelConfig.model);

    console.info("[heatmap-review] Using model", {
      jobId: config.jobId,
      provider: effectiveModelConfig.provider,
      model: effectiveModelConfig.model,
    });

    const allResults: Array<{ filePath: string; lines: HeatmapLine[] }> = [];
    const failures: Array<{ filePath: string; message: string }> = [];

    // Process files concurrently
    const CONCURRENCY = 10; // Reasonable concurrency for API calls
    const settled = await mapWithConcurrency(
      sortedFiles,
      CONCURRENCY,
      async (file, index) => {
        console.info(
          `[heatmap-review] [${index + 1}/${sortedFiles.length}] Processing ${file.filePath}...`
        );

        const formattedDiff = formatUnifiedDiffWithLineNumbers(file.diffText, {
          showLineNumbers: false,
          includeContextLineNumbers: false,
        });
        const prompt = buildHeatmapPrompt(file.filePath, formattedDiff);
        const streamStart = Date.now();
        const stream = streamObject({
          model: modelInstance,
          schema: heatmapSchema,
          prompt,
          temperature: 0,
          maxRetries: 2,
        });

        // Consume the stream without verbose logging
        for await (const _chunk of stream.fullStream) {
          // Stream is consumed to completion
        }

        const result = await stream.object;
        const durationMs = Date.now() - streamStart;
        const finalLineCount = result.lines.length;
        const fileResult = {
          filePath: file.filePath,
          lines: result.lines,
        };

        console.info(
          `[heatmap-review] [${index + 1}/${sortedFiles.length}] ✓ ${file.filePath}: ${finalLineCount} lines analyzed in ${Math.round(durationMs)}ms`
        );

        // Store file output in Convex immediately
        await convex.mutation(api.codeReview.upsertFileOutputFromCallback, {
          jobId: config.jobId as Id<"automatedCodeReviewJobs">,
          callbackToken: config.callbackToken,
          filePath: file.filePath,
          codexReviewOutput: fileResult,
          sandboxInstanceId: HEATMAP_SANDBOX_ID,
          tooltipLanguage: config.tooltipLanguage,
        });

        console.info(
          `[heatmap-review] File output stored for ${file.filePath} (${finalLineCount} lines)`
        );

        return fileResult;
      }
    );

    // Separate successes from failures
    for (const result of settled) {
      if (result.status === "fulfilled") {
        allResults.push(result.value);
      } else {
        const error = result.reason;
        const message =
          error instanceof Error
            ? error.message
            : String(error ?? "Unknown error");
        const filePath = "<unknown>";
        console.error(`[heatmap-review] ✗ ${filePath}: ${message}`);
        failures.push({ filePath, message });
      }
    }

    console.info("[heatmap-review] All files processed", {
      jobId: config.jobId,
      successes: allResults.length,
      failures: failures.length,
    });

    // Build final code review output
    const codeReviewOutput = {
      strategy: "heatmap",
      reviewType: reviewMetadata.type,
      pr: reviewMetadata.type === "pr"
        ? {
            url: reviewMetadata.url,
            number: reviewMetadata.prNumber,
            repo: reviewMetadata.repo,
            title: reviewMetadata.title,
          }
        : undefined,
      comparison: reviewMetadata.type === "comparison"
        ? {
            url: reviewMetadata.url,
            repo: reviewMetadata.repo,
            baseRef: reviewMetadata.baseRef,
            headRef: reviewMetadata.headRef,
          }
        : undefined,
      files: allResults,
      failures,
    };

    // Mark job as completed in Convex
    await convex.mutation(api.codeReview.completeJobFromCallback, {
      jobId: config.jobId as Id<"automatedCodeReviewJobs">,
      callbackToken: config.callbackToken,
      sandboxInstanceId: HEATMAP_SANDBOX_ID,
      codeReviewOutput,
    });

    console.info("[heatmap-review] Job marked as completed", {
      jobId: config.jobId,
    });

    console.info("[heatmap-review] Review completed", {
      jobId: config.jobId,
      durationMs: Date.now() - jobStart,
      successes: allResults.length,
      failures: failures.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[heatmap-review] Review failed", {
      jobId: config.jobId,
      error: message,
      durationMs: Date.now() - jobStart,
    });

    // Mark job as failed in Convex
    try {
      await convex.mutation(api.codeReview.failJobFromCallback, {
        jobId: config.jobId as Id<"automatedCodeReviewJobs">,
        callbackToken: config.callbackToken,
        sandboxInstanceId: HEATMAP_SANDBOX_ID,
        errorCode: "heatmap_review_failed",
        errorDetail: message,
      });
    } catch (cleanupError) {
      console.error(
        "[heatmap-review] Failed to mark job as failed",
        cleanupError
      );
    }

    throw error;
  }
}
