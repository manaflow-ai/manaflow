import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import {
  CLOUDFLARE_ANTHROPIC_BASE_URL,
  CLOUDFLARE_OPENAI_BASE_URL,
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

export function generateBranchName(prTitle: string): string {
  const kebabTitle = toKebabCase(prTitle);
  const randomId = generateRandomId();
  const separator = kebabTitle.endsWith("-") ? "" : "-";
  return `cmux/${kebabTitle}${separator}${randomId}`;
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

function getModelAndProvider(
  apiKeys: ApiKeys
): { model: LanguageModel; providerName: string } | null {
  if (apiKeys.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: apiKeys.OPENAI_API_KEY,
      baseURL: CLOUDFLARE_OPENAI_BASE_URL,
    });
    return {
      model: openai("gpt-5-nano"),
      providerName: "OpenAI",
    };
  }

  if (apiKeys.GEMINI_API_KEY) {
    const google = createGoogleGenerativeAI({
      apiKey: apiKeys.GEMINI_API_KEY,
    });
    return {
      model: google("gemini-2.5-flash"),
      providerName: "Gemini",
    };
  }

  if (apiKeys.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({
      apiKey: apiKeys.ANTHROPIC_API_KEY,
      baseURL: CLOUDFLARE_ANTHROPIC_BASE_URL,
    });
    return {
      model: anthropic("claude-3-5-haiku-20241022"),
      providerName: "Anthropic",
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

  return merged;
}

export async function generatePRInfo(
  taskDescription: string,
  apiKeys: ApiKeys
): Promise<PRInfoResult> {
  const fallbackInfo = getFallbackInfo(taskDescription);
  const modelConfig = getModelAndProvider(apiKeys);

  if (!modelConfig) {
    console.warn(
      "[BranchNameGenerator] No API keys available, using environment fallback"
    );
    return fallbackInfo;
  }

  const { model, providerName } = modelConfig;

  try {
    const { object } = await generateObjectImpl({
      model,
      schema: prGenerationSchema,
      system:
        "You are a helpful assistant that generates git branch names and PR titles. Generate a VERY SHORT branch name (2-4 words maximum, lowercase, hyphenated) and a concise PR title (5-10 words) that summarize the task. The branch name should be extremely concise and focus on the core action (e.g., 'fix-auth', 'add-logging', 'update-deps', 'refactor-api').",
      prompt: `Task: ${taskDescription}`,
      maxRetries: 2,
      ...(providerName === "OpenAI" ? {} : { temperature: 0.3 }),
    });

    const sanitizedBranch = sanitizeBranchComponent(object.branchName);
    const sanitizedTitle = sanitizePrTitle(object.prTitle);

    console.info(
      `[BranchNameGenerator] Generated via ${providerName}: branch="${sanitizedBranch}", title="${sanitizedTitle}"`
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
  apiKeys: ApiKeys
): Promise<{
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const info = await generatePRInfo(taskDescription, apiKeys);
  const baseBranchName = `cmux/${info.branchName}`;
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
  const separator = baseBranchName.endsWith("-") ? "" : "-";
  const ids = new Set<string>();
  if (firstId) {
    ids.add(firstId);
  }
  while (ids.size < count) {
    ids.add(generateRandomId());
  }
  return Array.from(ids).map((id) => `${baseBranchName}${separator}${id}`);
}

export function generateUniqueBranchNamesFromTitle(
  prTitle: string,
  count: number
): string[] {
  const kebabTitle = toKebabCase(prTitle);
  const baseBranchName = `cmux/${kebabTitle}`;
  return generateBranchNamesFromBase(baseBranchName, count);
}

export async function generateNewBranchName(
  taskDescription: string,
  apiKeys: ApiKeys,
  uniqueId?: string
): Promise<{
  branchName: string;
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const { baseBranchName, prTitle, usedFallback, providerName } =
    await generateBranchBaseName(taskDescription, apiKeys);
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
  firstId?: string
): Promise<{
  branchNames: string[];
  baseBranchName: string;
  prTitle: string;
  usedFallback: boolean;
  providerName: string | null;
}> {
  const { baseBranchName, prTitle, usedFallback, providerName } =
    await generateBranchBaseName(taskDescription, apiKeys);
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
