import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
  ReviewStrategy,
  StrategyPrepareContext,
  StrategyPrepareResult,
  StrategyProcessContext,
  StrategyRunResult,
} from "../core/types";
const REVIEW_MARKER = "// review";
const RELATIVE_PATH_METADATA_KEY = "inlineFileRelativePath";
const ABSOLUTE_PATH_METADATA_KEY = "inlineFileAbsolutePath";
const WORKSPACE_RELATIVE_PATH_METADATA_KEY = "inlineFileWorkspaceRelativePath";
const WORKSPACE_ABSOLUTE_PATH_METADATA_KEY = "inlineFileWorkspaceAbsolutePath";

interface ParsedPhrase {
  content: string;
  score: number;
  phrase: string;
  comment: string | null;
}

function sanitizeFilePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function diffHeader(filePath: string): string {
  return `# FILE ${filePath}\n`;
}

function formatDiffBody(diff: string): string {
  const normalized = diff.endsWith("\n") ? diff : `${diff}\n`;
  return `${normalized}\n`;
}

function buildInlineDiffPayload(filePath: string, diffContent: string): string {
  return `${diffHeader(filePath)}${formatDiffBody(diffContent)}`;
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

function buildPrompt(
  context: StrategyPrepareContext,
  absolutePath: string,
  relativePath: string
): string {
  const diffContent = context.diff || "(no diff output)";
  return `You are assisting with a code review by annotating the workspace copy of the diff.
The diff for ${context.filePath} has been written to:
- Absolute path: ${absolutePath}
- Relative to repository root: ${relativePath}

Instructions:
1. Open that file in the workspace editor.
2. For every changed line (only lines beginning with \`+\` or \`-\`) append: // review <float 0.0-1.0> "verbatim snippet from line" <optional comment>
   - Use lowercase "review".
   - Skip metadata/context rows (lines starting with space, diff --, index, ---/+++, @@, etc.).
   - Copy a concise snippet from the changed portion (no more than 6 words) without leading indentation or trailing padding. This is the phrase that will be highlighted for human reviewers.
   - Always include a score between 0.0 and 1.0.
   - Keep comments concise (or omit them when unnecessary).
   - Anything that feels like it might be off or might warrant a comment should have a high score, even if it's technically correct.
   - Ugly code should be given a higher score.
   - Code that may be hard to read for a human should also be given a higher score.
   - Non-clean code too.
3. Preserve all diff markers and ordering. Do not wrap the output in markdown fences.
4. Save the file when you are done. The host will read that file from disk; you do not need to paste the diff in chat.
5. Remember to use the apply_patch function when editing the file.

Reference copy of the diff:
\`\`\`diff
${diffContent}
\`\`\`

Reply with a short confirmation (for example: "Annotations saved.").`;
}

function computeRelativePath(filePath: string, diffContent: string): string {
  const hash = createHash("sha1")
    .update(filePath)
    .update("\n")
    .update(diffContent)
    .digest("hex")
    .slice(0, 8);
  const safeName = sanitizeFilePath(basename(filePath));
  return `inline-files/${safeName}-${hash}.diff`;
}

async function prepare(
  context: StrategyPrepareContext
): Promise<StrategyPrepareResult> {
  const diffContent = context.diff || "(no diff output)";
  if (context.options.diffArtifactMode === "single") {
    context.log(
      "inline-files",
      "diffArtifactMode=single is not supported for inline-files strategy; defaulting to per-file artifacts."
    );
  }
  const relativePath = computeRelativePath(context.filePath, diffContent);
  const workspaceRelativePath = relativePath;
  const workspaceAbsolutePath = join(context.workspaceDir, workspaceRelativePath);
  const payload = buildInlineDiffPayload(context.filePath, diffContent);

  await mkdir(dirname(workspaceAbsolutePath), { recursive: true });
  await writeFile(workspaceAbsolutePath, payload);

  await context.persistArtifact(relativePath, payload);

  const absolutePath = join(context.artifactsDir, relativePath);
  const prompt = buildPrompt(context, workspaceAbsolutePath, workspaceRelativePath);
  return {
    prompt,
    metadata: {
      [RELATIVE_PATH_METADATA_KEY]: relativePath,
      [ABSOLUTE_PATH_METADATA_KEY]: absolutePath,
      [WORKSPACE_RELATIVE_PATH_METADATA_KEY]: workspaceRelativePath,
      [WORKSPACE_ABSOLUTE_PATH_METADATA_KEY]: workspaceAbsolutePath,
      filePath: context.filePath,
    },
  };
}

async function process(
  context: StrategyProcessContext
): Promise<StrategyRunResult> {
  const relativePathMetadata =
    typeof context.metadata?.[RELATIVE_PATH_METADATA_KEY] === "string"
      ? (context.metadata?.[RELATIVE_PATH_METADATA_KEY] as string)
      : null;
  const workspaceRelativePathMetadata =
    typeof context.metadata?.[WORKSPACE_RELATIVE_PATH_METADATA_KEY] === "string"
      ? (context.metadata?.[WORKSPACE_RELATIVE_PATH_METADATA_KEY] as string)
      : null;
  const workspaceAbsolutePathMetadata =
    typeof context.metadata?.[WORKSPACE_ABSOLUTE_PATH_METADATA_KEY] === "string"
      ? (context.metadata?.[WORKSPACE_ABSOLUTE_PATH_METADATA_KEY] as string)
      : null;

  if (!relativePathMetadata) {
    throw new Error(
      "inline-files strategy missing relative path metadata; ensure prepare() completed successfully."
    );
  }
  const workspaceAbsolutePath =
    workspaceAbsolutePathMetadata ??
    join(
      context.workspaceDir,
      workspaceRelativePathMetadata ?? relativePathMetadata
    );
  const relativePath = relativePathMetadata;
  let fileContent: string;
  try {
    fileContent = await readFile(workspaceAbsolutePath, "utf8");
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    throw new Error(
      `inline-files strategy failed to read annotations from ${workspaceAbsolutePath}: ${reason}`
    );
  }

  await context.persistArtifact(relativePath, fileContent);

  const annotations = fileContent
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
    rawResponse: fileContent,
    artifacts: [
      {
        label: "Inline diff annotations",
        relativePath,
      },
    ],
    annotations,
  };
}

export const inlineFilesStrategy: ReviewStrategy = {
  id: "inline-files",
  displayName: "Inline review (workspace file)",
  prepare,
  process,
};
