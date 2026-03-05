import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText, type LanguageModel } from "ai";
import {
  CLOUDFLARE_ANTHROPIC_BASE_URL,
  CLOUDFLARE_GEMINI_BASE_URL,
  CLOUDFLARE_OPENAI_BASE_URL,
  normalizeAnthropicBaseUrl,
} from "@cmux/shared";
import { z } from "zod";
import { env } from "./www-env";

export function toKebabCase(input: string): string {
  return (
    input
      .replace(/\b([A-Z]{2,})s(?=\b|[^a-z])/g, "$1S")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .substring(0, 50)
  );
}

export function generateRandomId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 5; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

import { DEFAULT_BRANCH_PREFIX as _DEFAULT_BRANCH_PREFIX, MAX_BRANCH_NAME_LENGTH as _MAX_BRANCH_NAME_LENGTH } from "@cmux/shared";
export const DEFAULT_BRANCH_PREFIX = _DEFAULT_BRANCH_PREFIX;
export const MAX_BRANCH_NAME_LENGTH = _MAX_BRANCH_NAME_LENGTH;

function truncateBaseBranchName(baseBranchName: string): string {
  const maxBaseLength = MAX_BRANCH_NAME_LENGTH - 1 - 5;
  return baseBranchName.substring(0, maxBaseLength).replace(/-+$/g, "");
}

export function generateBranchName(prTitle: string, branchPrefix: string = DEFAULT_BRANCH_PREFIX): string {
  const kebabTitle = toKebabCase(prTitle);
  const baseBranchName = truncateBaseBranchName(`${branchPrefix}${kebabTitle}`);
  const randomId = generateRandomId();
  const separator = baseBranchName.length > 0 ? "-" : "";
  return `${baseBranchName}${separator}${randomId}`;
}

export const prGenerationSchema = z.object({
  branchName: z
    .string()
    .describe(
      "A SHORT lowercase hyphenated branch name (2-4 words max, e.g., 'fix-auth', 'add-profile', 'update-deps')"
    ),
  prTitle: z
    .string()
    .describe(
      "A human-readable PR title (5-10 words) that summarizes the task"
    ),
});

export type PRGeneration = z.infer<typeof prGenerationSchema>;

// ApiKeys type kept for backward compatibility with function signatures
type ApiKeys = Record<string, string>;

interface PRInfoResult extends PRGeneration {
  providerName: string | null;
  usedFallback: boolean;
}

type GenerateObjectOptions = Parameters<typeof generateObject>[0];
type GenerateObjectReturn = ReturnType<typeof generateObject>;

let generateObjectImpl: typeof generateObject = generateObject;

export function setGenerateObjectImplementation(
  fn: (options: GenerateObjectOptions) => GenerateObjectReturn
): void {
  generateObjectImpl = ((options) => fn(options)) as typeof generateObject;
}

export function resetGenerateObjectImplementation(): void {
  generateObjectImpl = generateObject;
}

function sanitizeBranchComponent(value: string): string {
  const sanitized = toKebabCase(value);
  return sanitized || "feature-update";
}

function sanitizePrTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed || "feature update";
}

function getFallbackInfo(taskDescription: string): PRInfoResult {
  const words = taskDescription.split(/\s+/).slice(0, 5).join(" ");
  return {
    branchName: sanitizeBranchComponent(words || "feature update"),
    prTitle: sanitizePrTitle(words || "feature update"),
    providerName: null,
    usedFallback: true,
  };
}

/**
 * Check if the given base URL is a Bedrock-backed proxy.
 * These proxies don't support tool_choice.disable_parallel_tool_use.
 * We detect cmux proxy URLs which route to AWS Bedrock.
 */
function isBedrockBackedProxy(baseUrl: string): boolean {
  // cmux proxy URLs (production and local dev) route to Bedrock
  if (baseUrl.includes("cmux.dev/api/anthropic")) return true;
  if (baseUrl.includes("localhost") && baseUrl.includes("/api/anthropic")) return true;
  // Convex HTTP endpoints also route to Bedrock
  if (baseUrl.includes(".convex.site")) return true;
  return false;
}

type ModelConfig = {
  model: LanguageModel;
  providerName: string;
  useTextMode: boolean; // Use generateText instead of generateObject for Bedrock compatibility
};

/**
 * Get model and provider using PLATFORM credentials only.
 * This is for internal platform AI services (branch names, PR titles, etc.)
 * and should NOT use user/team API keys.
 */
