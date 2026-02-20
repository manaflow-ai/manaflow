import { describe, expect, it, vi } from "vitest";
import { normalizeOrigin } from "./normalize-origin";

describe("normalizeOrigin", () => {
  it("upgrades non-local http origins to https", () => {
    expect(normalizeOrigin("http://manaflow.com")).toBe("https://manaflow.com");
  });

  it("keeps https origins untouched", () => {
    expect(normalizeOrigin("https://manaflow.com")).toBe("https://manaflow.com");
  });

  it("preserves localhost http origins", () => {
    expect(normalizeOrigin("http://localhost:9779")).toBe(
      "http://localhost:9779"
    );
  });

  it("preserves LAN IPv4 http origins", () => {
    expect(normalizeOrigin("http://192.168.1.10:9779")).toBe(
      "http://192.168.1.10:9779"
    );
  });

  it("preserves numeric loopback hosts", () => {
    expect(normalizeOrigin("http://127.0.0.1:4000")).toBe(
      "http://127.0.0.1:4000"
    );
  });

  it("adds https:// prefix when protocol is missing", () => {
    expect(normalizeOrigin("manaflow.com")).toBe("https://manaflow.com");
    expect(normalizeOrigin("example.vercel.app")).toBe(
      "https://example.vercel.app"
    );
  });

  it("returns trimmed origin when parsing fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Use invalid characters that can't form a valid URL even with https://
    expect(normalizeOrigin(" :invalid: ")).toBe(":invalid:");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
