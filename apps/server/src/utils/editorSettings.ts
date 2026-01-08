import type { AuthFile } from "@cmux/shared/worker-schemas";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { serverLogger } from "./fileLogger";

const execFileAsync = promisify(execFile);

type EditorId = "vscode" | "cursor" | "windsurf";

interface EditorDef {
  id: EditorId;
  labels: string[];
  cliCandidates: string[];
  extDirs: string[];
}

interface FileExport {
  path: string;
  content: string;
  mtimeMs?: number;
}

interface EditorExport {
  id: EditorId;
  userDir: string;
  settings?: FileExport;
  keybindings?: FileExport;
  snippets: FileExport[];
  extensions?: string[];
  settingsMtimeMs?: number;
}

export interface EditorSettingsUpload {
  authFiles: AuthFile[];
  startupCommands: string[];
  sourceEditor: EditorId;
  settingsPath?: string;
}

// User-uploaded settings from Convex (web UI)
export interface UserUploadedEditorSettings {
  settingsJson?: string;
  keybindingsJson?: string;
  snippets?: Array<{ name: string; content: string }>;
  extensions?: string; // newline-separated extension IDs
}

const homeDir = os.homedir();
const posix = path.posix;

// IDE Provider path configurations
type IdeProvider = "coder" | "openvscode" | "cmux-code";

interface IdePaths {
  userDir: string;
  profileDir: string | null;
  machineDir: string;
  snippetsDir: string;
  extensionsDir: string;
  binaryPath: string;
}

const IDE_PATHS: Record<IdeProvider, IdePaths> = {
  coder: {
    userDir: "/root/.code-server/User",
    profileDir: null, // Coder doesn't use profiles
    machineDir: "/root/.code-server/Machine",
    snippetsDir: "/root/.code-server/User/snippets",
    extensionsDir: "/root/.code-server/extensions",
    binaryPath: "/app/code-server/bin/code-server",
  },
  openvscode: {
    userDir: "/root/.openvscode-server/data/User",
    profileDir: "/root/.openvscode-server/data/User/profiles/default-profile",
    machineDir: "/root/.openvscode-server/data/Machine",
    snippetsDir: "/root/.openvscode-server/data/User/snippets",
    extensionsDir: "/root/.openvscode-server/extensions",
    binaryPath: "/app/openvscode-server/bin/openvscode-server",
  },
  "cmux-code": {
    userDir: "/root/.vscode-server-oss/data/User",
    profileDir: "/root/.vscode-server-oss/data/User/profiles/default-profile",
    machineDir: "/root/.vscode-server-oss/data/Machine",
    snippetsDir: "/root/.vscode-server-oss/data/User/snippets",
    extensionsDir: "/root/.vscode-server-oss/extensions",
    binaryPath: "/app/cmux-code/bin/code-server-oss",
  },
};

const CMUX_INTERNAL_DIR = "/root/.cmux";
const EXTENSION_LIST_PATH = posix.join(CMUX_INTERNAL_DIR, "user-extensions.txt");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedResult:
  | {
      timestamp: number;
      value: EditorSettingsUpload | null;
    }
  | null = null;
let inflightPromise: Promise<EditorSettingsUpload | null> | null = null;

const editors: EditorDef[] = [
  {
    id: "vscode",
    labels: ["Code", "Code - Insiders", "VSCodium"],
    cliCandidates: [
      "code",
      "code-insiders",
      "codium",
      macAppBin("Visual Studio Code", "code"),
      macAppBin("Visual Studio Code - Insiders", "code-insiders"),
      macAppBin("VSCodium", "codium"),
    ],
    extDirs: [
      path.join(homeDir, ".vscode", "extensions"),
      path.join(homeDir, ".vscode-insiders", "extensions"),
      path.join(homeDir, ".vscodium", "extensions"),
    ],
  },
  {
    id: "cursor",
    labels: ["Cursor"],
    cliCandidates: ["cursor", macAppBin("Cursor", "cursor")],
    extDirs: [path.join(homeDir, ".cursor", "extensions")],
  },
  {
    id: "windsurf",
    labels: ["Windsurf"],
    cliCandidates: ["windsurf", macAppBin("Windsurf", "windsurf")],
    extDirs: [path.join(homeDir, ".windsurf", "extensions")],
  },
];

