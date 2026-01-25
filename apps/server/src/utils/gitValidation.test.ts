import { describe, expect, it } from "vitest";
import {
  assertSafeRepoUrl,
  assertSafeWorkspaceName,
  assertValidBranchName,
  normalizeGitHubRepoUrl,
} from "./gitValidation";

describe("gitValidation", () => {
  it("normalizes GitHub repo URLs and strips credentials", () => {
    const normalized = normalizeGitHubRepoUrl(
      "https://x-access-token:abcd@github.com/octocat/hello-world.git"
    );
    expect(normalized).toEqual({
      repoUrl: "https://github.com/octocat/hello-world.git",
      repoFullName: "octocat/hello-world",
    });
  });

  it("rejects invalid GitHub repo URLs", () => {
    const normalized = normalizeGitHubRepoUrl("https://example.com/not-git");
    expect(normalized).toBeNull();
  });

  it("accepts valid branch names", () => {
    expect(assertValidBranchName("main")).toBe("main");
    expect(assertValidBranchName("feature/test")).toBe("feature/test");
    expect(assertValidBranchName("release-1.0")).toBe("release-1.0");
  });

  it("rejects unsafe branch names", () => {
    expect(() => assertValidBranchName("bad branch")).toThrow();
    expect(() => assertValidBranchName("-evil")).toThrow();
    expect(() => assertValidBranchName("feature..oops")).toThrow();
    expect(() => assertValidBranchName("main~1")).toThrow();
  });

  it("rejects repo URLs with unsafe characters", () => {
    expect(() => assertSafeRepoUrl("https://github.com/a/b.git\"")).toThrow();
    expect(() => assertSafeRepoUrl("https://github.com/a/b.git\n")).toThrow();
  });

  it("rejects unsafe workspace names", () => {
    expect(() => assertSafeWorkspaceName("../evil")).toThrow();
    expect(() => assertSafeWorkspaceName("path/with/slash")).toThrow();
  });
});
