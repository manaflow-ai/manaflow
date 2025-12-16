import { describe, expect, it } from "vitest";
import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_MANIFEST,
  MORPH_SNAPSHOT_PRESETS,
  morphSnapshotManifestSchema,
} from "./morph-snapshots";

describe("morph snapshots manifest", () => {
  it("matches the schema", () => {
    const parsed = morphSnapshotManifestSchema.parse(
      MORPH_SNAPSHOT_MANIFEST,
    );
    expect(parsed.presets.length).toBeGreaterThan(0);
  });

  it("uses resource-based preset ids with ordered versions", () => {
    for (const preset of MORPH_SNAPSHOT_PRESETS) {
      expect(preset.presetId).toMatch(/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+$/i);
      const versions = preset.versions.map((version) => version.version);
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    }
  });

  it("exposes the latest snapshot version per preset", () => {
    for (const preset of MORPH_SNAPSHOT_PRESETS) {
      const latest = preset.versions[preset.versions.length - 1];
      expect(latest).toBeDefined();
      expect(preset.latestVersion).toEqual(latest);
      expect(preset.id).toBe(latest.snapshotId);
    }
  });

  it("keeps the default snapshot id in sync with the first preset", () => {
    expect(DEFAULT_MORPH_SNAPSHOT_ID).toBe(
      MORPH_SNAPSHOT_PRESETS[0].latestVersion.snapshotId,
    );
  });
});
