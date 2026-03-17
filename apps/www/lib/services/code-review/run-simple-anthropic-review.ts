import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import {
  CLOUDFLARE_OPENAI_BASE_URL,
  BEDROCK_AWS_REGION,
} from "@cmux/shared";
import { collectPrDiffs, collectPrDiffsViaGhCli } from "@/scripts/pr-review-heatmap";
import { env } from "@/lib/utils/www-env";
import {
  SimpleReviewParser,
  type SimpleReviewParsedEvent,
} from "./simple-review-parser";
import {
  generateGitHubInstallationToken,
  getInstallationForRepo,
} from "@/lib/utils/github-app-token";
import { checkRepoVisibility } from "@/lib/github/check-repo-visibility";
import {
  getDefaultHeatmapModelConfig,
  DEFAULT_TOOLTIP_LANGUAGE,
  type TooltipLanguageValue,
} from "./model-config";

const SIMPLE_REVIEW_INSTRUCTIONS = `Dannotate every modified/deleted/added line of this diff with a "fake" comment at the end of each line.

For each line, you should add a comment at the end like so:
# "<mostImportantWord>" "<comment>" "<score 0-100>"

Goal is to build a heatmap to guide me through a code review, like where i should focus my eyes on.
So not necessarily where the mistakes are but which parts of the code might require more investigation
So we need to highlight non-clean code, hacky code, suspicious code, duplicated functions, etc, stuff like that.
Anything that feels like it might be off or might warrant a comment should have a high score, even if it's technically correct.
shouldReviewWhy should be a concise (4-10 words) hint on why the reviewer should maybe review this line of code, but it shouldn't state obvious things, instead It should only be a hint for the reviewer as to what exactly you meant when you flagged it.
In most cases, the reason should follow a template like "<X> <verb> <Y>" (eg. "line is too long" or "code accesses sensitive data").
It should be understandable by a human and make sense (break the "X is Y" rule if it helps you make it more understandable).
mostImportantWord must always be provided and should identify the most critical word or identifier in the line. If you're unsure, pick the earliest relevant word or token.
Ugly code should be given a higher score.
Code that may be hard to read for a human should also be given a higher score.
Non-clean code too. Type casts, type assertions, type guards, "any" types, untyped bodies to "fetch" etc. should be given a higher score.
If a line is perfectly normal, you should give it a score of 0.
Only add comments for lines that are modified/deleted/added.

DO NOT BE LAZY DO THE ENTIRE FILE. FROM START TO FINISH. DO NOT BE LAZY.`;

const SIMPLE_REVIEW_GUIDANCE = `You must respond strictly with the diff provided, keeping every line (including context) in the original order.
- Do NOT wrap the response in code fences.
- Do NOT rewrite the code or summarize; only annotate the diff lines that already exist.
- Append the inline comment in the instructed format to the end of each modified/added/removed line.
- Maintain git diff prefixes (+, -, or space) exactly as provided.
- Process the diff from top to bottom without skipping sections.`;

const MAX_CONCURRENCY = 10;

const BINARY_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".rar",
  ".7z",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".wav",
  ".flac",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".psd",
  ".ai",
];

const LOCKFILE_SUFFIXES = [
  "/package-lock.json",
  "/yarn.lock",
  "/pnpm-lock.yaml",
  "/bun.lock",
  "/composer.lock",
  "/cargo.lock",
  "/podfile.lock",
  "/gemfile.lock",
  "/poetry.lock",
  "/pipfile.lock",
  "/gradle.lockfile",
  "/go.sum",
  ".lock",
];

const SKIPPED_PATH_SEGMENTS = [
  "node_modules/",
  "vendor/",
  "third_party/",
  "__pycache__/",
];

type FileDiff = {
  filePath: string;
  diffText: string;
};

type CollectPrDiffsResult = Awaited<ReturnType<typeof collectPrDiffs>>;

type RepoSlug = {
  owner: string;
  repo: string;
};

export type ModelConfig = {
  provider: "anthropic" | "openai";
  model: string;
};

export type SimpleReviewStreamOptions = {
  prIdentifier: string;
  githubToken?: string | null;
  modelConfig?: ModelConfig;
  tooltipLanguage?: TooltipLanguageValue;
  fileDiffs?: FileDiff[];
  onChunk?: (chunk: string) => void | Promise<void>;
  onEvent?: (event: SimpleReviewParsedEvent) => void | Promise<void>;
  signal?: AbortSignal;
};

export type SimpleReviewStreamResult = {
  diffCharacterCount: number;
  finalText: string;
};

