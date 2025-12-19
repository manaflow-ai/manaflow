"use node";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { ConvexError, v } from "convex/values";
import {
  CrownEvaluationResponseSchema,
  CrownSummarizationResponseSchema,
  type CrownEvaluationCandidate,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
} from "@cmux/shared/convex-safe";
import { CLOUDFLARE_OPENAI_BASE_URL } from "@cmux/shared";
import { env } from "../../_shared/convex-env";
import { action } from "../_generated/server";

const DEFAULT_OPENAI_CROWN_MODEL = "gpt-5-mini";
const DEFAULT_ANTHROPIC_CROWN_MODEL = "claude-3-5-sonnet-20241022";

// Models that use OpenAI provider
const OPENAI_MODELS = ["gpt-5-mini", "gpt-4o", "gpt-4o-mini"];
// Models that use Anthropic provider
const ANTHROPIC_MODELS = [
  "claude-3-5-sonnet-20241022",
  "claude-sonnet-4-20250514",
  "claude-3-5-haiku-20241022",
];

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

function resolveCrownModel(customModel?: string): {
  provider: "openai" | "anthropic";
  model: LanguageModel;
} {
  const openaiKey = env.OPENAI_API_KEY;
  const anthropicKey = env.ANTHROPIC_API_KEY;

  // If a custom model is specified, use it
  if (customModel) {
    if (OPENAI_MODELS.includes(customModel)) {
      if (!openaiKey) {
        throw new ConvexError(
          `Crown evaluation model "${customModel}" requires an OpenAI API key`
        );
      }
      const openai = createOpenAI({
        apiKey: openaiKey,
        baseURL: CLOUDFLARE_OPENAI_BASE_URL,
      });
      return { provider: "openai", model: openai(customModel) };
    }

    if (ANTHROPIC_MODELS.includes(customModel)) {
      if (!anthropicKey) {
        throw new ConvexError(
          `Crown evaluation model "${customModel}" requires an Anthropic API key`
        );
      }
      const anthropic = createAnthropic({ apiKey: anthropicKey });
      return { provider: "anthropic", model: anthropic(customModel) };
    }

    // Unknown model, try to infer provider from name
    if (customModel.startsWith("gpt-") || customModel.startsWith("o1")) {
      if (!openaiKey) {
        throw new ConvexError(
          `Crown evaluation model "${customModel}" requires an OpenAI API key`
        );
      }
      const openai = createOpenAI({
        apiKey: openaiKey,
        baseURL: CLOUDFLARE_OPENAI_BASE_URL,
      });
      return { provider: "openai", model: openai(customModel) };
    }

    if (customModel.startsWith("claude-")) {
      if (!anthropicKey) {
        throw new ConvexError(
          `Crown evaluation model "${customModel}" requires an Anthropic API key`
        );
      }
      const anthropic = createAnthropic({ apiKey: anthropicKey });
      return { provider: "anthropic", model: anthropic(customModel) };
    }

    throw new ConvexError(
      `Unknown crown evaluation model: "${customModel}". Use an OpenAI (gpt-*) or Anthropic (claude-*) model.`
    );
  }

  // Default behavior: prefer OpenAI, fallback to Anthropic
  if (openaiKey) {
    const openai = createOpenAI({
      apiKey: openaiKey,
      baseURL: CLOUDFLARE_OPENAI_BASE_URL,
    });
    return { provider: "openai", model: openai(DEFAULT_OPENAI_CROWN_MODEL) };
  }

  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    return {
      provider: "anthropic",
      model: anthropic(DEFAULT_ANTHROPIC_CROWN_MODEL),
    };
  }

  throw new ConvexError(
    "Crown evaluation is not configured (missing OpenAI or Anthropic API key)"
  );
}

const DEFAULT_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

export interface CrownEvaluationOptions {
  customModel?: string;
  customSystemPrompt?: string;
}