function isMac() {
  return process.platform === "darwin";
}

function isWin() {
  return process.platform === "win32";
}

function candidateUserDir(appFolderName: string): string {
  if (isMac()) {
    return path.join(
      homeDir,
      "Library",
      "Application Support",
      appFolderName,
      "User"
    );
  }
  if (isWin()) {
    const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(appData, appFolderName, "User");
  }
  return path.join(homeDir, ".config", appFolderName, "User");
}

function macAppBin(appName: string, bin: string) {
  if (!isMac()) {
    return "";
  }
  return path.join(
    "/Applications",
    `${appName}.app`,
    "Contents",
    "Resources",
    "app",
    "bin",
    bin
  );
}

async function pathExists(target: string): Promise<boolean> {
  if (!target) return false;
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function runCliListExtensions(
  cliCandidates: string[]
): Promise<string[] | undefined> {
  for (const cli of cliCandidates) {
    try {
      if (!cli) continue;
      if (path.isAbsolute(cli) && !(await pathExists(cli))) {
        continue;
      }
      const { stdout } = await execFileAsync(
        cli,
        ["--list-extensions", "--show-versions"],
        {
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5000,
        }
      );
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split("@")[0]);
      if (lines.length > 0) {
        return Array.from(new Set(lines)).sort();
      }
    } catch {
      // Ignore CLI errors and try the next candidate
    }
  }
  return undefined;
}

async function listExtensionsFromDirs(
  dirs: string[]
): Promise<string[] | undefined> {
  const identifiers = new Set<string>();
  for (const dir of dirs) {
    if (!(await pathExists(dir))) continue;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const packageJsonPath = path.join(dir, entry.name, "package.json");
      try {
        const pkg = JSON.parse(
          await fs.readFile(packageJsonPath, "utf8")
        ) as { publisher?: string; name?: string };
        if (pkg.publisher && pkg.name) {
          identifiers.add(`${pkg.publisher}.${pkg.name}`);
        }
      } catch {
        // Ignore malformed package.json entries
      }
    }
  }
  if (identifiers.size === 0) {
    return undefined;
  }
  return Array.from(identifiers).sort();
}

async function exportEditor(def: EditorDef): Promise<EditorExport | null> {
  let userDir: string | undefined;
  for (const label of def.labels) {
    const cand = candidateUserDir(label);
    if (await pathExists(cand)) {
      userDir = cand;
      break;
    }
  }
  if (!userDir) {
    return null;
  }

  const result: EditorExport = {
    id: def.id,
    userDir,
    snippets: [],
  };

  const settingsPath = path.join(userDir, "settings.json");
  if (await pathExists(settingsPath)) {
    const [content, stats] = await Promise.all([
      fs.readFile(settingsPath, "utf8"),
      fs.stat(settingsPath),
    ]);
    result.settings = {
      path: settingsPath,
      content,
      mtimeMs: stats.mtimeMs,
    };
    result.settingsMtimeMs = stats.mtimeMs;
  }

  const keybindingsPath = path.join(userDir, "keybindings.json");
  if (await pathExists(keybindingsPath)) {
    result.keybindings = {
      path: keybindingsPath,
      content: await fs.readFile(keybindingsPath, "utf8"),
    };
  }

  const snippetsDir = path.join(userDir, "snippets");
  if (await pathExists(snippetsDir)) {
    const snippetFiles = await listJsonFiles(snippetsDir);
    for (const snippetFile of snippetFiles) {
      try {
        result.snippets.push({
          path: snippetFile,
          content: await fs.readFile(snippetFile, "utf8"),
        });
      } catch {
        // Ignore unreadable snippet files
      }
    }
  }

  let extensions = await runCliListExtensions(def.cliCandidates);
  if (!extensions) {
    extensions = await listExtensionsFromDirs(def.extDirs);
  }
  if (extensions && extensions.length > 0) {
    result.extensions = extensions;
  }

  if (
    !result.settings &&
    !result.keybindings &&
    result.snippets.length === 0 &&
    !result.extensions
  ) {
    return null;
  }

  return result;
}

function encode(content: string): string {
  return Buffer.from(content).toString("base64");
}

