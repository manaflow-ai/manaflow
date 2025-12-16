import type {
  ReviewStrategy,
  StrategyPrepareContext,
  StrategyPrepareResult,
  StrategyProcessContext,
  StrategyRunResult,
  StrategyAnnotation,
} from "../core/types";

interface ModelLineEntry {
  line?: string | null;
  shouldBeReviewedScore?: unknown;
  shouldReviewWhy?: unknown;
  mostImportantWord?: unknown;
}

interface ModelResponseShape {
  lines?: ModelLineEntry[];
}

type DiffLineType = "addition" | "deletion";

interface ChangedDiffLine {
  type: DiffLineType;
  rawDiffLine: string;
  content: string;
  newLineNumber: number | null;
  oldLineNumber: number | null;
}

function extractChangedLines(diff: string): ChangedDiffLine[] {
  const results: ChangedDiffLine[] = [];
  let currentOld = 0;
  let currentNew = 0;

  const lines = diff.split("\n");
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith("@@")) {
      const match = line.match(
        /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
      );
      if (match) {
        currentOld = Number.parseInt(match[1] ?? "0", 10) - 1;
        currentNew = Number.parseInt(match[2] ?? "0", 10) - 1;
      }
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    if (line.startsWith("+")) {
      if (line.startsWith("++")) {
        continue;
      }
      currentNew += 1;
      results.push({
        type: "addition",
        rawDiffLine: line,
        content: line.slice(1),
        newLineNumber: currentNew,
        oldLineNumber: null,
      });
      continue;
    }
    if (line.startsWith("-")) {
      if (line.startsWith("--")) {
        continue;
      }
      currentOld += 1;
      results.push({
        type: "deletion",
        rawDiffLine: line,
        content: line.slice(1),
        newLineNumber: null,
        oldLineNumber: currentOld,
      });
      continue;
    }
    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    currentOld += 1;
    currentNew += 1;
  }

  return results;
}

function buildPrompt(context: StrategyPrepareContext): string {
  const diffForPrompt =
    context.options.showDiffLineNumbers || context.options.showContextLineNumbers
      ? context.formattedDiff.join("\n")
      : context.diff || "(no diff output)";

  return `You are a meticulous senior engineer performing a comprehensive pull request review.
File path: ${context.filePath}
Return a JSON object of type { lines: { line: string, shouldBeReviewedScore: number, shouldReviewWhy: string | null, mostImportantWord: string }[] }.
You MUST include one entry for every changed diff line (additions and deletions) in order.
- The "line" property must contain the exact diff line including the leading "+" or "-" prefix (do not trim, do not summarize, do not add line numbers).
- If a line looks safe, still include it with shouldBeReviewedScore 0.0 and shouldReviewWhy null.
- shouldBeReviewedScore is required for every line (range 0.0-1.0). Use higher scores for lines that warrant attention.
- mostImportantWord must always be provided and reference the most critical word or identifier within the line content (ignore the leading diff prefix).
- shouldReviewWhy should be a concise (4-10 words) hint for reviewers; use null when there is nothing noteworthy.
Do not skip any changed lines. Do not add extra properties. Respond with valid JSON only.

The diff:
${diffForPrompt || "(no diff output)"}`;
}

const outputSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "string" },
          shouldBeReviewedScore: { type: "number" },
          shouldReviewWhy: { type: ["string", "null"] as const },
          mostImportantWord: { type: "string" },
        },
        required: [
          "line",
          "shouldBeReviewedScore",
          "shouldReviewWhy",
          "mostImportantWord",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["lines"],
  additionalProperties: false,
} as const;

async function prepare(
  context: StrategyPrepareContext
): Promise<StrategyPrepareResult> {
  const changedLines = extractChangedLines(context.diff);
  return {
    prompt: buildPrompt(context),
    outputSchema,
    metadata: {
      changedLines,
    },
  };
}