function parseRepoSlug(prIdentifier: string): RepoSlug | null {
  try {
    const url = new URL(prIdentifier);
    const pathnameParts = url.pathname.split("/").filter(Boolean);

    if (url.hostname === "api.github.com" && pathnameParts.length >= 4) {
      const owner = pathnameParts[1];
      const repo = pathnameParts[2];
      if (owner && repo) {
        return { owner, repo };
      }
      return null;
    }

    if (url.hostname.endsWith("github.com") && pathnameParts.length >= 2) {
      const owner = pathnameParts[0];
      const repo = pathnameParts[1];
      if (owner && repo) {
        return { owner, repo };
      }
      return null;
    }
  } catch {
    // Not a URL, fall through to pattern checks.
  }

  const hashMatch = prIdentifier.match(/^([\w.-]+)\/([\w.-]+)#\d+$/i);
  if (hashMatch) {
    return { owner: hashMatch[1], repo: hashMatch[2] };
  }

  const apiMatch = prIdentifier.match(
    /repos\/([\w.-]+)\/([\w.-]+)\/pulls\/\d+/i
  );
  if (apiMatch) {
    return { owner: apiMatch[1], repo: apiMatch[2] };
  }

  return null;
}

async function collectDiffsWithFallback({
  prIdentifier,
  githubToken,
}: {
  prIdentifier: string;
  githubToken: string | null;
}): Promise<{
  metadata: CollectPrDiffsResult["metadata"];
  fileDiffs: CollectPrDiffsResult["fileDiffs"];
}> {
  const normalizedToken =
    typeof githubToken === "string" && githubToken.trim().length > 0
      ? githubToken.trim()
      : null;

  const slug = parseRepoSlug(prIdentifier);

  // For repos without explicit token, check visibility to determine auth strategy
  if (!normalizedToken && slug) {
    const visibility = await checkRepoVisibility(slug.owner, slug.repo);
    console.info(
      "[simple-review] Repo visibility check",
      { owner: slug.owner, repo: slug.repo, visibility }
    );

    // For public repos, use rotating tokens
    if (visibility === "public") {
      console.info(
        "[simple-review] Public repo, using rotating tokens",
        { owner: slug.owner, repo: slug.repo }
      );

      try {
        return await collectPrDiffs({
          prIdentifier,
          includePaths: [],
          maxFiles: null,
          githubToken: undefined, // Use rotating tokens
        });
      } catch (error) {
        // Unexpected error for public repo
        console.error(
          "[simple-review] Unexpected error fetching public repo",
          { owner: slug.owner, repo: slug.repo, error }
        );
        throw error;
      }
    }

    // For private/unknown repos, try GitHub App first
    console.info(
      "[simple-review] Private/unknown repo, trying GitHub App",
      { owner: slug.owner, repo: slug.repo }
    );

    try {
      const installationId = await getInstallationForRepo(
        `${slug.owner}/${slug.repo}`
      );
      if (installationId) {
        console.info(
          "[simple-review] Using GitHub App token",
          { owner: slug.owner, repo: slug.repo, installationId }
        );

        const appToken = await generateGitHubInstallationToken({
          installationId,
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "read",
          },
        });

        return await collectPrDiffs({
          prIdentifier,
          includePaths: [],
          maxFiles: null,
          githubToken: appToken,
        });
      }
    } catch (error) {
      console.warn(
        "[simple-review] GitHub App check/fetch failed, will try gh CLI",
        { owner: slug.owner, repo: slug.repo, error: error instanceof Error ? error.message : String(error) }
      );
    }

    // Fall back to gh CLI for private repos without GitHub App
    console.info(
      "[simple-review] Using gh CLI for private repo",
      { owner: slug.owner, repo: slug.repo }
    );

    return await collectPrDiffsViaGhCli(prIdentifier, [], null);
  }

  // For repos with explicit token, use that token
  try {
    return await collectPrDiffs({
      prIdentifier,
      includePaths: [],
      maxFiles: null,
      githubToken: normalizedToken ?? undefined,
    });
  } catch (error) {
    throw error;
  }
}

