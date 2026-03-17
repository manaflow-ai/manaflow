import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type Logger = {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug?: (message: string, ...args: unknown[]) => void;
};

/**
 * Supported VS Code variants in order of preference
 */
export type VSCodeVariant = "stable" | "insiders" | "codium" | "oss";

/**
 * How the VS Code installation was discovered
 */
export type DetectionSource =
  | "env-override" // CMUX_VSCODE_PATH environment variable
  | "path-lookup" // Found via which/where in PATH
  | "shell-lookup" // Found via login shell command -v
  | "spotlight" // Found via macOS mdfind (Spotlight)
  | "common-path" // Found at a known installation path
  | "homebrew"; // Found in Homebrew Caskroom

/**
 * Information about a discovered VS Code installation
 */
export interface VSCodeInstallation {
  /** Full path to the code CLI executable */
  executablePath: string;
  /** Which variant of VS Code this is */
  variant: VSCodeVariant;
  /** How it was discovered */
  source: DetectionSource;
}

/**
 * Result of VS Code detection
 */
export interface VSCodeDetectionResult {
  /** Whether a working VS Code installation was found */
  found: boolean;
  /** The installation details if found */
  installation: VSCodeInstallation | null;
  /** All locations that were searched (for debugging) */
  searchedLocations: string[];
  /** Human-readable suggestions if VS Code wasn't found */
  suggestions: string[];
  /** Any errors encountered during detection */
  errors: string[];
}

/**
 * macOS bundle identifiers for different VS Code variants
 */
const MACOS_BUNDLE_IDS: Record<VSCodeVariant, string> = {
  stable: "com.microsoft.VSCode",
  insiders: "com.microsoft.VSCodeInsiders",
  codium: "com.vscodium",
  oss: "com.visualstudio.code.oss",
};

/**
 * CLI binary names for different platforms and variants
 */
const CLI_NAMES: Record<VSCodeVariant, { unix: string; windows: string[] }> = {
  stable: { unix: "code", windows: ["code.cmd", "code.exe", "code"] },
  insiders: {
    unix: "code-insiders",
    windows: ["code-insiders.cmd", "code-insiders.exe", "code-insiders"],
  },
  codium: { unix: "codium", windows: ["codium.cmd", "codium.exe", "codium"] },
  oss: { unix: "code-oss", windows: ["code-oss.cmd", "code-oss.exe", "code-oss"] },
};

/**
 * Common installation paths per platform
 */
function getCommonPaths(variant: VSCodeVariant): string[] {
  const home = os.homedir();

  if (process.platform === "darwin") {
    const appNames: Record<VSCodeVariant, string[]> = {
      stable: ["Visual Studio Code.app"],
      insiders: ["Visual Studio Code - Insiders.app"],
      codium: ["VSCodium.app"],
      oss: ["Code - OSS.app"],
    };

    const apps = appNames[variant];
    const paths: string[] = [];

    for (const app of apps) {
      // Standard locations - all VS Code variants use the same CLI path structure
      const cliPath = `${app}/Contents/Resources/app/bin/code`;
      paths.push(`/Applications/${cliPath}`);
      paths.push(path.join(home, `Applications/${cliPath}`));
    }

    return paths;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const folderNames: Record<VSCodeVariant, string> = {
      stable: "Microsoft VS Code",
      insiders: "Microsoft VS Code Insiders",
      codium: "VSCodium",
      oss: "Code - OSS",
    };

    const folder = folderNames[variant];
    const cli = CLI_NAMES[variant].windows[0];

    return [
      path.join(localAppData, "Programs", folder, "bin", cli),
      path.join(programFiles, folder, "bin", cli),
      path.join(programFilesX86, folder, "bin", cli),
    ];
  }

  // Linux
  const binNames: Record<VSCodeVariant, string> = {
    stable: "code",
    insiders: "code-insiders",
    codium: "codium",
    oss: "code-oss",
  };

  const bin = binNames[variant];

  return [
    `/usr/bin/${bin}`,
    `/usr/share/code/bin/${bin}`,
    `/snap/bin/${bin}`,
    `/var/lib/flatpak/exports/bin/com.visualstudio.code`,
    path.join(home, ".local/bin", bin),
    path.join(home, `.local/share/${bin}/bin/${bin}`),
  ];
}

