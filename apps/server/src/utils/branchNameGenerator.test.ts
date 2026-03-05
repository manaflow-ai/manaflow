import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRANCH_PREFIX,
  generateBranchNamesFromDescription,
} from "./branchNameGenerator";

describe("Branch name length enforcement - Server side (60 char limit)", () => {
  const MAX_BRANCH_NAME_LENGTH = 60;

  describe("generateBranchNamesFromDescription", () => {
    it("never exceeds 60 chars with default prefix", () => {
      const inputs = [
        "Fix authentication bug",
        "Implement very long feature with many words and details",
        "Add a super duper long feature description that might exceed limit",
      ];

      inputs.forEach((description) => {
        const results = generateBranchNamesFromDescription(description, 3);
        results.forEach((name) => {
          expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
          expect(name).toContain(DEFAULT_BRANCH_PREFIX);
        });
      });
    });

    it("produces short names for short descriptions without unnecessary truncation", () => {
      const result = generateBranchNamesFromDescription("Fix bug", 1);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/^dev\/fix-bug-[a-z0-9]{5}$/);
      expect(result[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles long prefix combined with long description", () => {
      const longPrefix = "my-very-long-prefix/";
      const results = generateBranchNamesFromDescription(
        "Fix authentication system",
        2,
        longPrefix,
      );
      results.forEach((name) => {
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        expect(name).toContain(longPrefix);
        expect(name).toMatch(/-[a-z0-9]{5}$/);
      });
    });

    it("includes 5-char random ID suffix for each branch", () => {
      const results = generateBranchNamesFromDescription("Fix bug", 3);
      results.forEach((name) => {
        const parts = name.split("-");
        const randomId = parts[parts.length - 1];
        expect(randomId).toHaveLength(5);
        expect(randomId).toMatch(/^[a-z0-9]{5}$/);
      });
    });

    it("generates requested count of unique branches", () => {
      const results = generateBranchNamesFromDescription("Fix bug", 5);
      expect(results).toHaveLength(5);
      const unique = new Set(results);
      expect(unique.size).toBe(5);
    });

    it("handles empty prefix", () => {
      const results = generateBranchNamesFromDescription(
        "Fix auth",
        2,
        "",
      );
      results.forEach((name) => {
        expect(name).toMatch(/^fix-auth-[a-z0-9]{5}$/);
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      });
    });

    it("handles special characters in description", () => {
      const results = generateBranchNamesFromDescription(
        "Fix @#$% auth bug!!!",
        2,
      );
      results.forEach((name) => {
        expect(name).toMatch(/^dev\/fix.*-[a-z0-9]{5}$/);
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      });
    });

    it("handles spaces and converts to kebab-case", () => {
      const results = generateBranchNamesFromDescription(
        "implement new authentication system",
        1,
      );
      expect(results[0]).toMatch(/^dev\/implement-new-authentication-system-[a-z0-9]{5}$/);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("respects 60 char limit even with longest base name", () => {
      // Create a description that, when converted to kebab case, could exceed 50 chars
      const longDescription =
        "This is an extremely long and detailed description about authentication and authorization changes";
      const results = generateBranchNamesFromDescription(
        longDescription,
        2,
      );
      results.forEach((name) => {
        expect(name.length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
        expect(name).toMatch(/-[a-z0-9]{5}$/);
      });
    });

    it("handles empty description gracefully", () => {
      const results = generateBranchNamesFromDescription("", 1);
      expect(results).toHaveLength(1);
      // Implementation uses "feature-update" as fallback for empty description
      expect(results[0]).toMatch(/^dev\/feature-update-[a-z0-9]{5}$/);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles whitespace-only description", () => {
      const results = generateBranchNamesFromDescription("   ", 1);
      expect(results).toHaveLength(1);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles only special characters", () => {
      const results = generateBranchNamesFromDescription("@#$%^&*()", 1);
      expect(results).toHaveLength(1);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles reasonable prefix with long description", () => {
      // Using a reasonable prefix that allows the total to fit within 60 chars
      const reasonablePrefix = "dev/";
      const description = "Update authentication system";
      const results = generateBranchNamesFromDescription(
        description,
        1,
        reasonablePrefix,
      );
      expect(results).toHaveLength(1);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(results[0]).toContain(reasonablePrefix);
    });

    it("handles camelCase and converts correctly", () => {
      const results = generateBranchNamesFromDescription(
        "fixAuthenticationBug",
        1,
      );
      expect(results[0]).toMatch(/^dev\/fix.*-[a-z0-9]{5}$/);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("handles mixed input (spaces, camelCase, special chars)", () => {
      const results = generateBranchNamesFromDescription(
        "Fix MyAuthBug with @#$ special characters!!!",
        1,
      );
      expect(results[0]).toMatch(/^dev\/.*-[a-z0-9]{5}$/);
      expect(results[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
    });

    it("generates unique branches on multiple calls", () => {
      const results1 = generateBranchNamesFromDescription("Fix bug", 1);
      const results2 = generateBranchNamesFromDescription("Fix bug", 1);
      // Both should respect the limit, but IDs should be different (with high probability)
      expect(results1[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      expect(results2[0].length).toBeLessThanOrEqual(MAX_BRANCH_NAME_LENGTH);
      // IDs should be different (base names are the same but random IDs differ)
      const id1 = results1[0].split("-").pop();
      const id2 = results2[0].split("-").pop();
      expect(id1).not.toBe(id2);
    });
  });
});
