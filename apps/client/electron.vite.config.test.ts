import { beforeAll, describe, expect, it } from "vitest";
import config from "./electron.vite.config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronViteConfig, ElectronViteConfigExport } from "electron-vite";
import type { ConfigEnv, Plugin, PluginOption, UserConfig, UserConfigExport } from "vite";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const defaultConfigEnv: ConfigEnv = {
  command: "build",
  mode: "test",
  isPreview: false,
  isSsrBuild: false,
};

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && typeof (value as PromiseLike<unknown>).then === "function";
}

async function resolveElectronConfig(configExport: ElectronViteConfigExport): Promise<ElectronViteConfig> {
  if (typeof configExport === "function") {
    return resolveElectronConfig(configExport(defaultConfigEnv));
  }
  if (isPromiseLike<ElectronViteConfig>(configExport)) {
    return resolveElectronConfig(await configExport);
  }
  return configExport;
}

async function resolveUserConfig(configExport: UserConfigExport | undefined): Promise<UserConfig | undefined> {
  if (!configExport) {
    return undefined;
  }
  if (typeof configExport === "function") {
    return resolveUserConfig(configExport(defaultConfigEnv));
  }
  if (isPromiseLike<UserConfig>(configExport)) {
    return resolveUserConfig(await configExport);
  }
  return configExport;
}

interface ResolvedElectronConfigs {
  main?: UserConfig;
  preload?: UserConfig;
  renderer?: UserConfig;
}

let resolvedConfigs: ResolvedElectronConfigs | undefined;

function getResolvedConfigs(): ResolvedElectronConfigs {
  if (!resolvedConfigs) {
    throw new Error("Electron config has not been resolved");
  }
  return resolvedConfigs;
}

beforeAll(async () => {
  const electronConfig = await resolveElectronConfig(config);
  resolvedConfigs = {
    main: await resolveUserConfig(electronConfig.main),
    preload: await resolveUserConfig(electronConfig.preload),
    renderer: await resolveUserConfig(electronConfig.renderer),
  };
});

function isPlugin(value: PluginOption): value is Plugin {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectPlugins(option: PluginOption | PluginOption[] | undefined): Plugin[] {
  if (!option) {
    return [];
  }
  if (Array.isArray(option)) {
    return option.flatMap((entry) => collectPlugins(entry));
  }
  return isPlugin(option) ? [option] : [];
}

function flattenPlugins(plugins: PluginOption[] | undefined): Plugin[] {
  if (!plugins) {
    return [];
  }
  return plugins.flatMap((pluginOption) => collectPlugins(pluginOption));
}

function findPluginByName(plugins: PluginOption[] | undefined, pluginName: string): Plugin | undefined {
  return flattenPlugins(plugins).find((plugin) => plugin.name === pluginName);
}

function readExcludeList(plugin: Plugin | undefined): string[] {
  if (!plugin) {
    return [];
  }
  const rawExclude = (plugin as { exclude?: unknown }).exclude;
  if (!Array.isArray(rawExclude)) {
    return [];
  }
  return rawExclude.filter((value): value is string => typeof value === "string");
}

describe("electron.vite.config", () => {
  it("shares the repo env configuration across targets", () => {
    const resolved = getResolvedConfigs();

    expect(resolved.main?.envDir).toBe(repoRoot);
    expect(resolved.preload?.envDir).toBe(repoRoot);
    expect(resolved.renderer?.envDir).toBe(repoRoot);

    expect(resolved.main?.envPrefix).toBe("NEXT_PUBLIC_");
    expect(resolved.preload?.envPrefix).toBe("NEXT_PUBLIC_");
    expect(resolved.renderer?.envPrefix).toBe("NEXT_PUBLIC_");
  });

  it("registers plugins required for bundling workspace packages", () => {
    const resolved = getResolvedConfigs();
    const mainResolver = findPluginByName(resolved.main?.plugins, "resolve-workspace-packages");
    const preloadResolver = findPluginByName(resolved.preload?.plugins, "resolve-workspace-packages");

    expect(mainResolver).toBeDefined();
    expect(preloadResolver).toBeDefined();

    const mainExternalize = findPluginByName(resolved.main?.plugins, "externalize-deps");
    const preloadExternalize = findPluginByName(resolved.preload?.plugins, "externalize-deps");

    expect(mainExternalize).toBeDefined();
    expect(preloadExternalize).toBeDefined();

    expect(readExcludeList(mainExternalize)).toEqual(
      expect.arrayContaining([
        "@cmux/server",
        "@cmux/server/**",
        "@cmux/shared",
        "@cmux/convex",
        "@cmux/www-openapi-client",
      ])
    );
    expect(readExcludeList(preloadExternalize)).toEqual(
      expect.arrayContaining(["@cmux/server", "@cmux/server/**"])
    );
  });

  it("defines the expected entry points and aliases", () => {
    const resolved = getResolvedConfigs();

    expect(resolved.main?.build?.rollupOptions?.input).toMatchObject({
      index: resolve("electron/main/bootstrap.ts"),
    });
    expect(resolved.preload?.build?.rollupOptions?.input).toMatchObject({
      index: resolve("electron/preload/index.ts"),
    });
    expect(resolved.renderer?.build?.rollupOptions?.input).toMatchObject({
      index: resolve("index-electron.html"),
    });

    expect(resolved.renderer?.resolve?.alias).toMatchObject({
      "@": resolve("src"),
    });
  });
});
