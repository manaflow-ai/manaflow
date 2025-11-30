import { createGitHubClient } from "@/lib/github/octokit";
import { type FrameworkPreset } from "@/components/preview/preview-configure-client";

// ============================================================================
// Types - Vercel-inspired framework detection system
// ============================================================================

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  name?: string;
};

/**
 * Detector item types - each detector checks one condition
 */
type DetectorItem =
  | { path: string } // Check if file exists at path
  | { matchPackage: string } // Check if package exists in dependencies/devDependencies
  | { matchContent: string; paths: string[] } // Check if content matches regex in any of the paths
  | { matchScript: string }; // Check if any npm script contains this string/regex

/**
 * Detector configuration - supports AND/OR logic
 * - `every`: ALL conditions must match (AND)
 * - `some`: AT LEAST ONE condition must match (OR)
 */
type Detector = {
  every?: DetectorItem[];
  some?: DetectorItem[];
};

/**
 * Framework definition with detection rules and metadata
 */
type FrameworkDefinition = {
  slug: FrameworkPreset;
  name: string;
  detectors: Detector;
  /** Higher priority wins when multiple frameworks match */
  priority?: number;
};

// ============================================================================
// GitHub API Helpers
// ============================================================================

type RepoContext = {
  owner: string;
  repo: string;
  octokit: ReturnType<typeof createGitHubClient>;
  /** Cache for file existence checks */
  fileExistsCache: Map<string, boolean>;
  /** Cache for file content */
  fileContentCache: Map<string, string | null>;
  /** Cached package.json */
  packageJson: PackageJson | null;
};

async function createRepoContext(repoFullName: string): Promise<RepoContext | null> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return null;
  }

  const octokit = createGitHubClient(undefined, { useTokenRotation: true });

  return {
    owner,
    repo,
    octokit,
    fileExistsCache: new Map(),
    fileContentCache: new Map(),
    packageJson: null,
  };
}

async function fetchFileContent(ctx: RepoContext, path: string): Promise<string | null> {
  if (ctx.fileContentCache.has(path)) {
    return ctx.fileContentCache.get(path) ?? null;
  }

  try {
    const res = await ctx.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: ctx.owner,
      repo: ctx.repo,
      path,
    });
    const data = res.data as { content?: string };
    if (!("content" in data) || !data.content) {
      ctx.fileContentCache.set(path, null);
      return null;
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    ctx.fileContentCache.set(path, content);
    ctx.fileExistsCache.set(path, true);
    return content;
  } catch {
    ctx.fileContentCache.set(path, null);
    ctx.fileExistsCache.set(path, false);
    return null;
  }
}

async function fileExists(ctx: RepoContext, path: string): Promise<boolean> {
  if (ctx.fileExistsCache.has(path)) {
    return ctx.fileExistsCache.get(path) ?? false;
  }

  try {
    await ctx.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: ctx.owner,
      repo: ctx.repo,
      path,
    });
    ctx.fileExistsCache.set(path, true);
    return true;
  } catch {
    ctx.fileExistsCache.set(path, false);
    return false;
  }
}

async function getPackageJson(ctx: RepoContext): Promise<PackageJson | null> {
  if (ctx.packageJson !== null) {
    return ctx.packageJson;
  }

  const content = await fetchFileContent(ctx, "package.json");
  if (!content) {
    return null;
  }

  try {
    ctx.packageJson = JSON.parse(content) as PackageJson;
    return ctx.packageJson;
  } catch (error) {
    console.error("Failed to parse package.json", { owner: ctx.owner, repo: ctx.repo, error });
    return null;
  }
}

// ============================================================================
// Detector Matching Logic
// ============================================================================

async function matchDetectorItem(ctx: RepoContext, item: DetectorItem): Promise<boolean> {
  // File existence check
  if ("path" in item) {
    return fileExists(ctx, item.path);
  }

  // Package dependency check
  if ("matchPackage" in item) {
    const pkg = await getPackageJson(ctx);
    if (!pkg) return false;

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const pattern = item.matchPackage;

    // Support simple glob patterns with *
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return Object.keys(deps).some((dep) => regex.test(dep));
    }

    return pattern in deps;
  }

  // Content matching check
  if ("matchContent" in item) {
    const regex = new RegExp(item.matchContent);
    for (const path of item.paths) {
      const content = await fetchFileContent(ctx, path);
      if (content && regex.test(content)) {
        return true;
      }
    }
    return false;
  }

  // Script matching check
  if ("matchScript" in item) {
    const pkg = await getPackageJson(ctx);
    if (!pkg?.scripts) return false;

    const regex = new RegExp(item.matchScript);
    return Object.values(pkg.scripts).some((script) => regex.test(script));
  }

  return false;
}

async function matchDetector(ctx: RepoContext, detector: Detector): Promise<boolean> {
  // Check "every" conditions (AND logic)
  if (detector.every && detector.every.length > 0) {
    for (const item of detector.every) {
      if (!(await matchDetectorItem(ctx, item))) {
        return false;
      }
    }
  }

  // Check "some" conditions (OR logic)
  if (detector.some && detector.some.length > 0) {
    let anyMatched = false;
    for (const item of detector.some) {
      if (await matchDetectorItem(ctx, item)) {
        anyMatched = true;
        break;
      }
    }
    if (!anyMatched) {
      return false;
    }
  }

  // If we have no conditions, don't match
  if ((!detector.every || detector.every.length === 0) && (!detector.some || detector.some.length === 0)) {
    return false;
  }

  return true;
}

