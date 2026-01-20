import { describe, expect, it } from "vitest";
import { containsFirstPersonPronoun } from "./conversationSummary";

describe("containsFirstPersonPronoun", () => {
  it("detects first-person pronouns", () => {
    expect(containsFirstPersonPronoun("Fix my auth flow")).toBe(true);
    expect(containsFirstPersonPronoun("We should update caching")).toBe(true);
    expect(containsFirstPersonPronoun("Investigate us-east latency")).toBe(true);
  });

  it("ignores words that are not standalone pronouns", () => {
    expect(containsFirstPersonPronoun("MySQL migration plan")).toBe(false);
    expect(containsFirstPersonPronoun("Improve system reliability")).toBe(false);
    expect(containsFirstPersonPronoun("Tweak IO scheduling")).toBe(false);
  });

  it("does not flag I/O as first-person", () => {
    expect(containsFirstPersonPronoun("I/O performance tuning")).toBe(false);
    expect(containsFirstPersonPronoun("Optimize i/o-bound jobs")).toBe(false);
  });
});
