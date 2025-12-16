import type {
  ReviewStrategy,
  StrategyPrepareContext,
  StrategyPrepareResult,
  StrategyProcessContext,
  StrategyRunResult,
  StrategyAnnotation,
} from "../core/types";

function buildPrompt(context: StrategyPrepareContext): string {
  const diffForPrompt =
    context.options.showDiffLineNumbers || context.options.showContextLineNumbers
      ? context.formattedDiff.join("\n")
      : context.diff || "(no diff output)";

  return `You are preparing a review heatmap for the file "${context.filePath}".
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
${diffForPrompt}
\`\`\``;
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
          shouldReviewWhy: { type: "string" },
          mostImportantWord: { type: "string" },
        },
        required: ["line", "mostImportantWord"],
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
  const prompt = buildPrompt(context);
  return {
    prompt,
    outputSchema,
  };
}

async function process(
  context: StrategyProcessContext
): Promise<StrategyRunResult> {
  let parsedResponse: {
    lines: Array<{
      line: string;
      shouldBeReviewedScore?: number;
      shouldReviewWhy?: string;
      mostImportantWord: string;
    }>;
  };

  try {
    parsedResponse = JSON.parse(context.responseText);
  } catch (error) {
    console.error(
      `[heatmap] Failed to parse response for ${context.filePath}:`,
      error
    );
    return {
      rawResponse: context.responseText,
    };
  }

  const annotations: StrategyAnnotation[] = parsedResponse.lines
    .filter((line) => line.shouldBeReviewedScore && line.shouldBeReviewedScore > 0)
    .map((line) => ({
      lineContent: line.line,
      shouldBeReviewedScore: line.shouldBeReviewedScore ?? 0,
      mostImportantWord: line.mostImportantWord,
      comment: line.shouldReviewWhy ?? null,
    }));

  return {
    rawResponse: context.responseText,
    annotations,
  };
}

export const heatmapStrategy: ReviewStrategy = {
  id: "heatmap",
  displayName: "Heatmap (structured diff analysis)",
  prepare,
  process,
};
