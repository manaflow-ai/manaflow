#!/usr/bin/env bun
import Anthropic from "@anthropic-ai/sdk";
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
const OUTPUT_FILE = resolve(DATA_DIR, "evaluations.jsonl");
const CHECKPOINT_FILE = resolve(DATA_DIR, "eval-checkpoint.json");

const MODEL = "claude-sonnet-4-20250514";
const CONCURRENCY = 2; // Be gentle with rate limits

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
  const anthropic = new Anthropic();

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

  const existingEvalsMap = new Map(
    existingEvals.map((e) => [e.commentId, e])
  );

  let processed = 0;
  let errors = 0;

  // Process with concurrency
  await mapWithConcurrency(toEvaluate, CONCURRENCY, async ({ pr, comment }) => {
    try {
      const evaluation = await evaluateComment(anthropic, pr, comment);

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
      if (processed % 5 === 0 || processed === toEvaluate.length) {
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

async function evaluateComment(
  anthropic: Anthropic,
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

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: EVALUATION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: EVALUATION_USER_PROMPT(context),
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = content.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const evaluation = JSON.parse(jsonStr.trim()) as Evaluation;
    return evaluation;
  } catch {
    console.error("Failed to parse evaluation JSON:", content.text);
    throw new Error("Failed to parse evaluation response as JSON");
  }
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
