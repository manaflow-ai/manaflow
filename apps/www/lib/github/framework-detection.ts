import { type FrameworkPreset } from "@/components/preview/preview-configure-client";
import { createGitHubClient } from "@/lib/github/octokit";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export type FrameworkDetectionResult = {
  framework: FrameworkPreset;
  packageManager: PackageManager;
  maintenanceScript: string;
  devScript: string;
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type PackageJsonWithPath = {
  path: string;
  json: PackageJson;
};

type DetectorRule = {
  path?: string;
  matchPackage?: string;
  matchContent?: RegExp;
  matchScript?: RegExp;
};

type FrameworkDefinition = {
  preset: FrameworkPreset;
  detectors: {
    every?: DetectorRule[];
    some?: DetectorRule[];
  };
  supersedes?: FrameworkPreset[];
};

type DetectionContext = {
  owner: string;
  name: string;
  octokit: ReturnType<typeof createGitHubClient>;
  filePaths: Set<string> | null;
  normalizedFilePaths: Set<string> | null;
  packageJsons: PackageJsonWithPath[];
  fileExistsCache: Map<string, boolean>;
  fileContentCache: Map<string, string | null>;
  detectedPackageManager: PackageManager | null;
};

type FrameworkMatch = {
  definition: FrameworkDefinition;
};

const MAX_PACKAGE_JSON_FILES = 20;
const MIN_PACKAGE_JSONS_BEFORE_FALLBACK = 3;

// Package manager lock files in priority order (more specific first)
const PACKAGE_MANAGER_LOCK_FILES: Array<{ file: string; manager: PackageManager }> = [
  { file: "bun.lockb", manager: "bun" },
  { file: "bun.lock", manager: "bun" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package-lock.json", manager: "npm" },
];
const FALLBACK_PACKAGE_JSON_PATHS = [
  "app/package.json",
  "apps/web/package.json",
  "apps/app/package.json",
  "apps/site/package.json",
  "apps/client/package.json",
  "packages/web/package.json",
  "packages/app/package.json",
  "packages/site/package.json",
  "frontend/package.json",
  "web/package.json",
  "site/package.json",
  "client/package.json",
  "www/package.json",
];
const COMMON_PACKAGE_PARENT_HINTS = [
  "apps",
  "app",
  "packages",
  "frontend",
  "web",
  "site",
  "client",
  "services",
  "examples",
  "www",
];

// Heuristics mirror Vercel's detector list: prefer dependency matches, then config files, then scripts.
const FRAMEWORK_DEFINITIONS: FrameworkDefinition[] = [
  {
    preset: "next",
    detectors: {
      some: [
        { matchPackage: "next" },
        { path: "next.config.js" },
        { path: "next.config.ts" },
        { path: "next.config.mjs" },
        { matchScript: /\bnext\b/i },
      ],
    },
    supersedes: ["vite"],
  },
  {
    preset: "nuxt",
    detectors: {
      some: [
        { matchPackage: "nuxt" },
        { matchPackage: "nuxt3" },
        { matchPackage: "nuxt-edge" },
        { matchPackage: "nuxt-nightly" },
        { path: "nuxt.config.js" },
        { path: "nuxt.config.ts" },
        { path: "nuxt.config.mjs" },
        { matchScript: /\bnuxt\b/i },
      ],
    },
    supersedes: ["vite"],
  },
  {
    preset: "remix",
    detectors: {
      some: [
        { matchPackage: "@remix-run/dev" },
        { matchPackage: "@remix-run/node" },
        { matchPackage: "@remix-run/serve" },
        { path: "remix.config.js" },
        { path: "remix.config.ts" },
        { path: "remix.config.mjs" },
        { path: "remix.config.cjs" },
        { matchScript: /\bremix\b/i },
      ],
    },
    supersedes: ["vite"],
  },
  {
    preset: "sveltekit",
    detectors: {
      some: [
        { matchPackage: "@sveltejs/kit" },
        { path: "svelte.config.js" },
        { path: "svelte.config.ts" },
        { path: "svelte.config.mjs" },
        { matchScript: /\bsvelte-?kit\b/i },
      ],
    },
    supersedes: ["vite"],
  },
  {
    preset: "angular",
    detectors: {
      some: [
        { matchPackage: "@angular/cli" },
        { matchPackage: "@angular/core" },
        { path: "angular.json" },
        { matchScript: /\bng (serve|build)/i },
      ],
    },
  },
  {
    preset: "cra",
    detectors: {
      some: [
        { matchPackage: "react-scripts" },
        { matchPackage: "react-dev-utils" },
        { matchScript: /\breact-scripts\b/i },
      ],
    },
  },
  {
    preset: "vue",
    detectors: {
      some: [
        { matchPackage: "@vue/cli-service" },
        { path: "vue.config.js" },
        { path: "vue.config.ts" },
        { path: "vue.config.mjs" },
        { matchScript: /\bvue-cli-service\b/i },
      ],
    },
    supersedes: ["vite"],
  },
  {
    preset: "vite",
    detectors: {
      some: [
        { matchPackage: "vite" },
        { path: "vite.config.js" },
        { path: "vite.config.ts" },
        { path: "vite.config.mjs" },
        { matchScript: /\bvite\b/i },
      ],
    },
  },
];

export async function detectFrameworkAndPackageManager(
  repoFullName: string,
  accessToken?: string
): Promise<FrameworkDetectionResult> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return { framework: "other", packageManager: "npm", maintenanceScript: "", devScript: "" };
  }

  const octokit = createGitHubClient(accessToken, { useTokenRotation: true });
  const context = await buildDetectionContext(octokit, owner, name);

  const matches: FrameworkMatch[] = [];
  for (const definition of FRAMEWORK_DEFINITIONS) {
    const hit = await definitionMatches(definition, context);
    if (hit) {
      matches.push({ definition });
    }
  }

  const resolvedMatches = applySupersedes(matches);
  const framework = resolvedMatches[0]?.definition.preset ?? "other";
  const packageManager = context.detectedPackageManager ?? "npm";

  // Detect scripts from root package.json
  const { maintenanceScript, devScript } = detectScripts(context.packageJsons, packageManager);

  return { framework, packageManager, maintenanceScript, devScript };
}

