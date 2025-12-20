import type { FrameworkPreset, PackageManager } from "./types";

/**
 * Script template configuration
 */
interface FrameworkScriptTemplate {
  name: string;
  devScriptName: "dev" | "start";
  iconKey: string;
}

/**
 * Framework preset configuration
 */
export interface FrameworkPresetConfig {
  name: string;
  maintenanceScript: string;
  devScript: string;
  iconKey: string;
}

/**
 * Script templates for each framework preset
 */
const FRAMEWORK_SCRIPT_TEMPLATES: Record<FrameworkPreset, FrameworkScriptTemplate> = {
  other: { name: "Other", devScriptName: "dev", iconKey: "other" },
  next: { name: "Next.js", devScriptName: "dev", iconKey: "next" },
  vite: { name: "Vite", devScriptName: "dev", iconKey: "vite" },
  remix: { name: "Remix", devScriptName: "dev", iconKey: "remix" },
  nuxt: { name: "Nuxt", devScriptName: "dev", iconKey: "nuxt" },
  sveltekit: { name: "SvelteKit", devScriptName: "dev", iconKey: "svelte" },
  angular: { name: "Angular", devScriptName: "start", iconKey: "angular" },
  cra: { name: "Create React App", devScriptName: "start", iconKey: "react" },
  vue: { name: "Vue", devScriptName: "dev", iconKey: "vue" },
};

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
 * Get run command for a script with a specific package manager
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

/**
 * Get the full preset configuration for a framework with package manager
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
      iconKey: template.iconKey,
    };
  }
  return {
    name: template.name,
    maintenanceScript: getInstallCommand(packageManager),
    devScript: getRunCommand(packageManager, template.devScriptName),
    iconKey: template.iconKey,
  };
}

/**
 * Get preset display name
 */
export function getFrameworkPresetName(preset: FrameworkPreset): string {
  return FRAMEWORK_SCRIPT_TEMPLATES[preset].name;
}

/**
 * Get all available framework presets
 */
export function getAllFrameworkPresets(): FrameworkPreset[] {
  return Object.keys(FRAMEWORK_SCRIPT_TEMPLATES) as FrameworkPreset[];
}

/**
 * Default presets using npm (for static references)
 */
export const FRAMEWORK_PRESETS: Record<FrameworkPreset, FrameworkPresetConfig> = {
  other: getFrameworkPresetConfig("other", "npm"),
  next: getFrameworkPresetConfig("next", "npm"),
  vite: getFrameworkPresetConfig("vite", "npm"),
  remix: getFrameworkPresetConfig("remix", "npm"),
  nuxt: getFrameworkPresetConfig("nuxt", "npm"),
  sveltekit: getFrameworkPresetConfig("sveltekit", "npm"),
  angular: getFrameworkPresetConfig("angular", "npm"),
  cra: getFrameworkPresetConfig("cra", "npm"),
  vue: getFrameworkPresetConfig("vue", "npm"),
};
