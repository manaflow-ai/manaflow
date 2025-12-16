import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./vscodeFuzzyMatch";

describe("fuzzyMatch", () => {
  const target = "The quick brown fox jumps over the lazy dog.";

  it("matches positive queries", () => {
    expect(fuzzyMatch(target, "fox")).not.toBeNull();
    expect(fuzzyMatch(target, "Quick fox jumps the dog")).not.toBeNull();
  });

  it("rejects non-matching queries", () => {
    expect(fuzzyMatch(target, "cat")).toBeNull();
    expect(fuzzyMatch(target, "Quick fox jumps the cat")).toBeNull();
  });

  it("orders rankings similar to VS Code", () => {
    const queries = [
      "fx",
      "fox",
      "jump",
      "JUMP",
      "The",
      "the",
      "fx over",
      "quick cat",
      "The quick",
      "the quick",
      "jump the dog",
      "jmp the do",
      "jmp the cat",
      "dog the fox",
      "het",
      "xz",
      "xx",
      "ee",
    ];

    const results = queries
      .map((query) => ({ query, score: fuzzyMatch(target, query) }))
      .filter(({ score }) => score !== null) as Array<{ query: string; score: number }>;

    results.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

    expect(results.map(({ query }) => query)).toEqual([
      "xz",
      "ee",
      "fx",
      "het",
      "fox",
      "the",
      "The",
      "JUMP",
      "jump",
      "fx over",
      "jmp the do",
      "jump the dog",
      "the quick",
      "The quick",
    ]);
  });

  it("treats slashes interchangeably", () => {
    expect(fuzzyMatch("/bin/ls", "/ls")).not.toBeNull();
    expect(fuzzyMatch("/bin/ls", "\\ls")).not.toBeNull();
    expect(fuzzyMatch("c:\\windows\\notepad.exe", "/windows")).not.toBeNull();
    expect(fuzzyMatch("c:\\windows\\notepad.exe", "\\windows")).not.toBeNull();
  });

  it("rewards word boundaries", () => {
    const higher1 = fuzzyMatch("words with spaces", "spa");
    const lower1 = fuzzyMatch("words with spaces", "pac");
    expect(higher1).not.toBeNull();
    expect(lower1).not.toBeNull();
    expect((higher1 ?? 0) > (lower1 ?? 0)).toBe(true);

    const higher2 = fuzzyMatch("words_with_underscores", "und");
    const lower2 = fuzzyMatch("words_with_underscores", "nde");
    expect(higher2).not.toBeNull();
    expect(lower2).not.toBeNull();
    expect((higher2 ?? 0) > (lower2 ?? 0)).toBe(true);

    const higher3 = fuzzyMatch("camelCaseWords", "Wor");
    const lower3 = fuzzyMatch("camelCaseWords", "ord");
    expect(higher3).not.toBeNull();
    expect(lower3).not.toBeNull();
    expect((higher3 ?? 0) > (lower3 ?? 0)).toBe(true);
  });
});