/**
 * Check if a file exists and is executable
 */
async function isExecutable(filePath: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await access(filePath, fsConstants.F_OK);
    } else {
      await access(filePath, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Use macOS Spotlight (mdfind) to find VS Code installations
 */
async function findViaMdfind(
  variant: VSCodeVariant,
  logger: Logger
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const bundleId = MACOS_BUNDLE_IDS[variant];

  try {
    const { stdout } = await execFileAsync("mdfind", [
      `kMDItemCFBundleIdentifier == '${bundleId}'`,
    ]);

    const appPath = stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.endsWith(".app"));

    if (appPath) {
      // Construct path to the CLI binary inside the app bundle
      const cliPath = path.join(appPath, "Contents/Resources/app/bin/code");
      if (await isExecutable(cliPath)) {
        logger.debug?.(
          `Found VS Code ${variant} via Spotlight: ${cliPath}`
        );
        return cliPath;
      }
    }
  } catch (error) {
    logger.debug?.(`Spotlight search for ${variant} failed:`, error);
  }

  return null;
}

/**
 * Search Homebrew Caskroom for VS Code installations
 */
async function findViaHomebrew(
  variant: VSCodeVariant,
  logger: Logger
): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  const caskNames: Record<VSCodeVariant, string> = {
    stable: "visual-studio-code",
    insiders: "visual-studio-code-insiders",
    codium: "vscodium",
    oss: "code-oss", // Not typically available via Homebrew
  };

  const cask = caskNames[variant];
  const homebrewPaths = [
    "/opt/homebrew/Caskroom", // Apple Silicon
    "/usr/local/Caskroom", // Intel
  ];

  for (const caskroom of homebrewPaths) {
    try {
      const caskPath = path.join(caskroom, cask);
      const versions = await readdir(caskPath).catch(() => []);

      for (const version of versions) {
        // Find the .app inside the version folder
        const versionPath = path.join(caskPath, version);
        const contents = await readdir(versionPath).catch(() => []);
        const appName = contents.find((f) => f.endsWith(".app"));

        if (appName) {
          const cliPath = path.join(
            versionPath,
            appName,
            "Contents/Resources/app/bin/code"
          );
          if (await isExecutable(cliPath)) {
            logger.debug?.(
              `Found VS Code ${variant} via Homebrew: ${cliPath}`
            );
            return cliPath;
          }
        }
      }
    } catch {
      // Cask not installed, continue
    }
  }

  return null;
}

/**
 * Search PATH using which/where
 */
async function findViaPath(
  variant: VSCodeVariant,
  logger: Logger
): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const cliNames = isWindows
    ? CLI_NAMES[variant].windows
    : [CLI_NAMES[variant].unix];

  for (const cli of cliNames) {
    try {
      const command = isWindows ? "where" : "which";
      const { stdout } = await execFileAsync(command, [cli]);
      const candidate = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      if (candidate && (await isExecutable(candidate))) {
        logger.debug?.(
          `Found VS Code ${variant} via PATH lookup: ${candidate}`
        );
        return normalizeExecutablePath(candidate);
      }
    } catch {
      // Not found in PATH
    }
  }

  return null;
}

/**
 * Search using login shell (picks up shell profile PATH modifications)
 */
async function findViaShell(
  variant: VSCodeVariant,
  logger: Logger
): Promise<string | null> {
  if (process.platform === "win32" || !process.env.SHELL) {
    return null;
  }

  const cli = CLI_NAMES[variant].unix;

  try {
    const { stdout } = await execFileAsync(process.env.SHELL, [
      "-lc",
      `command -v ${cli}`,
    ]);

    const candidate = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (candidate) {
      // Normalize first to handle alias/descriptor output from `command -v`
      // (e.g., "alias code='/path/to/code'" or "code is /path/to/code")
      const normalizedPath = normalizeExecutablePath(candidate);
      if (await isExecutable(normalizedPath)) {
        logger.debug?.(
          `Found VS Code ${variant} via shell lookup: ${normalizedPath}`
        );
        return normalizedPath;
      }
    }
  } catch {
    // Not found via shell
  }

  return null;
}

/**
 * Normalize executable path (handle aliases, symlinks, etc.)
 */
