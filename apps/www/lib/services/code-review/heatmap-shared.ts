import { z } from "zod";

const heatmapLineSchema = z.object({
  line: z.string(),
  shouldBeReviewedScore: z.number().min(0).max(1).optional(),
  shouldReviewWhy: z.string().optional(),
  mostImportantWord: z.string().min(1),
});

export const heatmapSchema = z.object({
  lines: z.array(heatmapLineSchema),
});

export type HeatmapLine = z.infer<typeof heatmapLineSchema>;

export function buildHeatmapPrompt(
  filePath: string,
  formattedDiff: readonly string[]
): string {
  const diffBody =
    formattedDiff.length > 0 ? formattedDiff.join("\n") : "(no diff)";
  return `You are preparing a review heatmap for the file "${filePath}".
Return structured data matching the provided schema. Rules:
- Keep the original diff text in the "line" field; it may begin with "+", "-", or " ".
- Include one entry per diff row that matters. Always cover every line that begins with "+" or "-".
- When shouldBeReviewedScore is set, provide a short shouldReviewWhy hint (6-12 words). Leave both absent when the line is fine.
- shouldBeReviewedScore is a number from 0.00 to 1.00 that indicates how careful the reviewer should be when reviewing this line of code.
- mostImportantWord must always be set. Provide the most critical word or identifier from the line (ignore any leading diff marker).
- Keep explanations concise; do not invent code that is not in the diff.
- Anything that feels like it might be off or might warrant a comment should have a high score, even if it's technically correct.
- In most cases, the shouldReviewWhy should follow a template like "<X> <verb> <Y>" (eg. "line is too long" or "code accesses sensitive data").
- It should be understandable by a human and make sense (break the "X is Y" rule if it helps you make it more understandable).
- Non-clean code and ugly code (hard to read for a human) should be given a higher score.

Diff:
\`\`\`diff
${diffBody}
\`\`\``;
}

interface SummarizedChunk {
  lineCount: number | null;
  textDelta: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHeatmapLineCandidate(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.line !== "string") {
    return false;
  }

  if (
    value.shouldBeReviewedScore !== undefined &&
    (typeof value.shouldBeReviewedScore !== "number" ||
      value.shouldBeReviewedScore < 0 ||
      value.shouldBeReviewedScore > 1)
  ) {
    return false;
  }

  if (
    value.shouldReviewWhy !== undefined &&
    typeof value.shouldReviewWhy !== "string"
  ) {
    return false;
  }

  if (
    typeof value.mostImportantWord !== "string" ||
    value.mostImportantWord.trim().length === 0
  ) {
    return false;
  }

  return true;
}

export function summarizeHeatmapStreamChunk(chunk: unknown): SummarizedChunk {
  if (!isRecord(chunk)) {
    return { lineCount: null, textDelta: null };
  }

  const typeValue = chunk.type;
  const textDeltaValue = chunk.textDelta;
  const objectValue = chunk.object;

  let textDelta: string | null = null;
  if (typeValue === "text-delta" && typeof textDeltaValue === "string") {
    const trimmed = textDeltaValue.trim();
    textDelta = trimmed.length > 0 ? trimmed : null;
  }

  let lineCount: number | null = null;
  if (typeValue === "object" && isRecord(objectValue)) {
    const linesValue = objectValue.lines;
    if (
      Array.isArray(linesValue) &&
      linesValue.every((line) => isHeatmapLineCandidate(line))
    ) {
      lineCount = linesValue.length;
    }
  }

  return { lineCount, textDelta };
}
