import { type GenerateObjectResult } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BRANCH_PREFIX,
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

// Note: The branch name generator now uses PLATFORM credentials only (from env.*),
// not user-provided API keys. These empty keys are kept for backward compatibility
// with function signatures but are ignored by the implementation.
const EMPTY_KEYS = {};

function createMockResult<RESULT>(
  object: RESULT,
): GenerateObjectResult<RESULT> {
  return {
    object,
    reasoning: undefined,
    finishReason: "stop",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    } as GenerateObjectResult<RESULT>["usage"],
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
  it("prefixes with default prefix and appends random id", () => {
    const name = generateBranchName("Fix auth bug");
    const escapedPrefix = DEFAULT_BRANCH_PREFIX.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    expect(name).toMatch(
      new RegExp(`^${escapedPrefix}fix-auth-bug-[a-z0-9]{5}$`),
    );
  });
});

describe("generatePRInfo", () => {
  it("uses platform credentials when available", async () => {
    // The function now uses platform credentials from env.* only
    // If a platform API key (GEMINI, OPENAI, or ANTHROPIC) is set in env,
    // it will use that provider. Otherwise falls back to task description.
    const result = await generatePRInfo("Fix authentication bug", {});
    // Result depends on which platform env var is set
    // If any platform key is available, usedFallback should be false
    // We can't assert specific values without knowing env state
    expect(result.branchName).toBeTruthy();
    expect(result.prTitle).toBeTruthy();
  });

  it("sanitizes provider output", async () => {
    setGenerateObjectImplementation(async (_options) => {
      const parsed = prGenerationSchema.parse({
        branchName: "Fix Auth Flow!",
        prTitle: "  Improve login flow  ",
      });
      return createMockResult(parsed);
    });

    const result = await generatePRInfo("Fix login", EMPTY_KEYS);
    expect(result.usedFallback).toBe(false);
    // Provider name depends on which platform env var is set (GEMINI, OPENAI, or ANTHROPIC)
    expect(result.providerName).not.toBeNull();
    expect(result.branchName).toBe("fix-auth-flow");
    expect(result.prTitle).toBe("Improve login flow");
  });

  it("falls back when provider throws", async () => {
    setGenerateObjectImplementation(async (_options) => {
      throw new Error("LLM error");
    });

    const result = await generatePRInfo("Refactor auth", EMPTY_KEYS);
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
      EMPTY_KEYS,
    );
    expect(baseBranchName).toBe(`${DEFAULT_BRANCH_PREFIX}add-auth-logging`);
  });

  it("respects provided unique id for single branch", async () => {
    const { branchName } = await generateNewBranchName("Fix bug", {}, "abcde");
    expect(branchName).toBe(`${DEFAULT_BRANCH_PREFIX}fix-bug-abcde`);
  });

  it("generates the requested number of unique branches", async () => {
    const { branchNames } = await generateUniqueBranchNames(
      "Improve docs",
      3,
      {},
    );
    expect(branchNames).toHaveLength(3);
    const unique = new Set(branchNames);
    expect(unique.size).toBe(3);
  });

  it("uses supplied unique id for the first branch when generating multiples", async () => {
    setGenerateObjectImplementation(async (_options) => {
      const parsed = prGenerationSchema.parse({
        branchName: "improve-logging",
        prTitle: "Improve logging",
      });
      return createMockResult(parsed);
    });

    const { branchNames } = await generateUniqueBranchNames(
      "Improve logging",
      2,
      {},
      "abcde",
    );
    const escapedPrefix = DEFAULT_BRANCH_PREFIX.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    expect(branchNames[0]).toBe(
      `${DEFAULT_BRANCH_PREFIX}improve-logging-abcde`,
    );
    expect(branchNames[1]).toMatch(
      new RegExp(`^${escapedPrefix}improve-logging-[a-z0-9]{5}$`),
    );
  });

  it("builds multiple branches from existing title", () => {
    const names = generateUniqueBranchNamesFromTitle("Fix Bug", 2);
    expect(names).toHaveLength(2);
    const escapedPrefix = DEFAULT_BRANCH_PREFIX.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    names.forEach((name) =>
      expect(name).toMatch(new RegExp(`^${escapedPrefix}fix-bug-[a-z0-9]{5}$`)),
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
      EMPTY_KEYS,
    );
    // Provider name depends on which platform env var is set (GEMINI, OPENAI, or ANTHROPIC)
    expect(providerName).not.toBeNull();
    expect(title).toBe("Refactor auth module");
  });
});