function getInstallCommand(pm: PackageManager): string {
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

function getRunCommand(pm: PackageManager, scriptName: string): string {
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

function detectScripts(
  packageJsons: PackageJsonWithPath[],
  packageManager: PackageManager
): { maintenanceScript: string; devScript: string } {
  // Prefer root package.json, then first available
  const rootPkg = packageJsons.find((p) => p.path === "package.json");
  const pkg = rootPkg ?? packageJsons[0];

  if (!pkg) {
    return { maintenanceScript: "", devScript: "" };
  }

  const scripts = pkg.json.scripts ?? {};
  const maintenanceScript = getInstallCommand(packageManager);

  // Check for dev script in priority order
  const devScriptName = ["dev", "start", "serve", "develop"].find((name) => name in scripts);
  const devScript = devScriptName ? getRunCommand(packageManager, devScriptName) : "";

  return { maintenanceScript, devScript };
}

async function buildDetectionContext(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string
): Promise<DetectionContext> {
  const treeSnapshot = await fetchRepoTree(octokit, owner, name);
  const packageJsonPaths = treeSnapshot?.packageJsonPaths ?? ["package.json"];
  const packageJsons = await loadPackageJsons(
    octokit,
    owner,
    name,
    packageJsonPaths,
    !treeSnapshot || treeSnapshot.truncated
  );

  // Detect package manager from lock files
  const detectedPackageManager = await detectPackageManager(
    octokit,
    owner,
    name,
    treeSnapshot?.normalizedFilePaths ?? null,
    treeSnapshot?.truncated ?? false
  );

  return {
    owner,
    name,
    octokit,
    filePaths: treeSnapshot?.filePaths ?? null,
    normalizedFilePaths: treeSnapshot?.normalizedFilePaths ?? null,
    packageJsons,
    fileExistsCache: new Map<string, boolean>(),
    fileContentCache: new Map<string, string | null>(),
    detectedPackageManager,
  };
}

async function detectPackageManager(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  normalizedFilePaths: Set<string> | null,
  treeTruncated: boolean
): Promise<PackageManager | null> {
  // Fast path: check tree snapshot (0 API requests)
  for (const { file, manager } of PACKAGE_MANAGER_LOCK_FILES) {
    if (normalizedFilePaths?.has(file.toLowerCase())) {
      return manager;
    }
  }

  // If tree available and NOT truncated, we already checked everything
  if (normalizedFilePaths && !treeTruncated) {
    return null;
  }

  // Slow path: single GraphQL request to check all lock files
  // Used when tree is unavailable OR truncated (lock files may be missing from snapshot)
  return detectPackageManagerViaGraphQL(octokit, owner, name);
}

async function detectPackageManagerViaGraphQL(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string
): Promise<PackageManager | null> {
  // Build aliases for each lock file: bunLockb, bunLock, pnpmLock, etc.
  const aliasMap: Array<{ alias: string; file: string; manager: PackageManager }> =
    PACKAGE_MANAGER_LOCK_FILES.map(({ file, manager }, i) => ({
      alias: `file${i}`,
      file,
      manager,
    }));

  // Build GraphQL query with aliases
  const objectQueries = aliasMap
    .map(({ alias, file }) => `${alias}: object(expression: "HEAD:${file}") { oid }`)
    .join("\n      ");

  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${objectQueries}
      }
    }
  `;

  try {
    const result = await octokit.graphql<{
      repository: Record<string, { oid: string } | null> | null;
    }>(query, { owner, name });

    if (!result.repository) {
      return null;
    }

    // Return first match in priority order
    for (const { alias, manager } of aliasMap) {
      if (result.repository[alias]?.oid) {
        return manager;
      }
    }

    return null;
  } catch (error) {
    console.error("GraphQL lock file detection failed, falling back to REST", error);
    // Fallback to parallel REST if GraphQL fails
    const results = await Promise.all(
      PACKAGE_MANAGER_LOCK_FILES.map(async ({ file, manager }) => {
        const exists = await repoFileExists(octokit, owner, name, file);
        return exists ? manager : null;
      })
    );
    return results.find((r): r is PackageManager => r !== null) ?? null;
  }
}

async function fetchRepoTree(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string
): Promise<{
  filePaths: Set<string>;
  normalizedFilePaths: Set<string>;
  packageJsonPaths: string[];
  truncated: boolean;
} | null> {
  try {
    const repo = await octokit.request("GET /repos/{owner}/{repo}", { owner, repo: name });
    const defaultBranch = repo.data.default_branch ?? "main";

    const tree = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
      owner,
      repo: name,
      tree_sha: defaultBranch,
      recursive: "1",
    });

    const paths = new Set<string>();
    const normalized = new Set<string>();
    const packageJsonPaths: string[] = [];

    const entries = Array.isArray(tree.data.tree) ? tree.data.tree : [];
    for (const entry of entries) {
      if (!entry?.path || entry.type !== "blob") continue;
      paths.add(entry.path);
      normalized.add(entry.path.toLowerCase());
      if (entry.path.toLowerCase().endsWith("package.json")) {
        packageJsonPaths.push(entry.path);
      }
    }

    if (packageJsonPaths.length === 0) {
      packageJsonPaths.push("package.json");
    }

    return {
      filePaths: paths,
      normalizedFilePaths: normalized,
      packageJsonPaths,
      truncated: Boolean((tree.data as { truncated?: boolean }).truncated),
    };
  } catch (error) {
    console.error("Failed to fetch repository tree", { owner, name, error });
    return null;
  }
}

async function loadPackageJsons(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  packageJsonPaths: string[],
  includeFallbackCandidates: boolean
): Promise<PackageJsonWithPath[]> {
  const sortedPaths = prioritizePackageJsonPaths([...new Set(packageJsonPaths)]).slice(0, MAX_PACKAGE_JSON_FILES);
  const seenPaths = new Set(sortedPaths);

  // Parallel fetch all package.json files
  const results = await Promise.all(
    sortedPaths.map(async (path) => {
      const pkg = await fetchPackageJson(octokit, owner, name, path);
      return pkg ? { path, json: pkg } : null;
    })
  );
  const packages = results.filter((r): r is PackageJsonWithPath => r !== null);

  // If nothing could be fetched, still try the root package.json once more as a fallback.
  if (packages.length === 0 && !seenPaths.has("package.json")) {
    const fallbackRoot = await fetchPackageJson(octokit, owner, name, "package.json");
    if (fallbackRoot) {
      packages.push({ path: "package.json", json: fallbackRoot });
    }
  }

  const shouldTryFallbackCandidates =
    packages.length === 0 || (includeFallbackCandidates && packages.length < MIN_PACKAGE_JSONS_BEFORE_FALLBACK);

  if (shouldTryFallbackCandidates) {
    // Parallel fetch fallback candidates
    const candidatesToTry = FALLBACK_PACKAGE_JSON_PATHS
      .filter((c) => !seenPaths.has(c))
      .slice(0, MAX_PACKAGE_JSON_FILES - packages.length);

    const fallbackResults = await Promise.all(
      candidatesToTry.map(async (path) => {
        const pkg = await fetchPackageJson(octokit, owner, name, path);
        return pkg ? { path, json: pkg } : null;
      })
    );
    packages.push(...fallbackResults.filter((r): r is PackageJsonWithPath => r !== null));
  }

  return packages;
}

function prioritizePackageJsonPaths(paths: string[]): string[] {
  return paths.sort((a, b) => packageJsonScore(a) - packageJsonScore(b));
}

function packageJsonScore(path: string): number {
  const normalized = path.toLowerCase();
  if (normalized === "package.json") {
    return -1;
  }

  const segments = normalized.split("/");
  const depth = segments.length - 1;
  const parent = segments.length > 1 ? segments[segments.length - 2] : "";
  const hintIndex = COMMON_PACKAGE_PARENT_HINTS.findIndex(
    (hint) => normalized.startsWith(`${hint}/`) || normalized.includes(`/${hint}/`) || parent === hint
  );
  const hintScore = hintIndex >= 0 ? hintIndex : COMMON_PACKAGE_PARENT_HINTS.length;

  return depth + hintScore * 0.1;
}

async function definitionMatches(definition: FrameworkDefinition, context: DetectionContext): Promise<boolean> {
  const { every = [], some = [] } = definition.detectors;

  for (const rule of every) {
    const matches = await ruleMatches(rule, context);
    if (!matches) {
      return false;
    }
  }

  if (some.length === 0) {
    return true;
  }

  for (const rule of some) {
    if (await ruleMatches(rule, context)) {
      return true;
    }
  }

  return false;
}

async function ruleMatches(rule: DetectorRule, context: DetectionContext): Promise<boolean> {
  if (rule.matchPackage) {
    const hasPackage = context.packageJsons.some((pkg) =>
      packageHasDependency(pkg.json, rule.matchPackage as string)
    );
    if (hasPackage) {
      return true;
    }
  }

  if (rule.matchScript) {
    const hasScriptMatch = context.packageJsons.some((pkg) =>
      packageHasScript(pkg.json, rule.matchScript as RegExp)
    );
    if (hasScriptMatch) {
      return true;
    }
  }

  if (rule.path) {
    const exists = await hasPath(rule.path, context);
    if (!exists) {
      return false;
    }

    if (rule.matchContent) {
      const content = await readFileWithCache(rule.path, context);
      return Boolean(content && rule.matchContent.test(content));
    }

    return true;
  }

  if (rule.matchContent) {
    const rootPackage = context.packageJsons.find((pkg) => pkg.path === "package.json");
    if (!rootPackage) {
      return false;
    }

    const serialized = JSON.stringify(rootPackage.json);
    return rule.matchContent.test(serialized);
  }

  return false;
}

async function hasPath(path: string, context: DetectionContext): Promise<boolean> {
  const normalized = path.toLowerCase();
  if (context.normalizedFilePaths && context.normalizedFilePaths.has(normalized)) {
    return true;
  }

  if (context.fileExistsCache.has(normalized)) {
    return context.fileExistsCache.get(normalized) as boolean;
  }

  const exists = await repoFileExists(context.octokit, context.owner, context.name, path);
  context.fileExistsCache.set(normalized, exists);
  return exists;
}

async function readFileWithCache(path: string, context: DetectionContext): Promise<string | null> {
  if (context.fileContentCache.has(path)) {
    return context.fileContentCache.get(path) ?? null;
  }

  const content = await readRepoFile(context.octokit, context.owner, context.name, path);
  context.fileContentCache.set(path, content);
  return content;
}

async function fetchPackageJson(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  path: string
): Promise<PackageJson | null> {
  const content = await readRepoFile(octokit, owner, name, path);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as PackageJson;
  } catch (error) {
    console.error("Failed to parse package.json", { owner, name, path, error });
    return null;
  }
}

async function readRepoFile(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  path: string
): Promise<string | null> {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo: name,
      path,
    });

    if (!res.data || Array.isArray(res.data) || !("content" in res.data)) {
      return null;
    }

    const data = res.data as { content?: string };
    if (!data.content) {
      return null;
    }

    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : null;
    if (status !== 404) {
      console.error("Failed to read repository file", { owner, name, path, error });
    }
    return null;
  }
}

async function repoFileExists(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  path: string
): Promise<boolean> {
  try {
    await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo: name,
      path,
    });
    return true;
  } catch {
    return false;
  }
}

function packageHasDependency(pkg: PackageJson, dependency: string): boolean {
  const groups = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
    pkg.optionalDependencies,
  ];

  return groups.some((group) => Boolean(group && dependency in group));
}

function packageHasScript(pkg: PackageJson, scriptMatcher: RegExp): boolean {
  return Object.values(pkg.scripts ?? {}).some((script) => scriptMatcher.test(script));
}

function applySupersedes(matches: FrameworkMatch[]): FrameworkMatch[] {
  const result = [...matches];
  for (const match of matches) {
    if (!match.definition.supersedes) {
      continue;
    }

    for (const superseded of match.definition.supersedes) {
      const index = result.findIndex((candidate) => candidate.definition.preset === superseded);
      if (index >= 0) {
        result.splice(index, 1);
      }
    }
  }

  return result;
}
