import { type GenerateObjectResult } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateBranchName,
  generateBranchNamesFromBase,
  generateNewBranchName,
  generatePRInfo,
  generateRandomId,
  generateUniqueBranchNames,
  generateUniqueBranchNamesFromTitle,
  getPRTitleFromTaskDescription,
  prGenerationSchema,
  resetGenerateObjectImplementation,
  setGenerateObjectImplementation,
  toKebabCase,
} from "./branch-name-generator";

const OPENAI_KEYS = { OPENAI_API_KEY: "test-openai" };

function createMockResult<RESULT>(
  object: RESULT
): GenerateObjectResult<RESULT> {
  return {
    object,
    reasoning: undefined,
    finishReason: "stop",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    },
    warnings: undefined,
    request: { body: undefined },
    response: {
      id: "mock-response",
      timestamp: new Date(),
      modelId: "mock-model",
      headers: undefined,
    },
    providerMetadata: undefined,
    toJsonResponse: (init?: ResponseInit) =>
      new Response(JSON.stringify(object), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        ...init,
      }),
  };
}

afterEach(() => {
  resetGenerateObjectImplementation();
});

describe("toKebabCase", () => {
  it("converts camelCase to kebab-case", () => {
    expect(toKebabCase("camelCaseString")).toBe("camel-case-string");
  });

  it("handles acronyms and trailing hyphen", () => {
    expect(toKebabCase("HTTPServer")).toBe("http-server");
    expect(toKebabCase("fix-bug-")).toBe("fix-bug");
  });
});

describe("generateRandomId", () => {
  it("produces five lowercase alphanumeric characters", () => {
    const id = generateRandomId();
    expect(id).toMatch(/^[a-z0-9]{5}$/);
  });
});

describe("generateBranchName", () => {
  it("prefixes with cmux and appends random id", () => {
    const name = generateBranchName("Fix auth bug");
    expect(name).toMatch(/^cmux\/fix-auth-bug-[a-z0-9]{5}$/);
  });
});

describe("generatePRInfo", () => {
  it("uses fallback when no API keys available", async () => {
    const result = await generatePRInfo("Fix authentication bug", {});
    expect(result.usedFallback).toBe(true);
    expect(result.providerName).toBeNull();
    expect(result.branchName).toMatch(/^fix-authentication-bug/);
  });

  it("sanitizes provider output", async () => {
    setGenerateObjectImplementation(async (_options) => {
      const parsed = prGenerationSchema.parse({
        branchName: "Fix Auth Flow!",
        prTitle: "  Improve login flow  ",
      });
      return createMockResult(parsed);
    });

    const result = await generatePRInfo("Fix login", OPENAI_KEYS);
    expect(result.usedFallback).toBe(false);
    expect(result.providerName).toBe("OpenAI");
    expect(result.branchName).toBe("fix-auth-flow");
    expect(result.prTitle).toBe("Improve login flow");
  });

  it("falls back when provider throws", async () => {
    setGenerateObjectImplementation(async (_options) => {
      throw new Error("LLM error");
    });

    const result = await generatePRInfo("Refactor auth", OPENAI_KEYS);
    expect(result.usedFallback).toBe(true);
    expect(result.branchName).toBe("refactor-auth");
  });
});

describe("generateBranchNames", () => {
  it("builds base branch name with LLM assistance", async () => {
    setGenerateObjectImplementation(async (_options) => {
      const parsed = prGenerationSchema.parse({
        branchName: "add-auth-logging",
        prTitle: "Add auth logging",
      });
      return createMockResult(parsed);
    });

    const { baseBranchName } = await generateNewBranchName(
      "Add auditing to auth",
      OPENAI_KEYS
    );
    expect(baseBranchName).toBe("cmux/add-auth-logging");
  });

  it("respects provided unique id for single branch", async () => {
    const { branchName } = await generateNewBranchName(
      "Fix bug",
      {},
      "abcde"
    );
    expect(branchName).toBe("cmux/fix-bug-abcde");
  });

  it("generates the requested number of unique branches", async () => {
    const { branchNames } = await generateUniqueBranchNames(
      "Improve docs",
      3,
      {}
    );
    expect(branchNames).toHaveLength(3);
    const unique = new Set(branchNames);
    expect(unique.size).toBe(3);
  });

  it("uses supplied unique id for the first branch when generating multiples", async () => {
    const { branchNames } = await generateUniqueBranchNames(
      "Improve logging",
      2,
      {},
      "abcde"
    );
    expect(branchNames[0]).toBe("cmux/improve-logging-abcde");
    expect(branchNames[1]).toMatch(/^cmux\/improve-logging-[a-z0-9]{5}$/);
  });

  it("builds multiple branches from existing title", () => {
    const names = generateUniqueBranchNamesFromTitle("Fix Bug", 2);
    expect(names).toHaveLength(2);
    names.forEach((name) =>
      expect(name).toMatch(/^cmux\/fix-bug-[a-z0-9]{5}$/)
    );
  });
});

describe("generateBranchNamesFromBase", () => {
  it("ensures custom id is first", () => {
    const names = generateBranchNamesFromBase("cmux/test", 2, "abcde");
    expect(names[0]).toBe("cmux/test-abcde");
  });
});

describe("getPRTitleFromTaskDescription", () => {
  it("returns sanitized title from provider", async () => {
    setGenerateObjectImplementation(async (_options) => {
      const parsed = prGenerationSchema.parse({
        branchName: "refactor-auth",
        prTitle: "Refactor auth module",
      });
      return createMockResult(parsed);
    });

    const { title, providerName } = await getPRTitleFromTaskDescription(
      "Refactor auth module",
      OPENAI_KEYS
    );
    expect(providerName).toBe("OpenAI");
    expect(title).toBe("Refactor auth module");
  });
});
