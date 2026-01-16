/**
 * Shared utilities for environment configuration
 */

import type { EnvVar, PackageManager, FrameworkPreset } from "./types";

const MASKED_ENV_VALUE = "••••••••••••••••";

export { MASKED_ENV_VALUE };

/**
 * Ensure env vars array always has an empty row at the end for easy adding
 */
export function ensureInitialEnvVars(initial?: EnvVar[]): EnvVar[] {
  const base = (initial ?? []).map((item) => ({
    name: item.name,
    value: item.value,
    isSecret: item.isSecret ?? true,
  }));
  if (base.length === 0) {
    return [{ name: "", value: "", isSecret: true }];
  }
  const last = base[base.length - 1];
  if (!last || last.name.trim().length > 0 || last.value.trim().length > 0) {
    base.push({ name: "", value: "", isSecret: true });
  }
  return base;
}

/**
 * Parse a pasted .env file content into EnvVar array
 */
export function parseEnvBlock(text: string): Array<{ name: string; value: string }> {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const results: Array<{ name: string; value: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length === 0 ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("//")
    ) {
      continue;
    }

    const cleanLine = trimmed.replace(/^export\s+/, "").replace(/^set\s+/, "");
    const eqIdx = cleanLine.indexOf("=");

    if (eqIdx === -1) continue;

    const key = cleanLine.slice(0, eqIdx).trim();
    let value = cleanLine.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !/\s/.test(key)) {
      results.push({ name: key, value });
    }
  }

  return results;
}

/**
 * Get install command for a package manager
 */
export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bun install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "npm":
    default:
      return "npm install";
  }
}

/**
 * Get run command for a package manager and script name
 */
export function getRunCommand(pm: PackageManager, scriptName: string): string {
  switch (pm) {
    case "bun":
      return `bun run ${scriptName}`;
    case "pnpm":
      return `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "npm":
    default:
      return `npm run ${scriptName}`;
  }
}

type FrameworkScriptTemplate = {
  name: string;
  devScriptName: "dev" | "start";
};

const FRAMEWORK_SCRIPT_TEMPLATES: Record<FrameworkPreset, FrameworkScriptTemplate> = {
  other: { name: "Other", devScriptName: "dev" },
  next: { name: "Next.js", devScriptName: "dev" },
  vite: { name: "Vite", devScriptName: "dev" },
  remix: { name: "Remix", devScriptName: "dev" },
  nuxt: { name: "Nuxt", devScriptName: "dev" },
  sveltekit: { name: "SvelteKit", devScriptName: "dev" },
  angular: { name: "Angular", devScriptName: "start" },
  cra: { name: "Create React App", devScriptName: "start" },
  vue: { name: "Vue", devScriptName: "dev" },
};

export interface FrameworkPresetConfig {
  name: string;
  maintenanceScript: string;
  devScript: string;
}

/**
 * Get framework preset configuration with scripts for a given package manager
 */
export function getFrameworkPresetConfig(
  preset: FrameworkPreset,
  packageManager: PackageManager = "npm"
): FrameworkPresetConfig {
  const template = FRAMEWORK_SCRIPT_TEMPLATES[preset];
  if (preset === "other") {
    return {
      name: template.name,
      maintenanceScript: "",
      devScript: "",
    };
  }
  return {
    name: template.name,
    maintenanceScript: getInstallCommand(packageManager),
    devScript: getRunCommand(packageManager, template.devScriptName),
  };
}

/**
 * Get the display name for a framework preset
 */
export function getFrameworkDisplayName(preset: FrameworkPreset): string {
  return FRAMEWORK_SCRIPT_TEMPLATES[preset].name;
}

/**
 * All available framework presets
 */
export const FRAMEWORK_PRESET_OPTIONS: FrameworkPreset[] = [
  "other",
  "next",
  "vite",
  "remix",
  "nuxt",
  "sveltekit",
  "angular",
  "cra",
  "vue",
];

/**
 * Derive VNC WebSocket URL from instance ID or workspace URL
 */
export function deriveVncWebsocketUrl(
  instanceId?: string,
  workspaceUrl?: string
): string | null {
  const morphHostId = resolveMorphHostId(instanceId, workspaceUrl);
  if (!morphHostId) {
    return null;
  }

  const hostname = `port-39380-${morphHostId}.http.cloud.morph.so`;
  return `wss://${hostname}/websockify`;
}

/**
 * Derive VS Code URL from instance ID
 */
export function deriveVscodeUrl(instanceId?: string, folderPath?: string): string | null {
  if (!instanceId) return null;
  const hostId = instanceId.replace(/_/g, "-");
  const folder = folderPath ?? "/root/workspace";
  return `https://port-39378-${hostId}.http.cloud.morph.so/?folder=${encodeURIComponent(folder)}`;
}

/**
 * Derive browser VNC URL from instance ID
 */
export function deriveBrowserVncUrl(instanceId?: string): string | null {
  if (!instanceId) return null;
  const hostId = instanceId.replace(/_/g, "-");
  const baseUrl = `https://port-39380-${hostId}.http.cloud.morph.so/vnc.html`;
  return normalizeVncUrl(baseUrl);
}

function resolveMorphHostId(
  instanceId?: string,
  workspaceUrl?: string
): string | null {
  if (instanceId && instanceId.trim().length > 0) {
    return instanceId.trim().toLowerCase().replace(/_/g, "-");
  }

  if (!workspaceUrl) {
    return null;
  }

  try {
    const url = new URL(workspaceUrl);
    const directMatch = url.hostname.match(
      /^port-\d+-(morphvm-[^.]+)\.http\.cloud\.morph\.so$/i
    );
    if (directMatch && directMatch[1]) {
      return directMatch[1].toLowerCase();
    }

    const proxyMatch = url.hostname.match(
      /^cmux-([^-]+)-[a-z0-9-]+-\d+\.cmux\.(?:app|dev|sh|local|localhost)$/i
    );
    if (proxyMatch && proxyMatch[1]) {
      return `morphvm-${proxyMatch[1].toLowerCase()}`;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeVncUrl(url: string): string | null {
  try {
    const target = new URL(url);
    target.searchParams.set("autoconnect", "1");
    target.searchParams.set("resize", "scale");
    return target.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}autoconnect=1&resize=scale`;
  }
}

/**
 * Create empty environment config state
 */
export function createEmptyEnvironmentConfig(): {
  envName: string;
  envVars: EnvVar[];
  maintenanceScript: string;
  devScript: string;
  exposedPorts: string;
} {
  return {
    envName: "",
    envVars: ensureInitialEnvVars(),
    maintenanceScript: "",
    devScript: "",
    exposedPorts: "",
  };
}
