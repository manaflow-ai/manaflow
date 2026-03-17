import { describe, expect, it } from "vitest";
import {
  DEFAULT_E2B_TEMPLATE_ID,
  E2B_TEMPLATE_MANIFEST,
  E2B_TEMPLATE_PRESETS,
  e2bTemplateManifestSchema,
  getE2BTemplateIdByPresetId,
} from "./e2b-templates";

describe("e2b templates manifest", () => {
  it("matches the schema", () => {
    const parsed = e2bTemplateManifestSchema.parse(E2B_TEMPLATE_MANIFEST);
    expect(parsed.templates.length).toBeGreaterThan(0);
  });

  it("uses ordered versions", () => {
    for (const preset of E2B_TEMPLATE_PRESETS) {
      const versions = preset.versions.map((version) => version.version);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("exposes the latest template version per preset", () => {
    for (const preset of E2B_TEMPLATE_PRESETS) {
      const latest = preset.versions[preset.versions.length - 1];
      expect(latest).toBeDefined();
      expect(preset.latestVersion).toEqual(latest);
      expect(preset.id).toBe(latest.e2bTemplateId);
    }
  });

  it("keeps the default template id in sync with the high (docker) preset", () => {
    const dockerPreset = E2B_TEMPLATE_PRESETS.find(
      (p) => p.templateId === "cmux-devbox-docker",
    );
    expect(dockerPreset).toBeDefined();
    expect(DEFAULT_E2B_TEMPLATE_ID).toBe(
      dockerPreset!.latestVersion.e2bTemplateId,
    );
  });

  it("exposes the docker template preset", () => {
    expect(getE2BTemplateIdByPresetId("cmux-devbox-docker")).toBeDefined();
  });
});