export async function runSimpleAnthropicReviewStream(
  options: SimpleReviewStreamOptions
): Promise<SimpleReviewStreamResult> {
  const {
    prIdentifier,
    githubToken: providedGithubToken = null,
    modelConfig,
    tooltipLanguage = DEFAULT_TOOLTIP_LANGUAGE,
    fileDiffs: providedFileDiffs,
    onChunk,
    signal,
  } = options;
  const onEvent = options.onEvent ?? null;

  const emitEvent = async (event: SimpleReviewParsedEvent): Promise<void> => {
    if (!onEvent) {
      return;
    }
    await onEvent(event);
  };

  if (signal?.aborted) {
    throw new Error("Stream aborted before start");
  }

  let fileDiffs: FileDiff[] = [];
  let metadata: CollectPrDiffsResult["metadata"] | null = null;

  if (providedFileDiffs && providedFileDiffs.length > 0) {
    fileDiffs = providedFileDiffs;
  } else {
    const fetched = await collectDiffsWithFallback({
      prIdentifier,
      githubToken: providedGithubToken,
    });
    fileDiffs = fetched.fileDiffs;
    metadata = fetched.metadata;
  }

  const candidateFiles: FileDiff[] = [];

  for (const file of fileDiffs) {
    const skipReason = detectSkipReason(file.filePath, file.diffText);
    if (skipReason) {
      await emitEvent({
        type: "skip",
        filePath: file.filePath,
        reason: skipReason,
      });
      continue;
    }
    candidateFiles.push(file);
  }

  const diffCharacterCount = candidateFiles.reduce(
    (total, file) => total + file.diffText.length,
    0
  );

  if (candidateFiles.length === 0) {
    return {
      diffCharacterCount,
      finalText: "",
    };
  }

  const prLabel =
    metadata?.prUrl ??
    (metadata
      ? `${metadata.owner}/${metadata.repo}#${metadata.number ?? "unknown"}`
      : prIdentifier);

  // Determine which model to use based on configuration
  const effectiveModelConfig: ModelConfig =
    modelConfig ?? getDefaultHeatmapModelConfig();

  // AWS Bedrock SDK reads AWS_BEARER_TOKEN_BEDROCK and AWS_REGION from env vars by default
  // We pass them explicitly for clarity
  const bedrock = createAmazonBedrock({
    region: env.AWS_REGION ?? BEDROCK_AWS_REGION,
    apiKey: env.AWS_BEARER_TOKEN_BEDROCK,
  });

  const openai = createOpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: CLOUDFLARE_OPENAI_BASE_URL,
  });

  const runWithSemaphore = createSemaphore(MAX_CONCURRENCY);
  const finalChunks: string[] = [];

  const results = await Promise.allSettled(
    candidateFiles.map((file) =>
      runWithSemaphore(async () => {
        if (signal?.aborted) {
          throw new Error("Stream aborted");
        }

        await emitEvent({
          type: "file",
          filePath: file.filePath,
        });

        const parser = new SimpleReviewParser(file.filePath);
        let aborted = false;
        let emittedLine = false;
        const fileChunks: string[] = [];
        const handleAbort = () => {
          aborted = true;
        };

        if (signal) {
          signal.addEventListener("abort", handleAbort);
        }

        const prompt = buildFilePrompt(prLabel, file.filePath, file.diffText, tooltipLanguage);

        try {
          const modelInstance =
            effectiveModelConfig.provider === "openai"
              ? openai(effectiveModelConfig.model)
              : bedrock(effectiveModelConfig.model);

          const stream = streamText({
            model: modelInstance,
            prompt,
            temperature: 0,
            maxRetries: 2,
          });

          for await (const delta of stream.textStream) {
            if (aborted) {
              throw new Error("Stream aborted");
            }
            if (delta.length === 0) {
              continue;
            }

            finalChunks.push(delta);
            fileChunks.push(delta);

            if (onChunk) {
              await onChunk(delta);
            }

            const events = parser.push(delta);
            if (events.length > 0) {
              for (const event of events) {
                if (event.type === "line") {
                  emittedLine = true;
                }
                await emitEvent(event);
              }
            }
          }

          const remaining = parser.flush();
          if (remaining.length > 0) {
            for (const event of remaining) {
              if (event.type === "line") {
                emittedLine = true;
              }
              await emitEvent(event);
            }
          }

          if (!emittedLine) {
            const fileText = fileChunks.join("");
            console.warn("[simple-review] Model returned no annotations", {
              prIdentifier,
              filePath: file.filePath,
              preview: buildTextPreview(fileText),
              raw: fileText,
            });
            await emitEvent({
              type: "skip",
              filePath: file.filePath,
              reason: "model returned no annotated lines",
            });
            await emitEvent({
              type: "file-complete",
              filePath: file.filePath,
              status: "skipped",
              summary: "model returned no annotated lines",
            });
          } else {
            await emitEvent({
              type: "file-complete",
              filePath: file.filePath,
              status: "success",
            });
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error ?? "Unknown error");

          // Don't log abort errors - client disconnected
          const isAbortError = message.includes("Stream aborted") || message.includes("aborted");
          if (!isAbortError) {
            console.error("[simple-review] File stream failed", {
              prIdentifier,
              filePath: file.filePath,
              message,
            });
          }

          await emitEvent({
            type: "skip",
            filePath: file.filePath,
            reason: `error: ${message}`,
          });
          await emitEvent({
            type: "file-complete",
            filePath: file.filePath,
            status: "error",
            summary: message,
          });
          throw error;
        } finally {
          if (signal) {
            signal.removeEventListener("abort", handleAbort);
          }
        }
      })
    )
  );

  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );

  if (rejected.length > 0) {
    const firstReason = rejected[0]?.reason ?? "unknown error";
    throw firstReason instanceof Error
      ? firstReason
      : new Error(String(firstReason));
  }

  const finalText = finalChunks.join("");

  console.info("[simple-review] Stream completed", {
    prIdentifier,
    processedFiles: candidateFiles.length,
    finalLength: finalText.length,
  });

  return {
    diffCharacterCount,
    finalText,
  };
}

