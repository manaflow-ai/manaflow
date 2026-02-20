import { beforeAll, describe, expect, it } from "vitest";
import { getGitDiff } from "./gitDiff";

describe.sequential.skip("getGitDiff - real repo (cmux PR 259)", () => {
  it("reads +2/-0 for README.md on PR branch", async () => {
    // Skip this test in CI because it requires Convex auth
    // TODO: Create a proper test setup for public repo testing
    const entries = await getGitDiff({
      baseRef: "main",
      headRef: "cmux/update-readme-to-bold-its-last-line-rpics",
      repoFullName: "manaflow-ai/manaflow",
      teamSlugOrId: "test-team",
      includeContents: true,
    } as unknown as Parameters<typeof getGitDiff>[0]);

    const readme = entries.find((e) => e.filePath === "README.md");
    expect(readme).toBeTruthy();
    expect(readme!.additions).toBe(2);
    expect(readme!.deletions).toBe(0);
  }, 180_000);
});
