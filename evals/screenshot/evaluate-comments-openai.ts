#!/usr/bin/env bun
import OpenAI from "openai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import type {
  Evaluation,
  EvaluationPromptContext,
  StoredEvaluation,
} from "./src/evaluation-criteria";
import {
  EVALUATION_SYSTEM_PROMPT,
  EVALUATION_USER_PROMPT,
} from "./src/evaluation-criteria";

const DATA_DIR = resolve(import.meta.dirname, "data");
const INPUT_FILE = resolve(DATA_DIR, "bot-comments.jsonl");
const OUTPUT_FILE = resolve(DATA_DIR, "evaluations-openai.jsonl");
const CHECKPOINT_FILE = resolve(DATA_DIR, "eval-checkpoint-openai.json");

const MODEL = "gpt-5.1-2025-11-13";
const CONCURRENCY = 3;

type StoredComment = {
  type: "issue_comment" | "review_comment" | "review";
  id: number;
  prNumber: number;
  botLogin: string;
  body: string;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  path?: string;
  diffHunk?: string;
  position?: number | null;
  reviewState?: string;
};

type StoredPR = {
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  diff: string;
  comments: StoredComment[];
};

type Checkpoint = {
  evaluatedCommentIds: number[];
  lastUpdatedAt: string;
};

