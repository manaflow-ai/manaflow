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

const OPEN_MARK = "{|";
const CLOSE_MARK = "|}";
const REVIEW_MARKER = "// review";

interface ParsedBracket {
  content: string;
  score: number;
  highlighted: string | null;
  comment: string | null;
}

function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function buildPrompt(context: StrategyPrepareContext, diffIdentifier: string): string {
  const diffText = context.diff || "(no diff output)";
  return `You are assisting with a code review by highlighting important parts of every diff line.
For each line (added, removed, or unchanged):
1. Wrap the most important span with {| and |}. If nothing is noteworthy, wrap the smallest neutral token.
2. Append a review marker at the end: // review <float 0.0-1.0> <optional short comment>
   - Use lowercase "review".
   - Always include a score (float between 0.0 and 1.0, even if the line is fine).
   - Keep comments concise; omit them if there's nothing to add.
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

function parseBracketLine(line: string): ParsedBracket | null {
  const markerIndex = line.toLowerCase().indexOf(REVIEW_MARKER);
  if (markerIndex === -1) return null;
  const content = line.slice(0, markerIndex).trimEnd();
  const remainder = line.slice(markerIndex + REVIEW_MARKER.length).trim();
  const [scoreToken, ...rest] = remainder.split(/\s+/);
  const score = Number.parseFloat(scoreToken ?? "");
  if (!Number.isFinite(score) || score < 0 || score > 1) return null;
  const comment = rest.length > 0 ? rest.join(" ") : null;

  const openIndex = content.indexOf(OPEN_MARK);
  const closeIndex = content.indexOf(CLOSE_MARK, openIndex + OPEN_MARK.length);
  let highlighted: string | null = null;
  let cleaned = content;

  if (openIndex !== -1 && closeIndex !== -1) {
    highlighted = content.slice(openIndex + OPEN_MARK.length, closeIndex);
    cleaned =
      content.slice(0, openIndex) +
      highlighted +
      content.slice(closeIndex + CLOSE_MARK.length);
  }

  return {
    content: cleaned,
    score,
    highlighted,
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
    .map(parseBracketLine)
    .filter((entry): entry is ParsedBracket => entry !== null)
    .map((entry) => ({
      lineContent: entry.content,
      shouldBeReviewedScore: entry.score,
      highlightPhrase: entry.highlighted ?? null,
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

export const inlineBracketsStrategy: ReviewStrategy = {
  id: "inline-brackets",
  displayName: "Inline review ({| |} highlight)",
  prepare,
  process,
};
