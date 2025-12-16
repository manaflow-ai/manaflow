import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  ReviewStrategy,
  StrategyPrepareContext,
  StrategyPrepareResult,
  StrategyProcessContext,
  StrategyRunResult,
} from "../core/types";
import type { DiffArtifactMode } from "../core/options";

const REVIEW_MARKER = "// review";

interface ParsedPhrase {
  content: string;
  score: number;
  phrase: string;
  comment: string | null;
}

function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function buildPrompt(context: StrategyPrepareContext, diffIdentifier: string): string {
  const diffText = context.diff || "(no diff output)";
  return `You are assisting with a code review by annotating every line of the diff shown below.
For each changed line (only lines that begin with + or -), append a review tag in the format:
<original line> // review <float 0.0-1.0> "verbatim snippet from line" <optional comment>
- Use lowercase "review".
- Skip metadata/context lines (those that start with space, diff --, index, ---/+++, @@, etc.).
- Copy a concise snippet directly from the changed portion (no more than 6 words) and avoid leading indentation or the entire line.
- Always include a score (float between 0.0 and 1.0) even if the line is fine.
- Keep the phrase short (ideally 1-5 words).
- Optional comment can be omitted if there's nothing noteworthy.
Do not remove or reorder diff lines; preserve +/- markers and context.
Return the fully annotated diff wrapped in a markdown code block tagged as \`\`\`diff.
Diff identifier: ${diffIdentifier}
File path: ${context.filePath}

Diff:
${diffText}`;
}

function diffHeader(filePath: string): string {
  return `# FILE ${filePath}\n`;
}

function formatDiffBody(diff: string): string {
  const normalized = diff.endsWith("\n") ? diff : `${diff}\n`;
  return `${normalized}\n`;
}

function parsePhraseLine(line: string): ParsedPhrase | null {
  const markerIndex = line.toLowerCase().indexOf(REVIEW_MARKER);
  if (markerIndex === -1) return null;
  const content = line.slice(0, markerIndex).trimEnd();
  const remainder = line.slice(markerIndex + REVIEW_MARKER.length).trim();
  const match = remainder.match(/^([0-1](?:\.\d+)?)\s+"([^"]+)"(?:\s+(.*))?$/);
  if (!match) return null;
  const score = Number.parseFloat(match[1]);
  if (!Number.isFinite(score) || score < 0 || score > 1) return null;
  const phrase = match[2].trim();
  const comment = match[3] ?? null;
  return {
    content,
    score,
    phrase,
    comment,
  };
}

async function persistDiffArtifact(
  context: StrategyPrepareContext
): Promise<string> {
  const mode: DiffArtifactMode = context.options.diffArtifactMode;
  const diffContent = context.diff || "(no diff output)";

  if (mode === "single") {
    const relativePath = "diffs/output.diff";
    const payload = `${diffHeader(context.filePath)}${formatDiffBody(diffContent)}`;
    await context.persistArtifact(relativePath, payload, { append: true });
    return relativePath;
  }

  const hash = createHash("sha1")
    .update(context.filePath)
    .update("\n")
    .update(context.diff ?? "")
    .digest("hex")
    .slice(0, 8);
  const safeName = sanitizeFilePath(basename(context.filePath));
  const relativePath = `diffs/${safeName}-${hash}.diff`;
  await context.persistArtifact(relativePath, formatDiffBody(diffContent));
  return relativePath;
}

async function prepare(
  context: StrategyPrepareContext
): Promise<StrategyPrepareResult> {
  const diffIdentifier = await persistDiffArtifact(context);
  const prompt = buildPrompt(context, diffIdentifier);
  return {
    prompt,
    metadata: { diffIdentifier, filePath: context.filePath },
  };
}

async function process(
  context: StrategyProcessContext
): Promise<StrategyRunResult> {
  const identifier =
    typeof context.metadata?.diffIdentifier === "string"
      ? context.metadata?.diffIdentifier
      : sanitizeFilePath(context.filePath);
  const mode: DiffArtifactMode = context.options.diffArtifactMode;
  const relativePath =
    mode === "single"
      ? "annotated/output.review.txt"
      : `annotated/${identifier.replace(/\.diff$/, "")}.review.txt`;

  const payload = `${diffHeader(context.filePath)}${
    context.responseText.endsWith("\n") ? context.responseText : `${context.responseText}\n`
  }\n`;

  await context.persistArtifact(relativePath, payload, {
    append: mode === "single",
  });

  const annotations = context.responseText
    .split(/\r?\n/)
    .map(parsePhraseLine)
    .filter((entry): entry is ParsedPhrase => entry !== null)
    .map((entry) => ({
      lineContent: entry.content,
      shouldBeReviewedScore: entry.score,
      highlightPhrase: entry.phrase,
      mostImportantWord: null,
      comment: entry.comment,
    }));

  return {
    rawResponse: context.responseText,
    artifacts: [
      {
        label: "Annotated diff",
        relativePath,
      },
    ],
    annotations,
  };
}

export const inlinePhraseStrategy: ReviewStrategy = {
  id: "inline-phrase",
  displayName: "Inline review (phrase tag)",
  prepare,
  process,
};