async function main() {
  const isDryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

  await mkdir(DATA_DIR, { recursive: true });

  // Load data
  const prs = await loadPRs();
  const checkpoint = await loadCheckpoint();
  const existingEvals = await loadExistingEvaluations();

  console.error(`Loaded ${prs.length} PRs`);

  // Flatten all comments
  const allComments: { pr: StoredPR; comment: StoredComment }[] = [];
  for (const pr of prs) {
    for (const comment of pr.comments) {
      allComments.push({ pr, comment });
    }
  }

  console.error(`Total comments: ${allComments.length}`);

  // Filter out already evaluated
  const evaluatedSet = new Set(checkpoint.evaluatedCommentIds);
  const toEvaluate = allComments.filter(
    ({ comment }) => !evaluatedSet.has(comment.id)
  );

  console.error(
    `${toEvaluate.length} comments to evaluate (${evaluatedSet.size} already done)`
  );

  if (toEvaluate.length === 0) {
    console.error("All comments already evaluated!");
    return;
  }

  // Apply limit if specified
  const batch = limit ? toEvaluate.slice(0, limit) : toEvaluate;

  // Dry run mode - just show stats
  if (isDryRun) {
    console.error("\n=== DRY RUN ===");
    console.error(`Would evaluate ${batch.length} comments${limit ? ` (limited from ${toEvaluate.length})` : ""}`);
    console.error(`Model: ${MODEL}`);
    console.error(`Concurrency: ${CONCURRENCY}`);
    return;
  }

  console.error(`Evaluating ${batch.length} comments${limit ? ` (limited from ${toEvaluate.length})` : ""}`);

  const apiKey = process.env.OPENAI_API_KEY_SCREENSHOT_LLM_JUDGE;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY_SCREENSHOT_LLM_JUDGE environment variable is required");
  }

  const openai = new OpenAI({ apiKey });

  const existingEvalsMap = new Map(
    existingEvals.map((e) => [e.commentId, e])
  );

  let processed = 0;
  let errors = 0;

  // Process with concurrency
  await mapWithConcurrency(batch, CONCURRENCY, async ({ pr, comment }) => {
    try {
      const evaluation = await evaluateComment(openai, pr, comment);

      const storedEval: StoredEvaluation = {
        commentId: comment.id,
        prNumber: pr.number,
        evaluation,
        evaluatedAt: new Date().toISOString(),
        model: MODEL,
      };

      existingEvalsMap.set(comment.id, storedEval);
      checkpoint.evaluatedCommentIds.push(comment.id);
      checkpoint.lastUpdatedAt = new Date().toISOString();

      processed += 1;

      // Save periodically
      if (processed % 5 === 0 || processed === batch.length) {
        await saveCheckpoint(checkpoint);
        await saveEvaluations(Array.from(existingEvalsMap.values()));
        console.error(
          `Progress: ${processed}/${toEvaluate.length} evaluated, ${errors} errors`
        );
      }

      const ratingEmoji =
        evaluation.rating === "excellent"
          ? "✅"
          : evaluation.rating === "good"
            ? "👍"
            : evaluation.rating === "acceptable"
              ? "🔶"
              : evaluation.rating === "poor"
                ? "⚠️"
                : "❌";

      console.error(
        `  PR #${pr.number} comment ${comment.id}: ${ratingEmoji} ${evaluation.rating}`
      );
    } catch (err) {
      errors += 1;
      console.error(
        `  Error evaluating PR #${pr.number} comment ${comment.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  });

  // Final save
  await saveCheckpoint(checkpoint);
  await saveEvaluations(Array.from(existingEvalsMap.values()));

  console.error(`\nDone! Evaluated ${processed} comments, ${errors} errors`);
  console.error(`Output saved to ${OUTPUT_FILE}`);

  // Print summary
  const allEvals = Array.from(existingEvalsMap.values());
  const ratings = {
    excellent: 0,
    good: 0,
    acceptable: 0,
    poor: 0,
    failed: 0,
  };
  for (const e of allEvals) {
    ratings[e.evaluation.rating]++;
  }
  console.error("\nRating distribution:");
  for (const [rating, count] of Object.entries(ratings)) {
    const pct = ((count / allEvals.length) * 100).toFixed(1);
    console.error(`  ${rating}: ${count} (${pct}%)`);
  }
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

async function evaluateComment(
  openai: OpenAI,
  pr: StoredPR,
  comment: StoredComment
): Promise<Evaluation> {
  const context: EvaluationPromptContext = {
    prNumber: pr.number,
    prTitle: pr.title,
    commentBody: comment.body,
    diff: truncateDiff(pr.diff, 50000), // Truncate very long diffs
    botLogin: comment.botLogin,
    commentType: comment.type,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        max_completion_tokens: 2000,
        reasoning_effort: "high",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              EVALUATION_SYSTEM_PROMPT + "\n\nYou MUST respond with valid JSON.",
          },
          {
            role: "user",
            content: EVALUATION_USER_PROMPT(context),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from OpenAI");
      }

      try {
        const evaluation = JSON.parse(content) as Evaluation;
        return evaluation;
      } catch {
        console.error("Failed to parse evaluation JSON:", content);
        throw new Error("Failed to parse evaluation response as JSON");
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if error is retryable
      const isRetryable = isRetryableError(lastError);
      if (!isRetryable || attempt === MAX_RETRIES - 1) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      console.error(
        `  Retry ${attempt + 1}/${MAX_RETRIES} for PR #${pr.number} comment ${comment.id} after ${Math.round(delay)}ms: ${lastError.message}`
      );
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Unknown error");
}

function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  // Retry on rate limits, timeouts, server errors, and connection issues
  return (
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("no response content")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateDiff(diff: string, maxLength: number): string {
  if (diff.length <= maxLength) {
    return diff;
  }
  return diff.slice(0, maxLength) + "\n\n... [diff truncated] ...";
}

async function loadPRs(): Promise<StoredPR[]> {
  const content = await readFile(INPUT_FILE, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as StoredPR);
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const content = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(content) as Checkpoint;
  } catch {
    return {
      evaluatedCommentIds: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }
}

async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  await writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), "utf8");
}

async function loadExistingEvaluations(): Promise<StoredEvaluation[]> {
  try {
    const content = await readFile(OUTPUT_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as StoredEvaluation);
  } catch {
    return [];
  }
}

async function saveEvaluations(evals: StoredEvaluation[]): Promise<void> {
  const jsonl = evals.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(OUTPUT_FILE, jsonl + "\n", "utf8");
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U | undefined>
): Promise<U[]> {
  if (items.length === 0) {
    return [];
  }
  const max = Math.max(1, Math.min(limit, items.length));
  const results: (U | undefined)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) {
        break;
      }
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: max }, () => worker());
  await Promise.all(workers);
  return results.filter((value): value is U => value !== undefined);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
