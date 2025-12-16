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

const JSON_MARKER = "//";

interface ParsedJsonAnnotation {
  content: string;
  score: number;
  phrase: string | null;
  comment: string | null;
}

function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function buildPrompt(context: StrategyPrepareContext, diffIdentifier: string): string {
  const diffText = context.diff || "(no diff output)";
  return `You are assisting with a code review by appending JSON review data to every diff line.
For each changed line (lines that begin with + or -), append a lowercase // followed by a compact JSON object with the shape:
{ score: <float 0.0-1.0>, phrase: "<verbatim snippet or empty>", comment: "<optional comment>" }
Rules:
- Include the score field in every object (float between 0.0 and 1.0).
- Skip context and metadata lines (those starting with space, diff --, index, ---/+++, @@, etc.).
- Copy a short snippet directly from the changed portion of the diff line (aim for 2-6 words). Do not echo the entire line or include leading indentation.
- Trim leading/trailing whitespace from the snippet; use "" when nothing should be highlighted.
- Do not add underscores or otherwise alter characters inside the snippet.
- Comments are optional; use "" when unused.
- Do not remove, reorder, or otherwise alter diff lines; only append the JSON comment.
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

function parseJsonAnnotation(line: string): ParsedJsonAnnotation | null {
  const markerIndex = line.indexOf(JSON_MARKER);
  if (markerIndex === -1) return null;
  const content = line.slice(0, markerIndex).trimEnd();
  const remainder = line.slice(markerIndex + JSON_MARKER.length).trim();
  if (!remainder.startsWith("{") || !remainder.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(remainder);
    const score = Number(parsed.score);
    if (!Number.isFinite(score) || score < 0 || score > 1) return null;
    const rawPhrase =
      typeof parsed.phrase === "string" ? parsed.phrase.trim() : "";
    const phrase = rawPhrase.length > 0 ? rawPhrase : null;
    const comment =
      typeof parsed.comment === "string" && parsed.comment.length > 0
        ? parsed.comment
        : null;
    return {
      content,
      score,
      phrase,
      comment,
    };
  } catch {
    return null;
  }
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
    .map(parseJsonAnnotation)
    .filter((entry): entry is ParsedJsonAnnotation => entry !== null)
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

export const inlineJsonStrategy: ReviewStrategy = {
  id: "inline-json",
  displayName: "Inline review (JSON tag)",
  prepare,
  process,
};