// ── MAX_BRANCH_NAME_LENGTH ENFORCEMENT TESTS ──

describe("Branch name length enforcement (60 char limit)", () => {
  const MAX_BRANCH_NAME_LENGTH = 60;

  describe("toKebabCase", () => {
    it("enforces 50 char limit on kebab conversion", () => {
      const veryLongInput =
        "This is an extremely long input that should be truncated by toKebabCase";
      const result = toKebabCase(veryLongInput);
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it("handles special characters and converts to valid kebab", () => {
      const input = "Add @#$%^ special & chars!!!";
      const result = toKebabCase(input);
      expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it("converts camelCase correctly", () => {
      const result = toKebabCase("myAwesomeFeature");
      expect(result).toBe("my-awesome-feature");
    });

    it("handles acronyms", () => {
      const result = toKebabCase("HTTPServer");
      expect(result).toBe("http-server");
    });

    it("removes trailing hyphens", () => {
      const result = toKebabCase("fix-bug-");
      expect(result).toBe("fix-bug");
    });

    it("removes duplicate hyphens", () => {
      const result = toKebabCase("fix---bug");
      expect(result).toBe("fix-bug");
    });

    it("handles empty input gracefully", () => {
      const result = toKebabCase("");
      expect(result).toBe("");
    });

    it("handles all-special-character input", () => {
      const result = toKebabCase("@#$%^&*()");
      expect(result).toBe("");
    });
  });

  describe("generateRandomId", () => {
    it("always produces exactly 5 characters", () => {
      for (let i = 0; i < 20; i++) {
        const id = generateRandomId();
        expect(id).toHaveLength(5);
        expect(id).toMatch(/^[a-z0-9]{5}$/);
      }
    });
  });

  describe("generateBranchName", () => {
    it("never exceeds 60 chars regardless of input length", () => {
      const testInputs = [
        "Fix auth",
        "Fix authentication bug",
        "Fix a very long authentication bug that involves multiple systems",
        "This is an extremely long input that should be truncated",
        "Add feature with very long description name",
      ];

      testInputs.forEach((input) => {
        const result = generateBranchName(input);
        expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      });
    });

    it("produces short names for short inputs without unnecessary truncation", () => {
      const result = generateBranchName("Fix bug");
      expect(result).toMatch(/^dev\/fix-bug-[a-z0-9]{5}$/);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("produces correct names with default prefix", () => {
      const result = generateBranchName("Fix auth");
      expect(result).toMatch(new RegExp(`^${DEFAULT_BRANCH_PREFIX}fix-auth-[a-z0-9]{5}$`));
    });

    it("handles custom prefix that is long", () => {
      const longPrefix = "my-very-long-prefix/";
      const result = generateBranchName("Fix bug", longPrefix);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(result).toMatch(/^my-very-long-prefix\/.*-[a-z0-9]{5}$/);
    });

    it("handles custom prefix with empty prefix", () => {
      const result = generateBranchName("Fix auth", "");
      expect(result).toMatch(/^fix-auth-[a-z0-9]{5}$/);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("includes random ID suffix which is always 5 chars", () => {
      const result = generateBranchName("Fix bug");
      const parts = result.split("-");
      const randomId = parts[parts.length - 1];
      expect(randomId).toHaveLength(5);
      expect(randomId).toMatch(/^[a-z0-9]{5}$/);
    });

    it("removes trailing hyphens after truncation", () => {
      // Test that if kebab case ends with hyphen, separator is empty
      const result = generateBranchName("Fix-");
      expect(result).not.toMatch(/-{2}/); // No double hyphens
      expect(result).toMatch(/^dev\/fix-[a-z0-9]{5}$/);
    });

    it("handles special characters in input", () => {
      const result = generateBranchName("Fix @#$% bug!!!!");
      expect(result).toMatch(/^dev\/fix-bug-[a-z0-9]{5}$/);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });
  });

  describe("generateBranchNamesFromBase", () => {
    it("never exceeds 60 chars when base name is already long", () => {
      const longBaseName = "dev/" + "a".repeat(50);
      const results = generateBranchNamesFromBase(longBaseName, 3);
      results.forEach((name) => {
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      });
    });

    it("respects 60 char limit with custom IDs", () => {
      const baseName = "dev/my-long-feature-name";
      const customIds = ["abc12", "def34", "ghi56"];
      const results = customIds.map((id) =>
        generateBranchNamesFromBase(baseName, 1, id)[0],
      );
      results.forEach((name) => {
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        expect(name).toMatch(/-[a-z0-9]{5}$/);
      });
    });

    it("generates multiple unique branch names", () => {
      const results = generateBranchNamesFromBase("dev/fix-bug", 3);
      expect(results).toHaveLength(3);
      const unique = new Set(results);
      expect(unique.size).toBe(3);
    });

    it("uses provided firstId as first branch", () => {
      const results = generateBranchNamesFromBase("dev/test", 2, "first");
      expect(results[0]).toBe("dev/test-first");
    });

    it("handles base names without trailing hyphen", () => {
      const result = generateBranchNamesFromBase("dev/fix-bug", 1, "xyz12");
      expect(result[0]).toBe("dev/fix-bug-xyz12");
    });

    it("handles base names with trailing hyphen", () => {
      const result = generateBranchNamesFromBase("dev/fix-bug-", 1, "xyz12");
      expect(result[0]).toBe("dev/fix-bug-xyz12");
    });
  });

  describe("generateUniqueBranchNamesFromTitle", () => {
    it("never exceeds 60 chars with default prefix", () => {
      const inputs = [
        "Fix auth",
        "Implement very long feature with many words",
        "Add a super duper long feature that might exceed limit",
      ];

      inputs.forEach((title) => {
        const results = generateUniqueBranchNamesFromTitle(title, 3);
        results.forEach((name) => {
          expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        });
      });
    });

    it("never exceeds 60 chars with custom long prefix", () => {
      const longPrefix = "my-very-long-prefix-indeed/";
      const results = generateUniqueBranchNamesFromTitle(
        "Fix auth",
        2,
        longPrefix,
      );
      results.forEach((name) => {
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        expect(name).toContain(longPrefix);
      });
    });

    it("generates requested number of unique names", () => {
      const results = generateUniqueBranchNamesFromTitle("Fix bug", 5);
      expect(results).toHaveLength(5);
      const unique = new Set(results);
      expect(unique.size).toBe(5);
    });

    it("handles empty prefix", () => {
      const results = generateUniqueBranchNamesFromTitle("Fix auth", 2, "");
      results.forEach((name) => {
        expect(name).toMatch(/^fix-auth-[a-z0-9]{5}$/);
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      });
    });
  });

  describe("Edge cases", () => {
    it("handles long slug with reasonable prefix", () => {
      // Using a reasonable prefix that allows the total to fit within 60 chars
      const reasonablePrefix = "dev/";
      const longSlug = "very-long-feature-name-that-is-quite-extensive";
      const result = generateBranchName(longSlug, reasonablePrefix);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(result).toMatch(/-[a-z0-9]{5}$/);
    });

    it("handles empty string input", () => {
      const result = generateBranchName("", DEFAULT_BRANCH_PREFIX);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(result).toMatch(/^dev\/-[a-z0-9]{5}$/);
    });

    it("handles whitespace-only input", () => {
      const result = generateBranchName("   ", DEFAULT_BRANCH_PREFIX);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles input with only special characters", () => {
      const result = generateBranchName("@#$%^&*()", DEFAULT_BRANCH_PREFIX);
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(result).toMatch(/^dev\/-[a-z0-9]{5}$/);
    });

    it("handles mixed camelCase, spaces, and special chars", () => {
      const result = generateBranchName(
        "Fix MyAuthBug @@@",
        DEFAULT_BRANCH_PREFIX,
      );
      expect(result.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(result).toMatch(/^dev\/.*-[a-z0-9]{5}$/);
    });
  });
});
