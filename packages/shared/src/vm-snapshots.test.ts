import { describe, expect, it } from "vitest";
import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  FREESTYLE_SNAPSHOT_PRESETS,
  MORPH_SNAPSHOT_MANIFEST,
  MORPH_SNAPSHOT_PRESETS,
  VM_SNAPSHOT_MANIFEST,
  VM_SNAPSHOT_PRESETS,
  getPresetsWithVersions,
  vmSnapshotManifestSchema,
} from "./vm-snapshots";

describe("vm snapshots manifest", () => {
  it("matches the schema", () => {
    const parsed = vmSnapshotManifestSchema.parse(VM_SNAPSHOT_MANIFEST);
    expect(parsed.presets.length).toBeGreaterThan(0);
  });

  it("uses provider-prefixed preset ids with ordered versions", () => {
    for (const preset of VM_SNAPSHOT_PRESETS) {
      expect(preset.presetId).toMatch(/^[a-z]+_[a-z0-9_]+$/i);
      const versions = preset.versions.map((version) => version.version);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("exposes the latest snapshot version per preset with versions", () => {
    const presetsWithVersions = getPresetsWithVersions();
    for (const preset of presetsWithVersions) {
      const latest = preset.versions[preset.versions.length - 1];
      expect(latest).toBeDefined();
      expect(preset.latestVersion).toEqual(latest);
      expect(preset.id).toBe(latest?.snapshotId);
    }
  });

  it("separates presets by provider", () => {
    expect(MORPH_SNAPSHOT_PRESETS.every((p) => p.provider === "morph")).toBe(
      true,
    );
    expect(
      FREESTYLE_SNAPSHOT_PRESETS.every((p) => p.provider === "freestyle"),
    ).toBe(true);
  });

  it("keeps the default morph snapshot id in sync with the first morph preset", () => {
    const morphPresetsWithVersions = getPresetsWithVersions("morph");
    if (morphPresetsWithVersions.length > 0) {
      expect(DEFAULT_MORPH_SNAPSHOT_ID).toBe(
        morphPresetsWithVersions[0]?.latestVersion?.snapshotId,
      );
    }
  });

  it("legacy exports work for backwards compatibility", () => {
    expect(MORPH_SNAPSHOT_MANIFEST).toBe(VM_SNAPSHOT_MANIFEST);
  });
});