function buildExtensionInstallCommand(listPath: string): string {
  // Build a script that auto-detects IDE provider from /etc/cmux/ide.env
  const scriptBody = [
    "set -euo pipefail",
    `EXT_LIST="${listPath}"`,
    "mkdir -p /root/.cmux",
    'LOG_FILE="/root/.cmux/install-extensions.log"',
    'touch "$LOG_FILE"',
    'if [ ! -s "$EXT_LIST" ]; then echo "No extensions to install (list empty)" >>"$LOG_FILE"; exit 0; fi',
    "",
    "# Detect IDE provider from env file",
    'IDE_PROVIDER="openvscode"',
    'if [ -f /etc/cmux/ide.env ]; then',
    '  . /etc/cmux/ide.env',
    "fi",
    "",
    '# Set paths based on IDE provider',
    'if [ "$IDE_PROVIDER" = "coder" ]; then',
    '  EXT_DIR="/root/.code-server/extensions"',
    '  USER_DIR="/root/.code-server"',
    '  CLI_PATH="/app/code-server/bin/code-server"',
    'elif [ "$IDE_PROVIDER" = "cmux-code" ]; then',
    '  EXT_DIR="/root/.vscode-server-oss/extensions"',
    '  USER_DIR="/root/.vscode-server-oss/data"',
    '  CLI_PATH="/app/cmux-code/bin/code-server-oss"',
    "else",
    '  EXT_DIR="/root/.openvscode-server/extensions"',
    '  USER_DIR="/root/.openvscode-server/data"',
    '  CLI_PATH="/app/openvscode-server/bin/openvscode-server"',
    "fi",
    "",
    '# Fallback CLI detection',
    'if [ ! -x "$CLI_PATH" ]; then',
    '  if [ -x /app/cmux-code/bin/code-server-oss ]; then',
    '    CLI_PATH="/app/cmux-code/bin/code-server-oss"',
    '    EXT_DIR="/root/.vscode-server-oss/extensions"',
    '    USER_DIR="/root/.vscode-server-oss/data"',
    '  elif [ -x /app/code-server/bin/code-server ]; then',
    '    CLI_PATH="/app/code-server/bin/code-server"',
    '    EXT_DIR="/root/.code-server/extensions"',
    '    USER_DIR="/root/.code-server"',
    '  elif [ -x /app/openvscode-server/bin/openvscode-server ]; then',
    '    CLI_PATH="/app/openvscode-server/bin/openvscode-server"',
    '    EXT_DIR="/root/.openvscode-server/extensions"',
    '    USER_DIR="/root/.openvscode-server/data"',
    "  fi",
    "fi",
    "",
    'if [ ! -x "$CLI_PATH" ]; then',
    '  echo "No IDE CLI found in standard locations" >>"$LOG_FILE"',
    "  exit 0",
    "fi",
    "",
    'echo "Installing extensions with $CLI_PATH (provider: $IDE_PROVIDER)" >>"$LOG_FILE"',
    'chmod +x "$CLI_PATH" || true',
    'mkdir -p "$EXT_DIR" "$USER_DIR"',
    'ext=""',
    'installed_any=0',
    'pids=()',
    'had_failure=0',
    'while IFS= read -r ext; do',
    '  [ -z "$ext" ] && continue',
    '  installed_any=1',
    '  echo "-> Installing $ext" >>"$LOG_FILE"',
    '  (',
    '    if "$CLI_PATH" --install-extension "$ext" --force --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" >>"$LOG_FILE" 2>&1; then',
    '      echo "✓ Installed $ext" >>"$LOG_FILE"',
    "    else",
    '      echo "Failed to install $ext" >>"$LOG_FILE"',
    "      exit 1",
    "    fi",
    '  ) &',
    '  pids+=("$!")',
    'done < "$EXT_LIST"',
    'if [ "$installed_any" -eq 0 ]; then',
    '  echo "No valid extension identifiers found" >>"$LOG_FILE"',
    "fi",
    'for pid in "${pids[@]}"; do',
    '  if ! wait "$pid"; then',
    '    had_failure=1',
    "  fi",
    "done",
    'if [ "$had_failure" -ne 0 ]; then',
    '  echo "One or more extensions failed to install" >>"$LOG_FILE"',
    "fi",
  ].join("\n");

  return [
    "set -euo pipefail",
    'INSTALL_SCRIPT="$(mktemp /tmp/cmux-install-extensions-XXXXXX.sh)"',
    'trap \'rm -f "$INSTALL_SCRIPT"\' EXIT',
    'cat <<\'EOF\' >"$INSTALL_SCRIPT"',
    scriptBody,
    "EOF",
    'bash "$INSTALL_SCRIPT"',
  ].join("\n");
}

