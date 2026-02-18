import { describe, expect, it } from "vitest";

import { normalizeBrowserUrl } from "./normalize-browser-url";

describe("normalizeBrowserUrl", () => {
  it("returns existing protocol URLs unchanged", () => {
    expect(normalizeBrowserUrl("http://example.com")).toBe(
      "http://example.com",
    );
    expect(normalizeBrowserUrl("https://manaflow.com/run")).toBe(
      "https://manaflow.com/run",
    );
  });

  it("adds https to protocol-relative URLs", () => {
    expect(normalizeBrowserUrl("//manaflow.com")).toBe("https://manaflow.com");
  });

  it("adds http to localhost URLs", () => {
    expect(normalizeBrowserUrl("localhost")).toBe("http://localhost");
    expect(normalizeBrowserUrl("localhost:9779")).toBe(
      "http://localhost:9779",
    );
  });

  it("adds http to loopback IPs", () => {
    expect(normalizeBrowserUrl("127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("adds http to .local hostnames", () => {
    expect(normalizeBrowserUrl("workspace.local")).toBe(
      "http://workspace.local",
    );
  });

  it("defaults to https for external hosts", () => {
    expect(normalizeBrowserUrl("manaflow.com")).toBe("https://manaflow.com");
  });

  it("preserves special schemes without slashes", () => {
    expect(normalizeBrowserUrl("mailto:test@example.com")).toBe(
      "mailto:test@example.com",
    );
    expect(normalizeBrowserUrl("about:blank")).toBe("about:blank");
    expect(normalizeBrowserUrl("data:text/plain,hello")).toBe(
      "data:text/plain,hello",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeBrowserUrl("  example.com  ")).toBe("https://example.com");
  });
});
