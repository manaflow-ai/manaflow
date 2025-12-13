import { z } from "zod";
import vmSnapshotDataJson from "./vm-snapshots.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

export const vmProviderSchema = z.enum(["morph", "freestyle"]);

export type VMProvider = z.infer<typeof vmProviderSchema>;

const presetIdSchema = z
  .string()
  .regex(/^[a-z]+_[a-z0-9_]+$/i, {
    message: "presetId must follow <provider>_<config> format",
  });

// Snapshot ID formats:
// - Morph: snapshot_[alphanumeric]
// - Freestyle: [alphanumeric] (5 characters)
const snapshotIdSchema = z.string().min(1);

export const vmSnapshotVersionSchema = z.object({
  version: z.number().int().positive(),
  snapshotId: snapshotIdSchema,
  capturedAt: isoDateStringSchema,
});

export const vmSnapshotPresetSchema = z
  .object({
    presetId: presetIdSchema,
    provider: vmProviderSchema,
    label: z.string(),
    cpu: z.string(),
    memory: z.string(),
    disk: z.string(),
    description: z.string().optional(),
    versions: z.array(vmSnapshotVersionSchema).readonly(),
  })
  .superRefine((preset, ctx) => {
    const sortedByVersion = [...preset.versions].sort(
      (a, b) => a.version - b.version,
    );
    for (let index = 1; index < sortedByVersion.length; index += 1) {
      const previous = sortedByVersion[index - 1];
      const current = sortedByVersion[index];
      if (!previous || !current) {
        continue;
      }
      if (current.version <= previous.version) {
        ctx.addIssue({
          code: "custom",
          message: "Versions must be strictly increasing",
          path: ["versions", index, "version"],
        });
        break;
      }
    }
  });

export const vmSnapshotManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDateStringSchema,
  presets: z.array(vmSnapshotPresetSchema),
});

export type VMSnapshotVersion = z.infer<typeof vmSnapshotVersionSchema>;

export type VMSnapshotPreset = z.infer<typeof vmSnapshotPresetSchema>;

export interface VMSnapshotPresetWithLatest extends VMSnapshotPreset {
  id: VMSnapshotVersion["snapshotId"] | null;
  latestVersion: VMSnapshotVersion | null;
  versions: readonly VMSnapshotVersion[];
}

// Preset that is ready to use (has at least one version)
export interface VMSnapshotPresetReady extends VMSnapshotPreset {
  id: VMSnapshotVersion["snapshotId"];
  latestVersion: VMSnapshotVersion;
  versions: readonly VMSnapshotVersion[];
}

export type VMSnapshotManifest = z.infer<typeof vmSnapshotManifestSchema>;

const sortVersions = (
  versions: readonly VMSnapshotVersion[],
): VMSnapshotVersion[] => [...versions].sort((a, b) => a.version - b.version);

const toPresetWithLatest = (
  preset: VMSnapshotPreset,
): VMSnapshotPresetWithLatest => {
  const sortedVersions = sortVersions(preset.versions);
  const latestVersion = sortedVersions.at(-1) ?? null;
  return {
    ...preset,
    versions: sortedVersions,
    id: latestVersion?.snapshotId ?? null,
    latestVersion,
  };
};

const vmSnapshotManifest = vmSnapshotManifestSchema.parse(vmSnapshotDataJson);

export const VM_SNAPSHOT_MANIFEST: VMSnapshotManifest = vmSnapshotManifest;

const vmSnapshotPresets = VM_SNAPSHOT_MANIFEST.presets.map(toPresetWithLatest);

export const VM_SNAPSHOT_PRESETS: readonly VMSnapshotPresetWithLatest[] =
  vmSnapshotPresets;

// Filter presets by provider
export const MORPH_SNAPSHOT_PRESETS: readonly VMSnapshotPresetWithLatest[] =
  vmSnapshotPresets.filter((p) => p.provider === "morph");

export const FREESTYLE_SNAPSHOT_PRESETS: readonly VMSnapshotPresetWithLatest[] =
  vmSnapshotPresets.filter((p) => p.provider === "freestyle");

// Type guard for presets that are ready to use
const isPresetReady = (
  preset: VMSnapshotPresetWithLatest,
): preset is VMSnapshotPresetReady =>
  preset.versions.length > 0 && preset.id !== null;

// Get presets with at least one version (ready to use)
export const getPresetsWithVersions = (
  provider?: VMProvider,
): readonly VMSnapshotPresetReady[] => {
  const presets = provider
    ? vmSnapshotPresets.filter((p) => p.provider === provider)
    : vmSnapshotPresets;
  return presets.filter(isPresetReady);
};

// Legacy exports for backwards compatibility
export type MorphSnapshotVersion = VMSnapshotVersion;
export type MorphSnapshotPreset = VMSnapshotPreset;
export type MorphSnapshotPresetWithLatest = VMSnapshotPresetWithLatest;
export type MorphSnapshotPresetReady = VMSnapshotPresetReady;
export type MorphSnapshotManifest = VMSnapshotManifest;
export const morphSnapshotVersionSchema = vmSnapshotVersionSchema;
export const morphSnapshotPresetSchema = vmSnapshotPresetSchema;
export const morphSnapshotManifestSchema = vmSnapshotManifestSchema;
export const MORPH_SNAPSHOT_MANIFEST = VM_SNAPSHOT_MANIFEST;

// Default snapshot - first Morph preset with versions
const defaultMorphPreset = MORPH_SNAPSHOT_PRESETS.find(
  (p) => p.versions.length > 0 && p.id !== null,
);

export type MorphSnapshotId = string;

// DEFAULT_MORPH_SNAPSHOT_ID is guaranteed to be non-null as long as we have
// at least one Morph preset with versions in the manifest
export const DEFAULT_MORPH_SNAPSHOT_ID: MorphSnapshotId =
  defaultMorphPreset?.id ?? (() => {
    throw new Error("No Morph presets with versions found in the manifest");
  })();

// Default Freestyle snapshot
const defaultFreestylePreset = FREESTYLE_SNAPSHOT_PRESETS.find(
  (p) => p.versions.length > 0 && p.id !== null,
);

export type FreestyleSnapshotId = string;

export const DEFAULT_FREESTYLE_SNAPSHOT_ID: FreestyleSnapshotId =
  defaultFreestylePreset?.id ?? (() => {
    throw new Error("No Freestyle presets with versions found in the manifest");
  })();

export const DEFAULT_FREESTYLE_PRESET = defaultFreestylePreset;