/**
 * Build EditorSettingsUpload from user-uploaded settings (web UI)
 * This converts user-provided JSON strings into authFiles for the sandbox
 */
function buildUploadFromUserSettings(
  userSettings: UserUploadedEditorSettings
): EditorSettingsUpload | null {
  const authFiles: AuthFile[] = [];
  const startupCommands: string[] = [];

  if (userSettings.settingsJson) {
    const encodedSettings = encode(userSettings.settingsJson);
    // Write settings to all IDE provider locations for compatibility
    const targets = [
      // cmux-code paths
      posix.join(IDE_PATHS["cmux-code"].userDir, "settings.json"),
      posix.join(
        IDE_PATHS["cmux-code"].profileDir ?? IDE_PATHS["cmux-code"].userDir,
        "settings.json"
      ),
      posix.join(IDE_PATHS["cmux-code"].machineDir, "settings.json"),
      // OpenVSCode paths
      posix.join(IDE_PATHS.openvscode.userDir, "settings.json"),
      posix.join(
        IDE_PATHS.openvscode.profileDir ?? IDE_PATHS.openvscode.userDir,
        "settings.json"
      ),
      posix.join(IDE_PATHS.openvscode.machineDir, "settings.json"),
      // Coder paths
      posix.join(IDE_PATHS.coder.userDir, "settings.json"),
      posix.join(IDE_PATHS.coder.machineDir, "settings.json"),
    ];
    for (const destinationPath of targets) {
      authFiles.push({
        destinationPath,
        contentBase64: encodedSettings,
        mode: "644",
      });
    }
  }

  if (userSettings.keybindingsJson) {
    const encodedKeybindings = encode(userSettings.keybindingsJson);
    // Write keybindings to all IDE provider locations
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS["cmux-code"].userDir, "keybindings.json"),
      contentBase64: encodedKeybindings,
      mode: "644",
    });
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS.openvscode.userDir, "keybindings.json"),
      contentBase64: encodedKeybindings,
      mode: "644",
    });
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS.coder.userDir, "keybindings.json"),
      contentBase64: encodedKeybindings,
      mode: "644",
    });
  }

  if (userSettings.snippets && userSettings.snippets.length > 0) {
    for (const snippet of userSettings.snippets) {
      if (!snippet.name || !snippet.content) continue;
      // Sanitize filename to prevent path traversal attacks
      const sanitizedName = posix.basename(snippet.name);
      if (!sanitizedName) continue;
      const encodedSnippet = encode(snippet.content);
      // Write snippets to all IDE provider locations
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS["cmux-code"].snippetsDir, sanitizedName),
        contentBase64: encodedSnippet,
        mode: "644",
      });
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS.openvscode.snippetsDir, sanitizedName),
        contentBase64: encodedSnippet,
        mode: "644",
      });
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS.coder.snippetsDir, sanitizedName),
        contentBase64: encodedSnippet,
        mode: "644",
      });
    }
  }

  if (userSettings.extensions) {
    const extensionList = userSettings.extensions
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (extensionList.length > 0) {
      const uniqueExtensions = Array.from(new Set(extensionList)).sort();
      const extensionContent = `${uniqueExtensions.join("\n")}\n`;
      authFiles.push({
        destinationPath: EXTENSION_LIST_PATH,
        contentBase64: encode(extensionContent),
        mode: "644",
      });

      // Create background installation script that auto-executes on shell startup
      const installScriptPath = "/root/.cmux/install-extensions-background.sh";
      const installScript = buildExtensionInstallCommand(EXTENSION_LIST_PATH);

      // Create self-contained background installer with lock mechanism
      const backgroundWrapper = `#!/bin/bash
# Background extension installer - runs once per container

LOCK_FILE="/root/.cmux/extensions-install.lock"
DONE_FILE="/root/.cmux/extensions-installed"

# Skip if already done
[ -f "$DONE_FILE" ] && exit 0

# Skip if already running
[ -f "$LOCK_FILE" ] && exit 0

# Create lock file
touch "$LOCK_FILE"

# Run installation in detached background
(
  ${installScript}
  touch "$DONE_FILE"
  rm -f "$LOCK_FILE"
) > /root/.cmux/install-extensions-background.log 2>&1 &
`;

      authFiles.push({
        destinationPath: installScriptPath,
        contentBase64: encode(backgroundWrapper),
        mode: "755",
      });

      // Use /etc/profile.d/ for automatic execution on all shell sessions
      const profileHook = `# cmux: Auto-trigger extension installation in background (non-blocking)
(
  if [ -f "${installScriptPath}" ]; then
    nohup "${installScriptPath}" >/dev/null 2>&1 &
  fi
) >/dev/null 2>&1 &
`;

      authFiles.push({
        destinationPath: "/etc/profile.d/cmux-extensions.sh",
        contentBase64: encode(profileHook),
        mode: "644",
      });
    }
  }

  if (authFiles.length === 0 && startupCommands.length === 0) {
    return null;
  }

  return {
    authFiles,
    startupCommands,
    sourceEditor: "vscode" as EditorId, // User-uploaded settings don't have a specific source
    settingsPath: undefined,
  };
}

