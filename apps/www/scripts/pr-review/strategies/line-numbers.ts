import type {
  ReviewStrategy,
  StrategyPrepareContext,
  StrategyPrepareResult,
  StrategyProcessContext,
  StrategyRunResult,
} from "../core/types";

function buildPrompt(context: StrategyPrepareContext): string {
  const diffForPrompt =
    context.formattedDiff.length > 0
      ? context.formattedDiff.join("\n")
      : "(no diff output)";

  return `You are a senior engineer performing a focused pull request review, focusing only on the diffs in the file provided.
File path: ${context.filePath}
Return a JSON object of type { lines: { lineNumber: number, line?: string | null, shouldBeReviewedScore: number, shouldReviewWhy: string | null, mostImportantWord: string }[] }.
Use the line numbers from the diff provided to populate lineNumber. If the diff does not contain a number for a line, omit that line from the results.
If you decide to include a line's content, copy it exactly into the optional line field.
shouldBeReviewedScore is a number between 0.0 and 1.0 (always include, even if 0.0) that indicates how careful the reviewer should be when reviewing this line of code.
Anything that feels like it might be off or might warrant a comment should have a high score, even if it's technically correct.
shouldReviewWhy should be a concise (4-10 words) hint on why the reviewer should maybe review this line of code, but it shouldn't state obvious things, instead it should only be a hint for the reviewer as to what exactly you meant when you flagged it.
In most cases, the reason should follow a template like "<X> <verb> <Y>" (eg. "line is too long" or "code accesses sensitive data").
It should be understandable by a human and make sense (break the "X is Y" rule if it helps you make it more understandable).
mostImportantWord must always be provided and should identify the most critical word or identifier in the line. If you're unsure, pick the earliest relevant word or token.
Ugly code should be given a higher score.
Code that may be hard to read for a human should also be given a higher score.
Non-clean code too.
Only return lines that are actually interesting to review. Do not return lines that a human would not care about. But you should still be thorough and cover all interesting/suspicious lines.

The diff (with line numbers):
${diffForPrompt}`;
}

const outputSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineNumber: { type: "number" },
          line: { type: ["string", "null"] as const },
          shouldBeReviewedScore: { type: "number" },
          shouldReviewWhy: { type: ["string", "null"] as const },
          mostImportantWord: { type: "string" },
        },
        required: [
          "lineNumber",
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
  const prompt = buildPrompt(context);
  return {
    prompt,
    outputSchema,
  };
}

async function process(
  context: StrategyProcessContext
): Promise<StrategyRunResult> {
  return {
    rawResponse: context.responseText,
  };
}

export const lineNumbersStrategy: ReviewStrategy = {
  id: "line-numbers",
  displayName: "JSON (line numbers)",
  prepare,
  process,
};
