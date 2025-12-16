import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";

export const INJECT_SCRIPTS_DIR = "scripts/pr-review";
export const INJECT_SOURCE_FILENAME = "pr-review-inject.ts";
export const INJECT_BUNDLE_FILENAME = "pr-review-inject.bundle.js";

export interface InjectScriptPaths {
  projectRoot: string;
  injectScriptsDir: string;
  injectScriptSourcePath: string;
  injectScriptBundlePath: string;
}

const DEFAULT_EXTERNALS = [
  "@openai/codex-sdk",
  "@openai/codex",
  "zod",
] as const;

export interface ResolveInjectScriptPathsOptions {
  envRoot?: string | null;
  cwd?: string;
  moduleDir?: string;
}

export function hasInjectScriptDir(baseDir: string): boolean {
  return existsSync(resolve(baseDir, INJECT_SCRIPTS_DIR));
}

export function resolveInjectScriptPaths(
  options: ResolveInjectScriptPathsOptions = {}
): InjectScriptPaths {
  const envRootCandidate =
    options.envRoot ?? process.env.CMUX_WWW_APP_ROOT ?? null;
  if (envRootCandidate && hasInjectScriptDir(envRootCandidate)) {
    return buildInjectPaths(envRootCandidate);
  }

  const cwdCandidate = options.cwd ?? process.cwd();
  if (hasInjectScriptDir(cwdCandidate)) {
    return buildInjectPaths(cwdCandidate);
  }

  const initialDir = options.moduleDir ?? cwdCandidate;
  let currentDir: string | null = initialDir;
  while (currentDir) {
    if (hasInjectScriptDir(currentDir)) {
      return buildInjectPaths(currentDir);
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return buildInjectPaths(cwdCandidate);
}

function buildInjectPaths(projectRoot: string): InjectScriptPaths {
  const injectScriptsDir = resolve(projectRoot, INJECT_SCRIPTS_DIR);
  return {
    projectRoot,
    injectScriptsDir,
    injectScriptSourcePath: resolve(
      injectScriptsDir,
      INJECT_SOURCE_FILENAME
    ),
    injectScriptBundlePath: resolve(
      injectScriptsDir,
      INJECT_BUNDLE_FILENAME
    ),
  };
}

export function getBunExecutable(): string {
  return process.env.BUN_RUNTIME ?? process.env.BUN_BIN ?? "bun";
}

export interface BundleInjectScriptOptions {
  productionMode: boolean;
  sourcePath: string;
  bundlePath: string;
  bunExecutable?: string;
  logPrefix?: string;
  externals?: readonly string[];
  additionalArgs?: readonly string[];
}

export async function bundleInjectScript(
  options: BundleInjectScriptOptions
): Promise<void> {
  const {
    productionMode,
    sourcePath,
    bundlePath,
    bunExecutable = getBunExecutable(),
    logPrefix = "[pr-review]",
    externals = DEFAULT_EXTERNALS,
    additionalArgs = [],
  } = options;

  if (productionMode) {
    console.log(
      `${logPrefix} Production mode detected; expecting prebuilt inject script bundle.`
    );
    return;
  }

  console.log(`${logPrefix} Bundling inject script via bun build...`);
  await new Promise<void>((resolve, reject) => {
    const args: string[] = [
      "build",
      sourcePath,
      "--outfile",
      bundlePath,
      "--target",
      "bun",
    ];
    externals.forEach((external) => {
      args.push("--external", external);
    });
    args.push(...additionalArgs);

    const child = spawn(bunExecutable, args, {
      stdio: "inherit",
    });
    child.once("error", (error) => reject(error));
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `bun build exited with code ${code ?? "unknown"} when bundling inject script`
        )
      );
    });
  });
}