function buildUpload(editor: EditorExport): EditorSettingsUpload | null {
  const authFiles: AuthFile[] = [];
  const startupCommands: string[] = [];

  if (editor.settings) {
    const encodedSettings = encode(editor.settings.content);
    // Write settings to both IDE provider locations for compatibility
    // The correct one will be used based on which IDE is installed
    const targets = [
      // cmux-code paths
      posix.join(IDE_PATHS["cmux-code"].userDir, "settings.json"),
      posix.join(
        IDE_PATHS["cmux-code"].profileDir ?? IDE_PATHS["cmux-code"].userDir,
        "settings.json"
      ),
      posix.join(IDE_PATHS["cmux-code"].machineDir, "settings.json"),
      // OpenVSCode paths
      posix.join(IDE_PATHS.openvscode.userDir, "settings.json"),
      posix.join(
        IDE_PATHS.openvscode.profileDir ?? IDE_PATHS.openvscode.userDir,
        "settings.json"
      ),
      posix.join(IDE_PATHS.openvscode.machineDir, "settings.json"),
      // Coder paths
      posix.join(IDE_PATHS.coder.userDir, "settings.json"),
      posix.join(IDE_PATHS.coder.machineDir, "settings.json"),
    ];
    for (const destinationPath of targets) {
      authFiles.push({
        destinationPath,
        contentBase64: encodedSettings,
        mode: "644",
      });
    }
  }

  if (editor.keybindings) {
    // Write keybindings to all IDE provider locations
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS["cmux-code"].userDir, "keybindings.json"),
      contentBase64: encode(editor.keybindings.content),
      mode: "644",
    });
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS.openvscode.userDir, "keybindings.json"),
      contentBase64: encode(editor.keybindings.content),
      mode: "644",
    });
    authFiles.push({
      destinationPath: posix.join(IDE_PATHS.coder.userDir, "keybindings.json"),
      contentBase64: encode(editor.keybindings.content),
      mode: "644",
    });
  }

  if (editor.snippets.length > 0) {
    for (const snippet of editor.snippets) {
      const name = path.basename(snippet.path);
      if (!name) continue;
      // Write snippets to all IDE provider locations
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS["cmux-code"].snippetsDir, name),
        contentBase64: encode(snippet.content),
        mode: "644",
      });
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS.openvscode.snippetsDir, name),
        contentBase64: encode(snippet.content),
        mode: "644",
      });
      authFiles.push({
        destinationPath: posix.join(IDE_PATHS.coder.snippetsDir, name),
        contentBase64: encode(snippet.content),
        mode: "644",
      });
    }
  }

  if (editor.extensions && editor.extensions.length > 0) {
    const uniqueExtensions = Array.from(new Set(editor.extensions)).sort();
    const extensionContent = `${uniqueExtensions.join("\n")}\n`;
    authFiles.push({
      destinationPath: EXTENSION_LIST_PATH,
      contentBase64: encode(extensionContent),
      mode: "644",
    });

    // Create background installation script that auto-executes on shell startup
    const installScriptPath = "/root/.cmux/install-extensions-background.sh";
    const installScript = buildExtensionInstallCommand(EXTENSION_LIST_PATH);

    // Create self-contained background installer with lock mechanism
    const backgroundWrapper = `#!/bin/bash
# Background extension installer - runs once per container

LOCK_FILE="/root/.cmux/extensions-install.lock"
DONE_FILE="/root/.cmux/extensions-installed"

# Skip if already done
[ -f "$DONE_FILE" ] && exit 0

# Skip if already running
[ -f "$LOCK_FILE" ] && exit 0

# Create lock file
touch "$LOCK_FILE"

# Run installation in detached background
(
  ${installScript}
  touch "$DONE_FILE"
  rm -f "$LOCK_FILE"
) > /root/.cmux/install-extensions-background.log 2>&1 &
`;

    authFiles.push({
      destinationPath: installScriptPath,
      contentBase64: encode(backgroundWrapper),
      mode: "755",
    });

    // Use /etc/profile.d/ for automatic execution on all shell sessions
    // This is the standard Linux mechanism for global shell initialization
    // Use subshell with disown to ensure it never blocks shell initialization
    const profileHook = `# cmux: Auto-trigger extension installation in background (non-blocking)
(
  if [ -f "${installScriptPath}" ]; then
    nohup "${installScriptPath}" >/dev/null 2>&1 &
  fi
) >/dev/null 2>&1 &
`;

    authFiles.push({
      destinationPath: "/etc/profile.d/cmux-extensions.sh",
      contentBase64: encode(profileHook),
      mode: "644",
    });
  }

  if (authFiles.length === 0 && startupCommands.length === 0) {
    return null;
  }

  return {
    authFiles,
    startupCommands,
    sourceEditor: editor.id,
    settingsPath: editor.settings?.path,
  };
}