function normalizeExecutablePath(candidate: string): string {
  // Handle shell alias format: alias code='/path/to/code'
  const aliasMatch = candidate.match(/^alias\s+\w+=['"]?([^'"]+)['"]?$/);
  if (aliasMatch) {
    return aliasMatch[1];
  }

  // Handle 'code is /path/to/code' format from some shells
  const isMatch = candidate.match(/^\w+\s+is\s+(.+)$/);
  if (isMatch) {
    return isMatch[1];
  }

  return candidate;
}

/**
 * Verify that a VS Code executable actually works by running --version
 */
async function verifyExecutable(
  executablePath: string,
  logger: Logger
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(executablePath, ["--version"], {
      timeout: 10_000,
    });
    const version = stdout.split("\n")[0]?.trim();
    logger.debug?.(`Verified VS Code executable: ${executablePath} (${version})`);
    return true;
  } catch (error) {
    logger.debug?.(
      `VS Code executable verification failed for ${executablePath}:`,
      error
    );
    return false;
  }
}

/**
 * Main detection function - finds VS Code using all available methods
 */
export async function detectVSCode(
  logger: Logger,
  options: {
    /** Skip verification step (faster but less reliable) */
    skipVerification?: boolean;
    /** Only search for specific variants */
    variants?: VSCodeVariant[];
  } = {}
): Promise<VSCodeDetectionResult> {
  const searchedLocations: string[] = [];
  const errors: string[] = [];
  const variants = options.variants || ["stable", "insiders", "codium", "oss"];

  // Strategy 0: Check for environment variable override (highest priority)
  const envOverride = process.env.CMUX_VSCODE_PATH;
  if (envOverride) {
    searchedLocations.push(`CMUX_VSCODE_PATH=${envOverride}`);
    if (await isExecutable(envOverride)) {
      const verified =
        options.skipVerification || (await verifyExecutable(envOverride, logger));
      if (verified) {
        logger.info(
          `Using VS Code from CMUX_VSCODE_PATH environment variable: ${envOverride}`
        );
        return {
          found: true,
          installation: {
            executablePath: envOverride,
            variant: "stable", // Assume stable for manual override
            source: "env-override",
          },
          searchedLocations,
          suggestions: [],
          errors,
        };
      } else {
        errors.push(
          `CMUX_VSCODE_PATH is set to ${envOverride} but it's not a working VS Code executable`
        );
      }
    } else {
      errors.push(
        `CMUX_VSCODE_PATH is set to ${envOverride} but the file doesn't exist or isn't executable`
      );
    }
  }

  // Try each variant in order of preference
  for (const variant of variants) {
    // Strategy 1: PATH lookup (fastest)
    const pathResult = await findViaPath(variant, logger);
    if (pathResult) {
      searchedLocations.push(`PATH lookup for ${CLI_NAMES[variant].unix}`);
      const verified =
        options.skipVerification || (await verifyExecutable(pathResult, logger));
      if (verified) {
        return {
          found: true,
          installation: {
            executablePath: pathResult,
            variant,
            source: "path-lookup",
          },
          searchedLocations,
          suggestions: [],
          errors,
        };
      }
    }

    // Strategy 2: Shell lookup (handles PATH from shell profiles)
    const shellResult = await findViaShell(variant, logger);
    if (shellResult) {
      searchedLocations.push(`Shell lookup for ${CLI_NAMES[variant].unix}`);
      const verified =
        options.skipVerification || (await verifyExecutable(shellResult, logger));
      if (verified) {
        return {
          found: true,
          installation: {
            executablePath: shellResult,
            variant,
            source: "shell-lookup",
          },
          searchedLocations,
          suggestions: [],
          errors,
        };
      }
    }

    // Strategy 3: Common installation paths (no special permissions needed)
    // Check these before Spotlight/Homebrew since they cover 95%+ of standard installs
    const commonPaths = getCommonPaths(variant);
    for (const commonPath of commonPaths) {
      searchedLocations.push(commonPath);
      if (await isExecutable(commonPath)) {
        const verified =
          options.skipVerification ||
          (await verifyExecutable(commonPath, logger));
        if (verified) {
          return {
            found: true,
            installation: {
              executablePath: commonPath,
              variant,
              source: "common-path",
            },
            searchedLocations,
            suggestions: [],
            errors,
          };
        }
      }
    }

    // Strategy 4 & 5: macOS-specific fallbacks for non-standard locations
    // These might require permissions but are useful for edge cases
    if (process.platform === "darwin") {
      // Homebrew Caskroom (no special permissions needed)
      const homebrewResult = await findViaHomebrew(variant, logger);
      if (homebrewResult) {
        searchedLocations.push(`Homebrew Caskroom for ${variant}`);
        const verified =
          options.skipVerification ||
          (await verifyExecutable(homebrewResult, logger));
        if (verified) {
          return {
            found: true,
            installation: {
              executablePath: homebrewResult,
              variant,
              source: "homebrew",
            },
            searchedLocations,
            suggestions: [],
            errors,
          };
        }
      }

      // Spotlight search (might need permissions, catches custom install locations)
      const spotlightResult = await findViaMdfind(variant, logger);
      if (spotlightResult) {
        searchedLocations.push(`Spotlight search for ${MACOS_BUNDLE_IDS[variant]}`);
        const verified =
          options.skipVerification ||
          (await verifyExecutable(spotlightResult, logger));
        if (verified) {
          return {
            found: true,
            installation: {
              executablePath: spotlightResult,
              variant,
              source: "spotlight",
            },
            searchedLocations,
            suggestions: [],
            errors,
          };
        }
      }
    }
  }

  // Not found - provide helpful suggestions
  const suggestions = generateSuggestions();

  logger.warn(
    `VS Code not found. Searched ${searchedLocations.length} locations.`
  );

  return {
    found: false,
    installation: null,
    searchedLocations,
    suggestions,
    errors,
  };
}

