import { describe, it, expect } from "vitest";
import { parseEnvBlock } from "./parse-env-block";

describe("parseEnvBlock", () => {
  it("parses simple KEY=value format", () => {
    const result = parseEnvBlock("FOO=bar\nBAZ=qux");
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux" },
    ]);
  });

  it("parses double-quoted values", () => {
    const result = parseEnvBlock('FOO="hello world"');
    expect(result).toEqual([{ name: "FOO", value: "hello world" }]);
  });

  it("parses single-quoted values", () => {
    const result = parseEnvBlock("FOO='hello world'");
    expect(result).toEqual([{ name: "FOO", value: "hello world" }]);
  });

  it("handles multi-line quoted values", () => {
    const input = `FOO="line1
line2
line3"
BAR=single`;
    const result = parseEnvBlock(input);
    expect(result).toEqual([
      { name: "FOO", value: "line1\nline2\nline3" },
      { name: "BAR", value: "single" },
    ]);
  });

  it("strips export prefix", () => {
    const result = parseEnvBlock("export FOO=bar");
    expect(result).toEqual([{ name: "FOO", value: "bar" }]);
  });

  it("strips set prefix", () => {
    const result = parseEnvBlock("set FOO=bar");
    expect(result).toEqual([{ name: "FOO", value: "bar" }]);
  });

  it("ignores comments", () => {
    const result = parseEnvBlock(`# This is a comment
FOO=bar
// Another comment
BAZ=qux`);
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux" },
    ]);
  });

  it("ignores empty lines", () => {
    const result = parseEnvBlock(`FOO=bar

BAZ=qux`);
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux" },
    ]);
  });

  it("handles colon separator (YAML-style)", () => {
    const result = parseEnvBlock("FOO: bar");
    expect(result).toEqual([{ name: "FOO", value: "bar" }]);
  });

  it("strips inline comments", () => {
    const result = parseEnvBlock("FOO=bar # this is a comment");
    expect(result).toEqual([{ name: "FOO", value: "bar" }]);
  });

  it("handles Windows line endings", () => {
    const result = parseEnvBlock("FOO=bar\r\nBAZ=qux");
    expect(result).toEqual([
      { name: "FOO", value: "bar" },
      { name: "BAZ", value: "qux" },
    ]);
  });

  it("ignores keys with spaces", () => {
    const result = parseEnvBlock("FOO BAR=baz\nVALID=ok");
    expect(result).toEqual([{ name: "VALID", value: "ok" }]);
  });
});