async function collectEditorSettings(): Promise<EditorSettingsUpload | null> {
  const results = await Promise.all(editors.map((def) => exportEditor(def)));
  const available = results.filter(
    (result): result is EditorExport => result !== null
  );

  if (available.length === 0) {
    return null;
  }

  available.sort(
    (a, b) => (b.settingsMtimeMs ?? -Infinity) - (a.settingsMtimeMs ?? -Infinity)
  );
  const selected =
    available.find((editor) => editor.settings) ?? available[0] ?? null;

  if (!selected) {
    return null;
  }

  const upload = buildUpload(selected);
  if (!upload) {
    return null;
  }

  serverLogger.info(
    `[EditorSettings] Selected ${upload.sourceEditor} settings${
      upload.settingsPath ? ` from ${upload.settingsPath}` : ""
    }`
  );

  return upload;
}

/**
 * Get editor settings upload.
 * If userUploadedSettings is provided, it overrides auto-detected settings.
 * Otherwise, auto-detection is used (with caching).
 */
export async function getEditorSettingsUpload(
  userUploadedSettings?: UserUploadedEditorSettings | null
): Promise<EditorSettingsUpload | null> {
  // If user uploaded settings are provided, use them (no caching - they come from DB)
  if (userUploadedSettings) {
    const hasAnySettings =
      userUploadedSettings.settingsJson ||
      userUploadedSettings.keybindingsJson ||
      (userUploadedSettings.snippets && userUploadedSettings.snippets.length > 0) ||
      userUploadedSettings.extensions;

    if (hasAnySettings) {
      serverLogger.info("[EditorSettings] Using user-uploaded settings from web UI");
      return buildUploadFromUserSettings(userUploadedSettings);
    }
  }

  // Fall back to auto-detection (with caching)
  if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.value;
  }
  if (!inflightPromise) {
    inflightPromise = collectEditorSettings()
      .then((value) => {
        cachedResult = { timestamp: Date.now(), value };
        inflightPromise = null;
        return value;
      })
      .catch((error) => {
        inflightPromise = null;
        serverLogger.warn(
          "[EditorSettings] Failed to collect editor settings",
          error
        );
        cachedResult = { timestamp: Date.now(), value: null };
        return null;
      });
  }
  return inflightPromise;
}