/**
 * Generate platform-specific suggestions for installing VS Code
 */
function generateSuggestions(): string[] {
  const suggestions: string[] = [];

  suggestions.push(
    "Download and install VS Code from https://code.visualstudio.com/"
  );

  if (process.platform === "darwin") {
    suggestions.push(
      "Or install via Homebrew: brew install --cask visual-studio-code"
    );
    suggestions.push(
      "After installing, open VS Code and run 'Shell Command: Install code command in PATH' from the Command Palette (Cmd+Shift+P)"
    );
  } else if (process.platform === "win32") {
    suggestions.push(
      "Make sure to check 'Add to PATH' during installation"
    );
  } else {
    suggestions.push(
      "Or install via snap: sudo snap install code --classic"
    );
    suggestions.push(
      "Or install via your package manager (apt, dnf, pacman, etc.)"
    );
  }

  suggestions.push(
    "Alternatively, set the CMUX_VSCODE_PATH environment variable to the full path of your VS Code CLI executable"
  );

  return suggestions;
}

/**
 * Cached detection result
 */
let cachedResult: VSCodeDetectionResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // Re-check every 60 seconds if not found

/**
 * Get VS Code installation with caching
 * Re-detects if not found and cache is stale
 */
export async function getVSCodeInstallation(
  logger: Logger,
  options: { forceRefresh?: boolean } = {}
): Promise<VSCodeDetectionResult> {
  const now = Date.now();

  // Return cached result if valid
  if (
    cachedResult &&
    !options.forceRefresh &&
    (cachedResult.found || now - cacheTimestamp < CACHE_TTL_MS)
  ) {
    return cachedResult;
  }

  // Perform detection
  cachedResult = await detectVSCode(logger);
  cacheTimestamp = now;

  return cachedResult;
}

/**
 * Clear the cached detection result (useful after user installs VS Code)
 */
export function clearVSCodeDetectionCache(): void {
  cachedResult = null;
  cacheTimestamp = 0;
}

/**
 * Format detection result for user-friendly display
 */
export function formatDetectionResultForUser(
  result: VSCodeDetectionResult
): string {
  if (result.found && result.installation) {
    return `VS Code found: ${result.installation.executablePath} (${result.installation.variant}, via ${result.installation.source})`;
  }

  const lines = ["VS Code was not found on your system.", ""];

  if (result.errors.length > 0) {
    lines.push("Errors encountered:");
    for (const error of result.errors) {
      lines.push(`  • ${error}`);
    }
    lines.push("");
  }

  lines.push("To fix this:");
  for (const suggestion of result.suggestions) {
    lines.push(`  • ${suggestion}`);
  }

  return lines.join("\n");
}
