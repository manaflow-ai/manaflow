import { describe, expect, it } from "vitest";

import {
  inferMacArchitectureFromUserAgent,
  normalizeMacArchitecture,
  pickMacDownloadUrl,
  touchBasedMacArchitectureHint,
  architectureFromWebGLRenderer,
} from "./mac-architecture";

describe("normalizeMacArchitecture", () => {
  it("normalizes known architecture aliases", () => {
    expect(normalizeMacArchitecture("Universal")).toBe("universal");
    expect(normalizeMacArchitecture("universal2")).toBe("universal");
    expect(normalizeMacArchitecture("arm")).toBe("arm64");
    expect(normalizeMacArchitecture("AARCH64")).toBe("arm64");
    expect(normalizeMacArchitecture("x86")).toBe("x64");
    expect(normalizeMacArchitecture("amd64")).toBe("x64");
  });

  it("returns null for unknown values", () => {
    expect(normalizeMacArchitecture("ppc")).toBeNull();
    expect(normalizeMacArchitecture("")).toBeNull();
    expect(normalizeMacArchitecture(undefined)).toBeNull();
  });
});

describe("touchBasedMacArchitectureHint", () => {
  it("returns arm64 for macintel with touch support", () => {
    expect(
      touchBasedMacArchitectureHint({
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("arm64");
  });

  it("returns null when touch points absent", () => {
    expect(
      touchBasedMacArchitectureHint({
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBeNull();
  });

  it("returns null for non-mac platforms", () => {
    expect(
      touchBasedMacArchitectureHint({
        platform: "Win32",
        maxTouchPoints: 10,
      }),
    ).toBeNull();
  });
});

describe("architectureFromWebGLRenderer", () => {
  it("returns arm64 for apple gpu renderers", () => {
    expect(
      architectureFromWebGLRenderer("Apple M3"),
    ).toBe("arm64");
    expect(
      architectureFromWebGLRenderer("Apple GPU"),
    ).toBe("arm64");
  });

  it("returns x64 for intel or amd renderers", () => {
    expect(
      architectureFromWebGLRenderer("Intel(R) Iris OpenGL Engine"),
    ).toBe("x64");
    expect(
      architectureFromWebGLRenderer("AMD Radeon Pro 560"),
    ).toBe("x64");
  });

  it("returns null when renderer is unknown", () => {
    expect(architectureFromWebGLRenderer("Unknown Renderer")).toBeNull();
    expect(architectureFromWebGLRenderer(null)).toBeNull();
  });
});

describe("inferMacArchitectureFromUserAgent", () => {
  it("detects apple silicon from user agent", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Macintosh; arm64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("arm64");
  });

  it("detects intel mac from user agent", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      ),
    ).toBe("x64");
  });

  it("returns null for non-mac user agents", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      ),
    ).toBeNull();
  });
});

describe("pickMacDownloadUrl", () => {
  const macDownloadUrls = {
    universal: "https://example.com/universal.dmg",
    arm64: "https://example.com/arm64.dmg",
    x64: "https://example.com/x64.dmg",
  } as const;

  it("returns architecture-specific url when available", () => {
    const target = pickMacDownloadUrl(macDownloadUrls, "https://fallback", "arm64");
    expect(target).toBe(macDownloadUrls.arm64);
  });

  it("falls back to universal when architecture not detected", () => {
    const target = pickMacDownloadUrl(macDownloadUrls, "https://fallback", null);
    expect(target).toBe(macDownloadUrls.universal);
  });

  it("falls back to provided fallback when no downloads exist", () => {
    const target = pickMacDownloadUrl(
      { universal: null, arm64: null, x64: null },
      "https://fallback",
      "arm64",
    );
    expect(target).toBe("https://fallback");
  });
});
