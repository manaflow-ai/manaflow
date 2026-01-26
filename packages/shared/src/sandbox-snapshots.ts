/**
 * Unified sandbox snapshot manifest.
 *
 * Supports multiple providers (Morph, Freestyle, Daytona) with a simple
 * preset -> snapshotId mapping that Convex code can import directly.
 */

import { z } from "zod";
import sandboxSnapshotsJson from "./sandbox-snapshots.json" with {
  type: "json",
};

// Provider names
export type SandboxProvider = "morph" | "freestyle" | "daytona" | "e2b" | "blaxel";

// Preset schema
const presetSchema = z.object({
  label: z.string(),
  snapshotId: z.string(),
  capturedAt: z.string(),
});

export type SnapshotPreset = z.infer<typeof presetSchema>;

// Provider schema
const providerSchema = z.object({
  presets: z.record(z.string(), presetSchema),
});

export type ProviderSnapshots = z.infer<typeof providerSchema>;

// Full manifest schema
const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string(),
  providers: z.record(z.string(), providerSchema),
});

export type SandboxSnapshotManifest = z.infer<typeof manifestSchema>;

// Parse and export the manifest
export const SANDBOX_SNAPSHOT_MANIFEST = manifestSchema.parse(sandboxSnapshotsJson);

/**
 * Get the snapshot ID for a provider and preset.
 */
export function getSnapshotId(
  provider: SandboxProvider,
  preset: string = "standard"
): string | undefined {
  const providerData = SANDBOX_SNAPSHOT_MANIFEST.providers[provider];
  if (!providerData) return undefined;
  return providerData.presets[preset]?.snapshotId;
}

/**
 * Get the default snapshot ID for a provider.
 */
export function getDefaultSnapshotId(provider: SandboxProvider): string | undefined {
  return getSnapshotId(provider, "standard");
}

/**
 * Get all available presets for a provider.
 */
export function getPresets(provider: SandboxProvider): Record<string, SnapshotPreset> {
  const providerData = SANDBOX_SNAPSHOT_MANIFEST.providers[provider];
  if (!providerData) return {};
  return providerData.presets;
}

// Re-export for convenience - default snapshot IDs
export const DEFAULT_MORPH_SNAPSHOT = getSnapshotId("morph", "standard");
export const DEFAULT_FREESTYLE_SNAPSHOT = getSnapshotId("freestyle", "standard");
export const DEFAULT_DAYTONA_SNAPSHOT = getSnapshotId("daytona", "standard");
export const DEFAULT_E2B_SNAPSHOT = getSnapshotId("e2b", "standard");
export const DEFAULT_BLAXEL_SNAPSHOT = getSnapshotId("blaxel", "standard");