function getModelAndProvider(): ModelConfig | null {
  // Use platform credentials from environment variables only
  // Note: AIGATEWAY_* accessed via process.env to support custom AI gateway configurations
  const geminiKey = env.GEMINI_API_KEY;
  if (geminiKey) {
    const google = createGoogleGenerativeAI({
      apiKey: geminiKey,
      baseURL:
        process.env.AIGATEWAY_GEMINI_BASE_URL || CLOUDFLARE_GEMINI_BASE_URL,
    });
    return {
      model: google("gemini-2.5-flash"),
      providerName: "Gemini",
      useTextMode: false,
    };
  }

  const openaiKey = env.OPENAI_API_KEY;
  if (openaiKey) {
    const openai = createOpenAI({
      apiKey: openaiKey,
      baseURL:
        process.env.AIGATEWAY_OPENAI_BASE_URL || CLOUDFLARE_OPENAI_BASE_URL,
    });
    return {
      model: openai("gpt-5-nano"),
      providerName: "OpenAI",
      useTextMode: false,
    };
  }

  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const rawAnthropicBaseUrl =
      process.env.AIGATEWAY_ANTHROPIC_BASE_URL ||
      CLOUDFLARE_ANTHROPIC_BASE_URL;
    const anthropic = createAnthropic({
      apiKey: anthropicKey,
      baseURL: normalizeAnthropicBaseUrl(rawAnthropicBaseUrl).forAiSdk,
    });
    // Use text mode for Bedrock-backed proxies to avoid tool_choice.disable_parallel_tool_use
    const useTextMode = isBedrockBackedProxy(rawAnthropicBaseUrl);
    return {
      model: anthropic("claude-haiku-4-5-20251001"),
      providerName: "Anthropic",
      useTextMode,
    };
  }

  return null;
}

export function mergeApiKeysWithEnv(apiKeys: Record<string, string>): ApiKeys {
  const merged: ApiKeys = { ...apiKeys };

  if (!merged.OPENAI_API_KEY && env.OPENAI_API_KEY) {
    merged.OPENAI_API_KEY = env.OPENAI_API_KEY;
  }
  if (!merged.GEMINI_API_KEY && env.GEMINI_API_KEY) {
    merged.GEMINI_API_KEY = env.GEMINI_API_KEY;
  }
  if (!merged.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    merged.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }

  return merged;
}

const PR_GENERATION_SYSTEM_PROMPT =
  "You are a helpful assistant that generates git branch names and PR titles. Generate a VERY SHORT branch name (2-4 words maximum, lowercase, hyphenated) and a concise PR title (5-10 words) that summarize the task. The branch name should be extremely concise and focus on the core action (e.g., 'fix-auth', 'add-logging', 'update-deps', 'refactor-api').";

const PR_GENERATION_TEXT_MODE_SYSTEM_PROMPT = `${PR_GENERATION_SYSTEM_PROMPT}

You MUST respond with ONLY a JSON object (no markdown, no explanation) containing exactly these fields:
- branchName: A SHORT lowercase hyphenated branch name (2-4 words max)
- prTitle: A human-readable PR title (5-10 words)

Example response: {"branchName": "add-ci-workflow", "prTitle": "Add GitHub CI workflow for automated testing"}`;

/**
 * Extract JSON from text response, handling potential markdown code blocks.
 */
function extractJsonFromText(text: string): unknown {
  // Try to find JSON object in response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }
  return JSON.parse(jsonMatch[0]);
}

