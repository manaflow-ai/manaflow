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

const DEFAULT_SYSTEM_PROMPT =
  "You select the best implementation from structured diff inputs and explain briefly why.";

const CrownEvaluationCandidateValidator = v.object({
  runId: v.optional(v.string()),
  agentName: v.optional(v.string()),
  modelName: v.optional(v.string()),
  gitDiff: v.string(),
  newBranch: v.optional(v.union(v.string(), v.null())),
  index: v.optional(v.number()),
});

// Map user-friendly model names to provider-specific model IDs
const MODEL_MAPPING: Record<string, { provider: "openai" | "anthropic"; modelId: string }> = {
  // OpenAI models
  "gpt-5-mini": { provider: "openai", modelId: "gpt-5-mini" },
  "gpt-5": { provider: "openai", modelId: "gpt-5" },
  "gpt-4.1": { provider: "openai", modelId: "gpt-4.1" },
  "o3": { provider: "openai", modelId: "o3" },
  "o4-mini": { provider: "openai", modelId: "o4-mini" },
  // Anthropic models
  "claude-opus-4": { provider: "anthropic", modelId: "claude-opus-4-20250514" },
  "claude-sonnet-4": { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
  "claude-3-5-sonnet-20241022": { provider: "anthropic", modelId: "claude-3-5-sonnet-20241022" },
  "claude-3-5-haiku-20241022": { provider: "anthropic", modelId: "claude-3-5-haiku-20241022" },
};

function resolveCrownModel(customModel?: string): {
  provider: "openai" | "anthropic";
  model: LanguageModel;
} {
  const requestedModel = customModel?.trim();

  // If custom model is specified, try to use it
  if (requestedModel && MODEL_MAPPING[requestedModel]) {
    const mapping = MODEL_MAPPING[requestedModel];
    if (mapping.provider === "openai") {
      const openaiKey = env.OPENAI_API_KEY;
      if (openaiKey) {
        const openai = createOpenAI({
          apiKey: openaiKey,
          baseURL: CLOUDFLARE_OPENAI_BASE_URL,
        });
        return { provider: "openai", model: openai(mapping.modelId) };
      }
    } else if (mapping.provider === "anthropic") {
      const anthropicKey = env.ANTHROPIC_API_KEY;
      if (anthropicKey) {
        const anthropic = createAnthropic({ apiKey: anthropicKey });
        return { provider: "anthropic", model: anthropic(mapping.modelId) };
      }
    }
    // If the required API key is not available, fall through to default behavior
    console.warn(
      `[convex.crown] Custom model ${requestedModel} requested but API key not available, falling back to default`
    );
  } else if (requestedModel) {
    console.warn(
      `[convex.crown] Custom model ${requestedModel} is not supported, falling back to default`
    );
  }

  // Default behavior: prefer Anthropic, fallback to OpenAI
  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    return {
      provider: "anthropic",
      model: anthropic(DEFAULT_ANTHROPIC_CROWN_MODEL),
    };
  }

  const openaiKey = env.OPENAI_API_KEY;
  if (openaiKey) {
    const openai = createOpenAI({
      apiKey: openaiKey,
      baseURL: CLOUDFLARE_OPENAI_BASE_URL,
    });
    return { provider: "openai", model: openai(DEFAULT_OPENAI_CROWN_MODEL) };
  }

  throw new ConvexError(
    "Crown evaluation is not configured (missing OpenAI or Anthropic API key)"
  );
}

export interface CrownSettings {
  crownModel?: string;
  crownSystemPrompt?: string;
}

export async function performCrownEvaluation(
  prompt: string,
  candidates: CrownEvaluationCandidate[],
  settings?: CrownSettings
): Promise<CrownEvaluationResponse> {
  const { model, provider } = resolveCrownModel(settings?.crownModel);
  const systemPrompt = settings?.crownSystemPrompt?.trim()
    ? settings.crownSystemPrompt
    : DEFAULT_SYSTEM_PROMPT;

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
  settings?: CrownSettings
): Promise<CrownSummarizationResponse> {
  const { model, provider } = resolveCrownModel(settings?.crownModel);

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
    crownModel: v.optional(v.string()),
    crownSystemPrompt: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const settings: CrownSettings = {
      crownModel: args.crownModel,
      crownSystemPrompt: args.crownSystemPrompt,
    };
    return performCrownEvaluation(args.prompt, args.candidates, settings);
  },
});

export const summarize = action({
  args: {
    prompt: v.string(),
    gitDiff: v.string(),
    teamSlugOrId: v.string(),
    crownModel: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const settings: CrownSettings = {
      crownModel: args.crownModel,
    };
    return performCrownSummarization(args.prompt, args.gitDiff, settings);
  },
});