// ============================================================================
// Framework Definitions - Ordered by priority (higher priority first)
// ============================================================================

const FRAMEWORK_DEFINITIONS: FrameworkDefinition[] = [
  // Next.js - highest priority for React apps
  {
    slug: "next",
    name: "Next.js",
    priority: 100,
    detectors: {
      some: [
        { matchPackage: "next" },
        { path: "next.config.js" },
        { path: "next.config.ts" },
        { path: "next.config.mjs" },
        { path: "next.config.cjs" },
        { matchScript: "\\bnext\\b" },
      ],
    },
  },

  // Remix
  {
    slug: "remix",
    name: "Remix",
    priority: 95,
    detectors: {
      some: [
        { matchPackage: "@remix-run/react" },
        { matchPackage: "@remix-run/node" },
        { matchPackage: "@remix-run/serve" },
        { matchPackage: "@remix-run/dev" },
        { matchPackage: "remix" },
        { path: "remix.config.js" },
        { path: "remix.config.ts" },
        { path: "remix.config.mjs" },
        {
          matchContent: "@remix-run",
          paths: ["vite.config.ts", "vite.config.js", "vite.config.mjs"],
        },
      ],
    },
  },

  // Nuxt
  {
    slug: "nuxt",
    name: "Nuxt",
    priority: 90,
    detectors: {
      some: [
        { matchPackage: "nuxt" },
        { matchPackage: "nuxt3" },
        { matchPackage: "nuxt-edge" },
        { path: "nuxt.config.ts" },
        { path: "nuxt.config.js" },
        { path: "nuxt.config.mjs" },
        { matchScript: "\\bnuxt\\b" },
      ],
    },
  },

  // SvelteKit
  {
    slug: "sveltekit",
    name: "SvelteKit",
    priority: 85,
    detectors: {
      some: [
        { matchPackage: "@sveltejs/kit" },
        {
          matchContent: "@sveltejs/kit",
          paths: ["svelte.config.js", "svelte.config.ts"],
        },
      ],
    },
  },

  // Angular
  {
    slug: "angular",
    name: "Angular",
    priority: 80,
    detectors: {
      some: [
        { matchPackage: "@angular/cli" },
        { matchPackage: "@angular/core" },
        { path: "angular.json" },
        { path: ".angular-cli.json" },
        { matchScript: "\\bng\\s" },
      ],
    },
  },

  // Create React App
  {
    slug: "cra",
    name: "Create React App",
    priority: 75,
    detectors: {
      some: [{ matchPackage: "react-scripts" }, { matchPackage: "react-app-rewired" }, { matchPackage: "craco" }],
    },
  },

  // Vue CLI / Vue.js
  {
    slug: "vue",
    name: "Vue.js",
    priority: 70,
    detectors: {
      some: [
        { matchPackage: "@vue/cli-service" },
        { path: "vue.config.js" },
        { path: "vue.config.ts" },
        // Vue with Vite - check for Vue plugin in vite config
        {
          matchContent: "@vitejs/plugin-vue",
          paths: ["vite.config.ts", "vite.config.js", "vite.config.mjs"],
        },
        // Check for .vue files in common locations (indicates Vue project)
        { path: "src/App.vue" },
        { path: "src/main.vue" },
      ],
    },
  },

  // Vite (generic) - lower priority, catches remaining Vite projects
  {
    slug: "vite",
    name: "Vite",
    priority: 50,
    detectors: {
      some: [
        { matchPackage: "vite" },
        { path: "vite.config.ts" },
        { path: "vite.config.js" },
        { path: "vite.config.mjs" },
        { matchScript: "\\bvite\\b" },
      ],
    },
  },
];

// ============================================================================
// Main Detection Function
// ============================================================================

export async function detectFrameworkPreset(repoFullName: string): Promise<FrameworkPreset> {
  const ctx = await createRepoContext(repoFullName);
  if (!ctx) {
    return "other";
  }

  // Pre-fetch package.json since most detectors need it
  await getPackageJson(ctx);

  // Sort by priority (highest first)
  const sortedFrameworks = [...FRAMEWORK_DEFINITIONS].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Try each framework in priority order
  for (const framework of sortedFrameworks) {
    try {
      const matched = await matchDetector(ctx, framework.detectors);
      if (matched) {
        return framework.slug;
      }
    } catch (error) {
      console.error(`Error detecting framework ${framework.slug}:`, error);
    }
  }

  return "other";
}

/**
 * Detect framework with confidence score (useful for debugging)
 */
export async function detectFrameworkPresetWithDetails(
  repoFullName: string
): Promise<{ preset: FrameworkPreset; matches: string[] }> {
  const ctx = await createRepoContext(repoFullName);
  if (!ctx) {
    return { preset: "other", matches: [] };
  }

  await getPackageJson(ctx);

  const sortedFrameworks = [...FRAMEWORK_DEFINITIONS].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const matches: string[] = [];

  for (const framework of sortedFrameworks) {
    try {
      const matched = await matchDetector(ctx, framework.detectors);
      if (matched) {
        matches.push(framework.slug);
      }
    } catch (error) {
      console.error(`Error detecting framework ${framework.slug}:`, error);
    }
  }

  return {
    preset: matches[0] as FrameworkPreset ?? "other",
    matches,
  };
}