export async function generatePRInfo(
  taskDescription: string,
  _apiKeys?: ApiKeys
): Promise<PRInfoResult> {
  const fallbackInfo = getFallbackInfo(taskDescription);
  // Use platform credentials only - not user/team API keys
  const modelConfig = getModelAndProvider();

  if (!modelConfig) {
    console.warn(
      "[BranchNameGenerator] No platform API keys available, using fallback"
    );
    return fallbackInfo;
  }

  const { model, providerName, useTextMode } = modelConfig;

  try {
    let object: PRGeneration;

    if (useTextMode) {
      // Use generateText with plain text mode for Bedrock-backed proxies
      // This avoids tool_choice.disable_parallel_tool_use which Bedrock rejects
      console.info(
        `[BranchNameGenerator] Using text mode for Bedrock-compatible generation`
      );
      const result = await generateText({
        model,
        system: PR_GENERATION_TEXT_MODE_SYSTEM_PROMPT,
        prompt: `Task: ${taskDescription}`,
        maxRetries: 2,
        ...(providerName === "OpenAI" ? {} : { temperature: 0.3 }),
      });

      const parsed = extractJsonFromText(result.text);
      const validated = prGenerationSchema.parse(parsed);
      object = validated;
    } else {
      // Use generateObject for providers that support tool_choice properly
      const result = await generateObjectImpl({
        model,
        schema: prGenerationSchema,
        system: PR_GENERATION_SYSTEM_PROMPT,
        prompt: `Task: ${taskDescription}`,
        maxRetries: 2,
        ...(providerName === "OpenAI" ? {} : { temperature: 0.3 }),
      });
      object = result.object;
    }

    const sanitizedBranch = sanitizeBranchComponent(object.branchName);
    const sanitizedTitle = sanitizePrTitle(object.prTitle);

    console.info(
      `[BranchNameGenerator] Generated via ${providerName}${useTextMode ? " (text mode)" : ""}: branch="${sanitizedBranch}", title="${sanitizedTitle}"`
    );

    return {
      branchName: sanitizedBranch,
      prTitle: sanitizedTitle,
      providerName,
      usedFallback: false,
    };
  } catch (error) {
    console.error(`[BranchNameGenerator] ${providerName} API error:`, error);
    return fallbackInfo;
  }
}

export async function generatePRTitle(
  taskDescription: string,
  apiKeys: ApiKeys
): Promise<{ title: string; usedFallback: boolean; providerName: string | null }> {
  const info = await generatePRInfo(taskDescription, apiKeys);
  return {
    title: info.prTitle,
    usedFallback: info.usedFallback,
    providerName: info.providerName,
  };
}

export async function generateBranchBaseName(
  taskDescription: string,
  apiKeys: ApiKeys,
  branchPrefix: string = DEFAULT_BRANCH_PREFIX
): Promise<{
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const info = await generatePRInfo(taskDescription, apiKeys);
  const baseBranchName = `${branchPrefix}${info.branchName}`;
  return {
    baseBranchName,
    prTitle: info.prTitle,
    usedFallback: info.usedFallback,
    providerName: info.providerName,
  };
}

export async function getPRTitleFromTaskDescription(
  taskDescription: string,
  apiKeys: ApiKeys
): Promise<{ title: string; usedFallback: boolean; providerName: string | null }> {
  return generatePRTitle(taskDescription, apiKeys);
}

export function generateBranchNamesFromBase(
  baseBranchName: string,
  count: number,
  firstId?: string
): string[] {
  const truncatedBaseBranchName = truncateBaseBranchName(baseBranchName);
  const separator = truncatedBaseBranchName.length > 0 ? "-" : "";
  const ids = new Set<string>();
  if (firstId) {
    ids.add(firstId);
  }
  while (ids.size < count) {
    ids.add(generateRandomId());
  }
  return Array.from(ids).map(
    (id) => `${truncatedBaseBranchName}${separator}${id}`
  );
}

export function generateUniqueBranchNamesFromTitle(
  prTitle: string,
  count: number,
  branchPrefix: string = DEFAULT_BRANCH_PREFIX
): string[] {
  const kebabTitle = toKebabCase(prTitle);
  const baseBranchName = `${branchPrefix}${kebabTitle}`;
  return generateBranchNamesFromBase(baseBranchName, count);
}

export async function generateNewBranchName(
  taskDescription: string,
  apiKeys: ApiKeys,
  uniqueId?: string,
  branchPrefix: string = DEFAULT_BRANCH_PREFIX
): Promise<{
  branchName: string;
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const { baseBranchName, prTitle, usedFallback, providerName } =
    await generateBranchBaseName(taskDescription, apiKeys, branchPrefix);
  const [branchName] = generateBranchNamesFromBase(
    baseBranchName,
    1,
    uniqueId
  );
  return { branchName, baseBranchName, prTitle, usedFallback, providerName };
}

export async function generateUniqueBranchNames(
  taskDescription: string,
  count: number,
  apiKeys: ApiKeys,
  firstId?: string,
  branchPrefix: string = DEFAULT_BRANCH_PREFIX
): Promise<{
  branchNames: string[];
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const { baseBranchName, prTitle, usedFallback, providerName } =
    await generateBranchBaseName(taskDescription, apiKeys, branchPrefix);
  return {
    branchNames: generateBranchNamesFromBase(
      baseBranchName,
      count,
      firstId
    ),
    baseBranchName,
    prTitle,
    usedFallback,
    providerName,
  };
}