export async function performCrownEvaluation(
  prompt: string,
  candidates: CrownEvaluationCandidate[],
  options?: CrownEvaluationOptions
): Promise<CrownEvaluationResponse> {
  const { model, provider } = resolveCrownModel(options?.customModel);

  const normalizedCandidates = candidates.map((candidate, idx) => {
    const resolvedIndex = candidate.index ?? idx;
    return {
      index: resolvedIndex,
      runId: candidate.runId,
      agentName: candidate.agentName,
      modelName:
        candidate.modelName ??
        candidate.agentName ??
        (candidate.runId ? `run-${candidate.runId}` : undefined) ??
        `candidate-${resolvedIndex}`,
      gitDiff: candidate.gitDiff,
      newBranch: candidate.newBranch ?? null,
    };
  });

  const evaluationData = {
    prompt,
    candidates: normalizedCandidates,
  };

  const evaluationPrompt = `You are evaluating code implementations from different AI models.

Here are the candidates to evaluate:
${JSON.stringify(evaluationData, null, 2)}

NOTE: The git diffs shown contain only actual code changes. Lock files, build artifacts, and other non-essential files have been filtered out.

Analyze these implementations and select the best one based on:
1. Code quality and correctness
2. Completeness of the solution
3. Following best practices
4. Actually having meaningful code changes (if one has no changes, prefer the one with changes)

Respond with a JSON object containing:
- "winner": the index (0-based) of the best implementation
- "reason": a brief explanation of why this implementation was chosen

Example response:
{"winner": 0, "reason": "Model claude/sonnet-4 provided a more complete implementation with better error handling and cleaner code structure."}

IMPORTANT: Respond ONLY with the JSON object, no other text.`;

  const systemPrompt = options?.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  try {
    const { object } = await generateObject({
      model,
      schema: CrownEvaluationResponseSchema,
      system: systemPrompt,
      prompt: evaluationPrompt,
      ...(provider === "openai" ? {} : { temperature: 0 }),
      maxRetries: 2,
    });

    return CrownEvaluationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Evaluation error", error);
    throw new ConvexError("Evaluation failed");
  }
}

export async function performCrownSummarization(
  prompt: string,
  gitDiff: string,
  options?: CrownEvaluationOptions
): Promise<CrownSummarizationResponse> {
  const { model, provider } = resolveCrownModel(options?.customModel);

  const summarizationPrompt = `You are an expert reviewer summarizing a pull request.

GOAL
- Explain succinctly what changed and why.
- Call out areas the user should review carefully.
- Provide a quick test plan to validate the changes.

CONTEXT
- User's original request:
${prompt}
- Relevant diffs (unified):
${gitDiff || "<no code changes captured>"}

INSTRUCTIONS
- Base your summary strictly on the provided diffs and request.
- Be specific about files and functions when possible.
- Prefer clear bullet points over prose. Keep it under ~300 words.
- If there are no code changes, say so explicitly and suggest next steps.

OUTPUT FORMAT (Markdown)
## PR Review Summary
- What Changed: bullet list
- Review Focus: bullet list (risks/edge cases)
- Test Plan: bullet list of practical steps
- Follow-ups: optional bullets if applicable
`;

  try {
    const { object } = await generateObject({
      model,
      schema: CrownSummarizationResponseSchema,
      system:
        "You are an expert reviewer summarizing pull requests. Provide a clear, concise summary following the requested format.",
      prompt: summarizationPrompt,
      ...(provider === "openai" ? {} : { temperature: 0 }),
      maxRetries: 2,
    });

    return CrownSummarizationResponseSchema.parse(object);
  } catch (error) {
    console.error("[convex.crown] Summarization error", error);
    throw new ConvexError("Summarization failed");
  }
}

export const evaluate = action({
  args: {
    prompt: v.string(),
    candidates: v.array(CrownEvaluationCandidateValidator),
    teamSlugOrId: v.string(),
    customModel: v.optional(v.string()),
    customSystemPrompt: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return performCrownEvaluation(args.prompt, args.candidates, {
      customModel: args.customModel,
      customSystemPrompt: args.customSystemPrompt,
    });
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
    customModel: v.optional(v.string()),
    customSystemPrompt: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    return performCrownSummarization(args.prompt, args.gitDiff, {
      customModel: args.customModel,
      customSystemPrompt: args.customSystemPrompt,
    });
  },
});