function detectSkipReason(filePath: string, diffText: string): string | null {
  const lowerPath = filePath.toLowerCase();

  if (SKIPPED_PATH_SEGMENTS.some((segment) => lowerPath.includes(segment))) {
    return "skipped third-party directory";
  }

  if (LOCKFILE_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))) {
    return "skipped lockfile";
  }

  if (isLikelyBinary(lowerPath, diffText)) {
    return "skipped binary file";
  }

  return null;
}

function isLikelyBinary(filePath: string, diffText: string): boolean {
  if (diffText.includes("Binary files") && diffText.includes("differ")) {
    return true;
  }

  if (diffText.includes("GIT binary patch")) {
    return true;
  }

  return BINARY_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function createSemaphore(limit: number) {
  if (limit <= 0) {
    return async <T>(task: () => Promise<T>): Promise<T> => task();
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = async () => {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
    active += 1;
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) {
      next();
    }
  };

  return async function runWithLimit<T>(task: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const LANGUAGE_NAME_MAP: Record<string, string> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
  hi: "Hindi",
  bn: "Bengali",
  te: "Telugu",
  mr: "Marathi",
  ta: "Tamil",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ar: "Arabic",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
};

function buildFilePrompt(
  prLabel: string,
  filePath: string,
  diffText: string,
  tooltipLanguage: TooltipLanguageValue
): string {
  const strippedDiff = stripLeadingTrailingCodeFences(diffText);
  const languageName = LANGUAGE_NAME_MAP[tooltipLanguage] ?? "English";
  const languageInstruction =
    tooltipLanguage !== DEFAULT_TOOLTIP_LANGUAGE
      ? `\n\nIMPORTANT: Write ALL comments (the "<comment>" part) in ${languageName}. The mostImportantWord should remain as it appears in the code (do not translate code identifiers).`
      : "";

  console.info("[simple-review][prompt] Building prompt", {
    filePath,
    tooltipLanguage,
    languageName,
    hasLanguageInstruction: languageInstruction.length > 0,
  });

  return `You are reviewing a GitHub diff for ${prLabel}
File path: ${filePath}

${SIMPLE_REVIEW_GUIDANCE}

Diff:
${strippedDiff}

${SIMPLE_REVIEW_INSTRUCTIONS}${languageInstruction}`;
}

function buildTextPreview(text: string, maxLength = 400): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 3)}...`;
}

function stripLeadingTrailingCodeFences(text: string): string {
  if (!text) {
    return text;
  }

  const lines = text.split(/\r?\n/);
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && lines[start]!.trim().length === 0) {
    start += 1;
  }
  while (end >= start && lines[end]!.trim().length === 0) {
    end -= 1;
  }

  if (start > end) {
    return "";
  }

  const startsWithFence = lines[start]!.trim().startsWith("```");
  if (startsWithFence) {
    start += 1;
    while (start <= end && lines[start]!.trim().startsWith("```")) {
      start += 1;
    }
  }

  const endsWithFence = lines[end]!.trim().startsWith("```");
  if (endsWithFence) {
    end -= 1;
    while (end >= start && lines[end]!.trim().startsWith("```")) {
      end -= 1;
    }
  }

  if (start > end) {
    return "";
  }

  return lines.slice(start, end + 1).join("\n");
}
