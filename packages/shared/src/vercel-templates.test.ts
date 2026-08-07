import { describe, expect, it } from "vitest";
import {
  DEFAULT_VERCEL_TEMPLATE_ID,
  VERCEL_TEMPLATE_MANIFEST,
  VERCEL_TEMPLATE_PRESETS,
  vercelTemplateManifestSchema,
  getVercelTemplateByPresetId,
  VERCEL_AVAILABLE_RUNTIMES,
} from "./vercel-templates";

describe("vercel templates manifest", () => {
  it("matches the schema", () => {
    const parsed = vercelTemplateManifestSchema.parse(VERCEL_TEMPLATE_MANIFEST);
    expect(parsed.templates.length).toBeGreaterThan(0);
  });

  it("uses ordered versions", () => {
    for (const preset of VERCEL_TEMPLATE_PRESETS) {
      const versions = preset.versions.map((version) => version.version);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("has a valid default template id", () => {
    const defaultPreset = VERCEL_TEMPLATE_PRESETS.find(
      (p) => p.templateId === DEFAULT_VERCEL_TEMPLATE_ID,
    );
    expect(defaultPreset).toBeDefined();
  });

  it("exposes the default node24 template preset", () => {
    expect(getVercelTemplateByPresetId("vercel-sandbox-node24")).toBeDefined();
  });

  it("exposes all runtime template presets", () => {
    expect(getVercelTemplateByPresetId("vercel-sandbox-node24")).toBeDefined();
    expect(getVercelTemplateByPresetId("vercel-sandbox-node22")).toBeDefined();
    expect(getVercelTemplateByPresetId("vercel-sandbox-python")).toBeDefined();
  });

  it("each template has a runtime that matches available runtimes", () => {
    for (const preset of VERCEL_TEMPLATE_PRESETS) {
      expect(VERCEL_AVAILABLE_RUNTIMES).toContain(preset.runtime);
    }
  });

  it("returns undefined for unknown preset id", () => {
    expect(getVercelTemplateByPresetId("nonexistent")).toBeUndefined();
  });
});