function parseModelResponse(rawText: string): ModelResponseShape | null {
  try {
    return JSON.parse(rawText) as ModelResponseShape;
  } catch {
    return null;
  }
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function coerceOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function deriveFallbackWord(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  const tokens = normalized.split(/\s+/);
  for (const token of tokens) {
    const sanitized = token
      .replace(/^[^A-Za-z0-9_$]+/, "")
      .replace(/[^A-Za-z0-9_$]+$/, "");
    if (sanitized.length > 0) {
      return sanitized;
    }
  }

  return null;
}

function buildAnnotationForLine(
  diffLine: ChangedDiffLine,
  entry: ModelLineEntry | null
): StrategyAnnotation {
  const resolvedLineContent =
    typeof entry?.line === "string" && entry.line.length > 0
      ? entry.line
      : diffLine.rawDiffLine;

  const score = coerceNumber(entry?.shouldBeReviewedScore, 0);
  const importantWord =
    coerceOptionalString(entry?.mostImportantWord) ??
    deriveFallbackWord(diffLine.content);
  const comment = coerceOptionalString(entry?.shouldReviewWhy);

  const lineNumber =
    diffLine.type === "addition"
      ? diffLine.newLineNumber
      : diffLine.oldLineNumber;

  return {
    lineNumber,
    lineContent: resolvedLineContent,
    shouldBeReviewedScore: score,
    mostImportantWord: importantWord ?? undefined,
    comment: comment ?? undefined,
    highlightPhrase: importantWord ?? null,
  };
}

function normalizeChangedLines(
  metadata: Record<string, unknown> | undefined
): ChangedDiffLine[] {
  const raw = metadata?.changedLines;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const type = record.type;
      if (type !== "addition" && type !== "deletion") {
        return null;
      }
      const rawDiffLine =
        typeof record.rawDiffLine === "string" && record.rawDiffLine.length > 0
          ? record.rawDiffLine
          : null;
      if (!rawDiffLine) {
        return null;
      }
      const content =
        typeof record.content === "string" ? record.content : rawDiffLine.slice(1);
      const newLineNumber =
        typeof record.newLineNumber === "number" && Number.isFinite(record.newLineNumber)
          ? Math.trunc(record.newLineNumber)
          : null;
      const oldLineNumber =
        typeof record.oldLineNumber === "number" && Number.isFinite(record.oldLineNumber)
          ? Math.trunc(record.oldLineNumber)
          : null;

      return {
        type,
        rawDiffLine,
        content,
        newLineNumber,
        oldLineNumber,
      } satisfies ChangedDiffLine;
    })
    .filter((entry): entry is ChangedDiffLine => entry !== null);
}

async function process(
  context: StrategyProcessContext
): Promise<StrategyRunResult> {
  const changedLines = normalizeChangedLines(
    (context.metadata as Record<string, unknown> | undefined) ?? undefined
  );
  const parsedResponse = parseModelResponse(context.responseText);
  const rawEntries = Array.isArray(parsedResponse?.lines)
    ? parsedResponse?.lines ?? []
    : [];

  const annotations: StrategyAnnotation[] = [];
  const maxLength = Math.max(changedLines.length, rawEntries.length);

  for (let index = 0; index < maxLength; index += 1) {
    const diffLine = changedLines[index];
    if (!diffLine) {
      break;
    }
    const entry = rawEntries[index] ?? null;
    if (
      entry &&
      typeof entry.line === "string" &&
      entry.line.length > 0 &&
      entry.line !== diffLine.rawDiffLine &&
      context.log
    ) {
      context.log(
        "Diff line mismatch",
        `Expected "${diffLine.rawDiffLine}" but model returned "${entry.line}". Using diff line for annotation.`
      );
    }
    annotations.push(buildAnnotationForLine(diffLine, entry));
  }

  if (rawEntries.length !== changedLines.length && context.log) {
    context.log(
      "Model coverage mismatch",
      `Expected ${changedLines.length} diff lines, received ${rawEntries.length} entries. Filled missing annotations with defaults.`
    );
  }

  return {
    rawResponse: context.responseText,
    annotations,
  };
}

export const openAiResponsesStrategy: ReviewStrategy = {
  id: "openai-responses",
  displayName: "OpenAI Responses (comprehensive JSON)",
  prepare,
  process,
};
