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
  "../../packages/shared/src/sandbox-snapshots.json"
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
 * Common provisioning commands for ACP sandbox setup.
 */
export const PROVISIONING_COMMANDS = [
  // Basic system setup
  "apt-get update",
  "DEBIAN_FRONTEND=noninteractive apt-get install -y curl git build-essential pkg-config libssl-dev ca-certificates",

  // Install Node.js 22 (for Claude Code ACP)
  "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
  "apt-get install -y nodejs",
  "node --version && npm --version",

  // Install Bun
  "curl -fsSL https://bun.sh/install | bash",
  'export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && bun --version',

  // Install Rust (for cmux-acp-server)
  "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  'source "$HOME/.cargo/env" && rustc --version',

  // Install uv/Python
  "curl -LsSf https://astral.sh/uv/install.sh | sh",
  'export PATH="$HOME/.local/bin:$PATH" && uv --version',

  // Install Claude Code ACP
  "npm install -g @zed-industries/claude-code-acp@latest",

  // Create cmux directories
  "mkdir -p /etc/cmux /var/log/cmux /workspace",

  // Verify installations
  "echo '=== Installation Summary ===' && node --version && npm --version",
];

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
