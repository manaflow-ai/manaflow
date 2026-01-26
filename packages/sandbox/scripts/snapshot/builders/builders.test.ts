/**
 * Unit tests for the builders module.
 *
 * Tests the SnapshotBuilder abstraction and provider capabilities.
 */

import { describe, it, expect } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  isDockerfileProvider,
  isRuntimeProvider,
  getBuilder,
} from "./index";
import type { ProviderName } from "../utils";

describe("PROVIDER_CAPABILITIES", () => {
  it("should define capabilities for all providers", () => {
    const providers: ProviderName[] = ["morph", "freestyle", "daytona", "e2b", "blaxel"];

    for (const provider of providers) {
      expect(PROVIDER_CAPABILITIES[provider]).toBeDefined();
      expect(PROVIDER_CAPABILITIES[provider].strategy).toBeDefined();
      expect(typeof PROVIDER_CAPABILITIES[provider].capturesProcesses).toBe("boolean");
      expect(typeof PROVIDER_CAPABILITIES[provider].needsBootScript).toBe("boolean");
    }
  });

  it("should mark morph as runtime strategy", () => {
    expect(PROVIDER_CAPABILITIES.morph.strategy).toBe("runtime");
    expect(PROVIDER_CAPABILITIES.morph.capturesProcesses).toBe(true);
    expect(PROVIDER_CAPABILITIES.morph.needsBootScript).toBe(false);
  });

  it("should mark freestyle as runtime strategy", () => {
    expect(PROVIDER_CAPABILITIES.freestyle.strategy).toBe("runtime");
    expect(PROVIDER_CAPABILITIES.freestyle.capturesProcesses).toBe(true);
    expect(PROVIDER_CAPABILITIES.freestyle.needsBootScript).toBe(false);
  });

  it("should mark daytona as dockerfile strategy", () => {
    expect(PROVIDER_CAPABILITIES.daytona.strategy).toBe("dockerfile");
    expect(PROVIDER_CAPABILITIES.daytona.capturesProcesses).toBe(false);
    expect(PROVIDER_CAPABILITIES.daytona.needsBootScript).toBe(true);
  });

  it("should mark e2b as dockerfile strategy", () => {
    expect(PROVIDER_CAPABILITIES.e2b.strategy).toBe("dockerfile");
    expect(PROVIDER_CAPABILITIES.e2b.capturesProcesses).toBe(false);
    expect(PROVIDER_CAPABILITIES.e2b.needsBootScript).toBe(true);
  });

  it("should mark blaxel as dockerfile strategy", () => {
    expect(PROVIDER_CAPABILITIES.blaxel.strategy).toBe("dockerfile");
    expect(PROVIDER_CAPABILITIES.blaxel.capturesProcesses).toBe(false);
    expect(PROVIDER_CAPABILITIES.blaxel.needsBootScript).toBe(true);
  });
});

describe("isDockerfileProvider", () => {
  it("should return false for morph", () => {
    expect(isDockerfileProvider("morph")).toBe(false);
  });

  it("should return false for freestyle", () => {
    expect(isDockerfileProvider("freestyle")).toBe(false);
  });

  it("should return true for daytona", () => {
    expect(isDockerfileProvider("daytona")).toBe(true);
  });

  it("should return true for e2b", () => {
    expect(isDockerfileProvider("e2b")).toBe(true);
  });

  it("should return true for blaxel", () => {
    expect(isDockerfileProvider("blaxel")).toBe(true);
  });
});

describe("isRuntimeProvider", () => {
  it("should return true for morph", () => {
    expect(isRuntimeProvider("morph")).toBe(true);
  });

  it("should return true for freestyle", () => {
    expect(isRuntimeProvider("freestyle")).toBe(true);
  });

  it("should return false for daytona", () => {
    expect(isRuntimeProvider("daytona")).toBe(false);
  });

  it("should return false for e2b", () => {
    expect(isRuntimeProvider("e2b")).toBe(false);
  });

  it("should return false for blaxel", () => {
    expect(isRuntimeProvider("blaxel")).toBe(false);
  });
});

describe("getBuilder", () => {
  it("should throw for runtime providers", async () => {
    await expect(getBuilder("morph")).rejects.toThrow(/runtime/);
    await expect(getBuilder("freestyle")).rejects.toThrow(/runtime/);
  });

  // Note: These tests would require API keys to actually instantiate builders
  // So we just test that the function doesn't throw immediately for valid providers
  it("should attempt to create builder for daytona (will fail without API key)", async () => {
    // Store original env
    const originalKey = process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_API_KEY;

    await expect(getBuilder("daytona")).rejects.toThrow(/DAYTONA_API_KEY/);

    // Restore
    if (originalKey) process.env.DAYTONA_API_KEY = originalKey;
  });

  it("should attempt to create builder for e2b (will fail without API key)", async () => {
    const originalKey = process.env.E2B_API_KEY;
    delete process.env.E2B_API_KEY;

    await expect(getBuilder("e2b")).rejects.toThrow(/E2B_API_KEY/);

    if (originalKey) process.env.E2B_API_KEY = originalKey;
  });

  it("should attempt to create builder for blaxel (will fail without API key)", async () => {
    const originalKey = process.env.BLAXEL_API_KEY;
    const originalBlKey = process.env.BL_API_KEY;
    delete process.env.BLAXEL_API_KEY;
    delete process.env.BL_API_KEY;

    await expect(getBuilder("blaxel")).rejects.toThrow(/BLAXEL_API_KEY|BL_API_KEY/);

    if (originalKey) process.env.BLAXEL_API_KEY = originalKey;
    if (originalBlKey) process.env.BL_API_KEY = originalBlKey;
  });
});

describe("strategy consistency", () => {
  it("should have exactly 2 runtime providers", () => {
    const runtimeProviders: ProviderName[] = ["morph", "freestyle", "daytona", "e2b", "blaxel"]
      .filter((p) => isRuntimeProvider(p as ProviderName)) as ProviderName[];

    expect(runtimeProviders).toEqual(["morph", "freestyle"]);
  });

  it("should have exactly 3 dockerfile providers", () => {
    const dockerfileProviders: ProviderName[] = ["morph", "freestyle", "daytona", "e2b", "blaxel"]
      .filter((p) => isDockerfileProvider(p as ProviderName)) as ProviderName[];

    expect(dockerfileProviders).toEqual(["daytona", "e2b", "blaxel"]);
  });

  it("should have mutually exclusive strategies", () => {
    const providers: ProviderName[] = ["morph", "freestyle", "daytona", "e2b", "blaxel"];

    for (const provider of providers) {
      const isRuntime = isRuntimeProvider(provider);
      const isDockerfile = isDockerfileProvider(provider);

      // Exactly one should be true
      expect(isRuntime !== isDockerfile).toBe(true);
    }
  });
});
