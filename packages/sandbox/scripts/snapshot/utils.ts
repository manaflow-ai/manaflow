/**
 * Shared utilities for ACP sandbox snapshot provisioning.
 *
 * These utilities are shared between Morph and Freestyle providers.
 */

import fs from "node:fs";
import path from "node:path";

// Path to the unified manifest
export const MANIFEST_PATH = path.join(
  import.meta.dirname,
  "../../../shared/src/sandbox-snapshots.json"
);

export interface SnapshotPreset {
  label: string;
  snapshotId: string;
  capturedAt: string;
}

export interface ProviderSnapshots {
  presets: Record<string, SnapshotPreset>;
}

export interface SandboxSnapshotManifest {
  schemaVersion: number;
  updatedAt: string;
  providers: {
    morph: ProviderSnapshots;
    freestyle: ProviderSnapshots;
    daytona?: ProviderSnapshots;
  };
}

export type ProviderName = "morph" | "freestyle" | "daytona";

/**
 * Load the snapshot manifest from disk.
 */
export function loadManifest(): SandboxSnapshotManifest {
  if (fs.existsSync(MANIFEST_PATH)) {
    const content = fs.readFileSync(MANIFEST_PATH, "utf-8");
    return JSON.parse(content);
  }
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    providers: {
      morph: { presets: {} },
      freestyle: { presets: {} },
    },
  };
}

/**
 * Save the snapshot manifest to disk.
 */
export function saveManifest(manifest: SandboxSnapshotManifest): void {
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Manifest saved to ${MANIFEST_PATH}`);
}

/**
 * Update a snapshot ID in the manifest.
 */
export function updateSnapshotId(
  provider: ProviderName,
  preset: string,
  snapshotId: string,
  label?: string
): void {
  const manifest = loadManifest();

  if (!manifest.providers[provider]) {
    manifest.providers[provider] = { presets: {} };
  }

  manifest.providers[provider].presets[preset] = {
    label: label ?? preset,
    snapshotId,
    capturedAt: new Date().toISOString(),
  };

  saveManifest(manifest);
}

/**
 * Get the current snapshot ID for a provider/preset.
 */
export function getSnapshotId(
  provider: ProviderName,
  preset: string
): string | undefined {
  const manifest = loadManifest();
  return manifest.providers[provider]?.presets[preset]?.snapshotId;
}

/**
 * Print a section header.
 */
export function printHeader(text: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(text);
  console.log(`${"=".repeat(60)}\n`);
}

/**
 * Print a summary table.
 */
export function printSummary(
  results: Array<{ provider: string; preset: string; snapshotId: string }>
): void {
  printHeader("Summary");

  if (results.length === 0) {
    console.log("No snapshots created.");
    return;
  }

  console.log("Created snapshots:");
  for (const r of results) {
    console.log(`  ${r.provider}/${r.preset}: ${r.snapshotId}`);
  }
  console.log(`\nManifest: ${MANIFEST_PATH}`);
}
