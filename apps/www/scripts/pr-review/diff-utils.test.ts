import { describe, expect, it } from "vitest";
import { formatUnifiedDiffWithLineNumbers } from "./diff-utils";

describe("formatUnifiedDiffWithLineNumbers", () => {
  it("adds new-file line numbers to added lines", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/file.ts",
      "@@ -0,0 +1,3 @@",
      "+const a = 1;",
      "+const b = 2;",
      "+export const sum = () => a + b;",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff);

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/file.ts",
      "@@ -0,0 +1,3 @@",
      "+    1 | const a = 1;",
      "+    2 | const b = 2;",
      "+    3 | export const sum = () => a + b;",
    ]);
  });

  it("tracks old and new line numbers across hunks", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " import { foo } from \"./foo\";",
      "-const value = foo();",
      "+const value = foo();",
      "+const doubled = value * 2;",
      " export function useValue() {",
      "@@ -10,2 +11,2 @@ export function useValue() {",
      "-  return value;",
      "+  return doubled;",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      includeContextLineNumbers: false,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " import { foo } from \"./foo\";",
      "-    2 | const value = foo();",
      "+    2 | const value = foo();",
      "+    3 | const doubled = value * 2;",
      " export function useValue() {",
      "@@ -10,2 +11,2 @@ export function useValue() {",
      "-   10 |   return value;",
      "+   11 |   return doubled;",
    ]);
  });

  it("handles higher starting line numbers accurately", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -118,3 +118,4 @@ function example() {",
      "   const value = compute();",
      "-  logValue(value);",
      "+  logValue(value);",
      "+  notifyChange(value);",
      "   return value;",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      includeContextLineNumbers: false,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -118,3 +118,4 @@ function example() {",
      "   const value = compute();",
      "-  119 |   logValue(value);",
      "+  119 |   logValue(value);",
      "+  120 |   notifyChange(value);",
      "   return value;",
    ]);
  });

  it("preserves metadata lines like no-newline markers", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -3,4 +3,4 @@ export const sample = () => {",
      "   const first = 1;",
      "-  const second = 2;",
      "+  const second = 3;",
      "   return first + second;",
      " }",
      "\\ No newline at end of file",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      includeContextLineNumbers: false,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -3,4 +3,4 @@ export const sample = () => {",
      "   const first = 1;",
      "-    4 |   const second = 2;",
      "+    4 |   const second = 3;",
      "   return first + second;",
      " }",
      "\\ No newline at end of file",
    ]);
  });

  it("normalizes CRLF line endings before processing", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-const value = 1;",
      "+const value = 2;",
    ].join("\r\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      includeContextLineNumbers: false,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-    1 | const value = 1;",
      "+    1 | const value = 2;",
    ]);
  });

  it("returns raw diff when line numbers are disabled", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-const value = 1;",
      "+const value = 2;",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      showLineNumbers: false,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1234567..89abcde 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-const value = 1;",
      "+const value = 2;",
    ]);
  });

  it("annotates context lines when includeContextLineNumbers is true", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "index 1111111..2222222 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -5,3 +5,4 @@ function example() {",
      "   const first = 1;",
      "   const second = 2;",
      "+  const third = 3;",
      "   return first + second;",
    ].join("\n");

    const result = formatUnifiedDiffWithLineNumbers(diff, {
      includeContextLineNumbers: true,
    });

    expect(result).toEqual([
      "diff --git a/file.ts b/file.ts",
      "index 1111111..2222222 100644",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -5,3 +5,4 @@ function example() {",
      "     5    5 |   const first = 1;",
      "     6    6 |   const second = 2;",
      "+    7 |   const third = 3;",
      "     7    8 |   return first + second;",
    ]);
  });
});
