import { createOpenAI } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { CLOUDFLARE_OPENAI_BASE_URL } from "@cmux/shared";
import { getConvex } from "@/lib/utils/get-convex";
import {
  collectPrDiffs,
  mapWithConcurrency,
} from "@/scripts/pr-review-heatmap";
import { formatUnifiedDiffWithLineNumbers } from "@/scripts/pr-review/diff-utils";
import type { ModelConfig } from "./run-simple-anthropic-review";
import { getDefaultHeatmapModelConfig } from "./model-config";
import {
  buildHeatmapPrompt,
  heatmapSchema,
  summarizeHeatmapStreamChunk,
  type HeatmapLine,
} from "./heatmap-shared";

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

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  const convex = getConvex({ accessToken: config.accessToken });
  const jobStart = Date.now();

  try {
    // Fetch PR diffs via GitHub API
    console.info("[heatmap-review] Fetching PR diffs from GitHub", {
      jobId: config.jobId,
      prUrl: config.prUrl,
    });

    const githubToken =
      config.githubAccessToken ??
      process.env.GITHUB_TOKEN ??
      process.env.GH_TOKEN ??
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN ??
      null;
    if (!githubToken) {
      throw new Error(
        "GitHub access token is required to run the heatmap review strategy."
      );
    }

    const { metadata, fileDiffs } = await collectPrDiffs({
      prIdentifier: config.prUrl,
      includePaths: [],
      maxFiles: null,
      githubToken,
    });

    // Sort files alphabetically by path
    const sortedFiles = [...fileDiffs].sort((a, b) =>
      a.filePath.localeCompare(b.filePath)
    );

    console.info("[heatmap-review] Processing files with heatmap strategy", {
      jobId: config.jobId,
      fileCount: sortedFiles.length,
    });

    const openai = createOpenAI({
      apiKey: openAiApiKey,
      baseURL: CLOUDFLARE_OPENAI_BASE_URL,
    });
    const defaultModelConfig = getDefaultHeatmapModelConfig();
    const selectedModel = (() => {
      const resolvedConfig = config.modelConfig ?? defaultModelConfig;
      if (resolvedConfig.provider !== "openai") {
        console.warn(
          "[heatmap-review] Ignoring unsupported model provider override",
          {
            provider: resolvedConfig.provider,
            jobId: config.jobId,
          }
        );
        return defaultModelConfig.model;
      }
      if (config.modelConfig) {
        console.info("[heatmap-review] Using OpenAI model override", {
          jobId: config.jobId,
          model: resolvedConfig.model,
        });
      }
      return resolvedConfig.model;
    })();
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
          model: openai(selectedModel),
          schema: heatmapSchema,
          prompt,
          temperature: 0,
          maxRetries: 2,
        });

        let lastLineCount = 0;
        let reasoningStarted = false;

        for await (const chunk of stream.fullStream) {
          const { lineCount, textDelta } = summarizeHeatmapStreamChunk(chunk);

          if (lineCount !== null && lineCount > lastLineCount) {
            lastLineCount = lineCount;
            console.info(
              `[heatmap-review] [${index + 1}/${sortedFiles.length}] ${file.filePath}: ${lastLineCount} lines generated so far`
            );
          }

          if (textDelta) {
            if (!reasoningStarted) {
              reasoningStarted = true;
              console.info(
                `[heatmap-review] [${index + 1}/${sortedFiles.length}] ${file.filePath}: reasoning stream started`
              );
            }
            const collapsed = textDelta.replace(/\s+/g, " ").trim();
            if (collapsed.length > 0) {
              const snippet =
                collapsed.length > 200
                  ? `${collapsed.slice(0, 197)}...`
                  : collapsed;
              console.info(
                `[heatmap-review] [${index + 1}/${sortedFiles.length}] ${file.filePath}: reasoning chunk "${snippet}"`
              );
            }
          }
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
      pr: {
        url: metadata.prUrl,
        number: metadata.number,
        repo: `${metadata.owner}/${metadata.repo}`,
        title: metadata.title,
      },
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
