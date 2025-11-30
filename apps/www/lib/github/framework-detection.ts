import { createGitHubClient } from "@/lib/github/octokit";
import { type FrameworkPreset } from "@/components/preview/preview-configure-client";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

/**
 * Framework detection configuration inspired by Vercel's approach.
 * Each framework has multiple detection strategies with priority ordering.
 *
 * Detection strategies (in order of precedence):
 * 1. matchPackage - Check for specific packages in dependencies/devDependencies
 * 2. matchConfigFiles - Check for framework-specific config files
 * 3. matchScriptContent - Check npm scripts for framework-specific commands
 * 4. matchFileContent - Check file contents for framework-specific patterns
 *
 * Higher sort values = lower priority (checked later)
 */
type FrameworkDetector = {
  preset: FrameworkPreset;
  sort: number;
  detectors: {
    // All conditions in 'every' must match (AND logic)
    every?: DetectorCondition[];
    // At least one condition in 'some' must match (OR logic)
    some?: DetectorCondition[];
  };
  // Frameworks this one supersedes (if this is detected, remove the superseded ones)
  supersedes?: FrameworkPreset[];
};

type DetectorCondition =
  | { matchPackage: string | string[] }
  | { matchConfigFile: string | string[] }
  | { matchScriptContent: string | RegExp }
  | { matchFileContent: { path: string; pattern: string | RegExp } };

/**
 * Comprehensive framework detection configurations.
 * Ordered by specificity - more specific frameworks first to prevent false matches.
 */
const FRAMEWORK_DETECTORS: FrameworkDetector[] = [
  // Next.js - highest priority React meta-framework
  {
    preset: "next",
    sort: 1,
    detectors: {
      some: [
        { matchPackage: "next" },
        {
          matchConfigFile: [
            "next.config.js",
            "next.config.ts",
            "next.config.mjs",
            "next.config.cjs",
          ],
        },
      ],
    },
    supersedes: ["vite", "cra"],
  },

  // Nuxt - Vue meta-framework
  {
    preset: "nuxt",
    sort: 2,
    detectors: {
      some: [
        { matchPackage: "nuxt" },
        { matchPackage: "nuxt3" },
        {
          matchConfigFile: [
            "nuxt.config.ts",
            "nuxt.config.js",
            "nuxt.config.mjs",
          ],
        },
      ],
    },
    supersedes: ["vue", "vite"],
  },

  // Remix - React framework
  {
    preset: "remix",
    sort: 3,
    detectors: {
      some: [
        { matchPackage: "@remix-run/node" },
        { matchPackage: "@remix-run/serve" },
        { matchPackage: "@remix-run/dev" },
        { matchPackage: "@remix-run/react" },
        { matchPackage: "remix" },
        {
          matchConfigFile: [
            "remix.config.js",
            "remix.config.ts",
            "remix.config.mjs",
          ],
        },
      ],
    },
    supersedes: ["vite", "cra"],
  },

  // SvelteKit - Svelte meta-framework
  {
    preset: "sveltekit",
    sort: 4,
    detectors: {
      some: [
        { matchPackage: "@sveltejs/kit" },
        {
          matchConfigFile: [
            "svelte.config.js",
            "svelte.config.ts",
            "svelte.config.mjs",
          ],
        },
      ],
    },
    supersedes: ["vite"],
  },

  // Angular
  {
    preset: "angular",
    sort: 5,
    detectors: {
      some: [
        { matchPackage: "@angular/core" },
        { matchPackage: "@angular/cli" },
        { matchConfigFile: ["angular.json", ".angular.json"] },
        { matchScriptContent: /\bng\s+(serve|build|test)\b/ },
      ],
    },
  },

  // Create React App
  {
    preset: "cra",
    sort: 6,
    detectors: {
      some: [
        { matchPackage: "react-scripts" },
        // CRA specific file structure
        {
          matchFileContent: {
            path: "package.json",
            pattern: /"react-scripts":\s*"/,
          },
        },
      ],
    },
  },

  // Vue CLI projects (not Nuxt)
  {
    preset: "vue",
    sort: 7,
    detectors: {
      every: [
        { matchPackage: ["vue", "@vue/cli-service", "vue-cli-service"] },
      ],
      some: [
        { matchConfigFile: ["vue.config.js", "vue.config.ts"] },
        { matchPackage: "@vue/cli-service" },
        // Check for Vue-specific scripts
        { matchScriptContent: /vue-cli-service/ },
      ],
    },
  },

  // Astro - content-focused framework
  {
    preset: "astro",
    sort: 8,
    detectors: {
      some: [
        { matchPackage: "astro" },
        {
          matchConfigFile: [
            "astro.config.mjs",
            "astro.config.js",
            "astro.config.ts",
          ],
        },
      ],
    },
    supersedes: ["vite"],
  },

  // Gatsby - React static site generator
  {
    preset: "gatsby",
    sort: 9,
    detectors: {
      some: [
        { matchPackage: "gatsby" },
        {
          matchConfigFile: [
            "gatsby-config.js",
            "gatsby-config.ts",
            "gatsby-config.mjs",
          ],
        },
      ],
    },
  },

  // SolidJS
  {
    preset: "solid",
    sort: 10,
    detectors: {
      some: [
        { matchPackage: "solid-js" },
        { matchPackage: "solid-start" },
        {
          matchConfigFile: ["solid-start.config.js", "solid-start.config.ts"],
        },
      ],
    },
    supersedes: ["vite"],
  },

  // Qwik
  {
    preset: "qwik",
    sort: 11,
    detectors: {
      some: [
        { matchPackage: "@builder.io/qwik" },
        { matchPackage: "@builder.io/qwik-city" },
      ],
    },
    supersedes: ["vite"],
  },

  // RedwoodJS
  {
    preset: "redwood",
    sort: 12,
    detectors: {
      some: [
        { matchPackage: "@redwoodjs/core" },
        { matchConfigFile: "redwood.toml" },
      ],
    },
  },

  // Expo (React Native for Web)
  {
    preset: "expo",
    sort: 13,
    detectors: {
      some: [
        { matchPackage: "expo" },
        { matchConfigFile: ["app.json", "app.config.js", "app.config.ts"] },
        { matchScriptContent: /\bexpo\s+(start|build)\b/ },
      ],
    },
  },

  // Vite - generic build tool (lower priority since many frameworks use it)
  {
    preset: "vite",
    sort: 20,
    detectors: {
      some: [
        { matchPackage: "vite" },
        {
          matchConfigFile: [
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mjs",
            "vite.config.cjs",
          ],
        },
        { matchScriptContent: /\bvite\b/ },
      ],
    },
  },
];

/**
 * Fetch and parse a JSON file from a GitHub repository.
 */
async function fetchRepoJson(
  owner: string,
  name: string,
  path: string
): Promise<PackageJson | null> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
  try {
    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo: name,
        path,
      }
    );
    const data = res.data as { content?: string };
    if (!("content" in data) || !data.content) {
      return null;
    }
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch (error) {
    console.error("Failed to read repo json", { owner, name, path, error });
    return null;
  }
}

/**
 * Check if a file exists in the repository.
 */
async function repoHasFile(
  owner: string,
  name: string,
  path: string
): Promise<boolean> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
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

/**
 * Fetch raw file content from a GitHub repository.
 */
async function fetchRepoFileContent(
  owner: string,
  name: string,
  path: string
): Promise<string | null> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
  try {
    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo: name,
        path,
      }
    );
    const data = res.data as { content?: string };
    if (!("content" in data) || !data.content) {
      return null;
    }
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if any of the specified packages exist in package.json dependencies.
 */
function hasPackage(pkg: PackageJson, packages: string | string[]): boolean {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const packagesToCheck = Array.isArray(packages) ? packages : [packages];
  return packagesToCheck.some((p) => p in deps);
}

/**
 * Check if any npm script contains the specified pattern.
 */
function matchesScriptContent(
  pkg: PackageJson,
  pattern: string | RegExp
): boolean {
  const scripts = pkg.scripts ?? {};
  const scriptValues = Object.values(scripts);
  if (typeof pattern === "string") {
    return scriptValues.some((val) => val.includes(pattern));
  }
  return scriptValues.some((val) => pattern.test(val));
}

/**
 * Evaluate a single detector condition.
 */
async function evaluateCondition(
  condition: DetectorCondition,
  owner: string,
  name: string,
  pkg: PackageJson | null,
  fileCache: Map<string, boolean>,
  contentCache: Map<string, string | null>
): Promise<boolean> {
  if ("matchPackage" in condition) {
    if (!pkg) return false;
    return hasPackage(pkg, condition.matchPackage);
  }

  if ("matchConfigFile" in condition) {
    const files = Array.isArray(condition.matchConfigFile)
      ? condition.matchConfigFile
      : [condition.matchConfigFile];

    for (const file of files) {
      let exists = fileCache.get(file);
      if (exists === undefined) {
        exists = await repoHasFile(owner, name, file);
        fileCache.set(file, exists);
      }
      if (exists) return true;
    }
    return false;
  }

  if ("matchScriptContent" in condition) {
    if (!pkg) return false;
    return matchesScriptContent(pkg, condition.matchScriptContent);
  }

  if ("matchFileContent" in condition) {
    const { path, pattern } = condition.matchFileContent;
    let content = contentCache.get(path);
    if (content === undefined) {
      content = await fetchRepoFileContent(owner, name, path);
      contentCache.set(path, content);
    }
    if (!content) return false;
    if (typeof pattern === "string") {
      return content.includes(pattern);
    }
    return pattern.test(content);
  }

  return false;
}

/**
 * Evaluate all conditions for a framework detector.
 * Returns true if:
 * - All 'every' conditions match (if specified), AND
 * - At least one 'some' condition matches (if specified)
 */
async function evaluateDetector(
  detector: FrameworkDetector,
  owner: string,
  name: string,
  pkg: PackageJson | null,
  fileCache: Map<string, boolean>,
  contentCache: Map<string, string | null>
): Promise<boolean> {
  const { every, some } = detector.detectors;

  // Check 'every' conditions (all must match)
  if (every && every.length > 0) {
    for (const condition of every) {
      const matches = await evaluateCondition(
        condition,
        owner,
        name,
        pkg,
        fileCache,
        contentCache
      );
      if (!matches) return false;
    }
  }

  // Check 'some' conditions (at least one must match)
  if (some && some.length > 0) {
    for (const condition of some) {
      const matches = await evaluateCondition(
        condition,
        owner,
        name,
        pkg,
        fileCache,
        contentCache
      );
      if (matches) return true;
    }
    // If we have 'some' conditions but none matched, fail
    return false;
  }

  // If only 'every' conditions were specified and all passed, return true
  return every !== undefined && every.length > 0;
}

/**
 * Remove superseded frameworks from the detected list.
 * For example, if Next.js is detected, remove Vite and CRA from candidates.
 */
function removeSupersededFrameworks(
  detected: FrameworkPreset[]
): FrameworkPreset[] {
  const supersededSet = new Set<FrameworkPreset>();

  for (const preset of detected) {
    const detector = FRAMEWORK_DETECTORS.find((d) => d.preset === preset);
    if (detector?.supersedes) {
      for (const s of detector.supersedes) {
        supersededSet.add(s);
      }
    }
  }

  return detected.filter((preset) => !supersededSet.has(preset));
}

/**
 * Detect the framework preset for a GitHub repository.
 *
 * Uses a multi-stage heuristic approach inspired by Vercel:
 * 1. Check package.json dependencies for framework-specific packages
 * 2. Check for framework-specific config files
 * 3. Check npm scripts for framework commands
 * 4. Check file contents for framework patterns
 *
 * Frameworks are ordered by specificity (meta-frameworks before build tools).
 * Supersession rules prevent generic tools like Vite from being detected
 * when a more specific framework like Next.js is present.
 */
export async function detectFrameworkPreset(
  repoFullName: string
): Promise<FrameworkPreset> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return "other";
  }

  // Fetch package.json once
  const pkg = await fetchRepoJson(owner, name, "package.json");

  // Cache for file existence checks and content
  const fileCache = new Map<string, boolean>();
  const contentCache = new Map<string, string | null>();

  // Sort detectors by priority (lower sort = higher priority)
  const sortedDetectors = [...FRAMEWORK_DETECTORS].sort(
    (a, b) => a.sort - b.sort
  );

  // Detect all matching frameworks
  const detectedFrameworks: FrameworkPreset[] = [];

  for (const detector of sortedDetectors) {
    const matches = await evaluateDetector(
      detector,
      owner,
      name,
      pkg,
      fileCache,
      contentCache
    );
    if (matches) {
      detectedFrameworks.push(detector.preset);
    }
  }

  if (detectedFrameworks.length === 0) {
    return "other";
  }

  // Remove superseded frameworks
  const finalFrameworks = removeSupersededFrameworks(detectedFrameworks);

  // Return the highest priority (lowest sort value) framework
  if (finalFrameworks.length === 0) {
    return "other";
  }

  // Find the detected framework with the lowest sort value
  let bestPreset: FrameworkPreset = "other";
  let bestSort = Infinity;

  for (const preset of finalFrameworks) {
    const detector = sortedDetectors.find((d) => d.preset === preset);
    if (detector && detector.sort < bestSort) {
      bestSort = detector.sort;
      bestPreset = preset;
    }
  }

  return bestPreset;
}

/**
 * Detect all frameworks present in a repository.
 * Useful for monorepos or projects using multiple frameworks.
 */
export async function detectAllFrameworks(
  repoFullName: string
): Promise<FrameworkPreset[]> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return [];
  }

  const pkg = await fetchRepoJson(owner, name, "package.json");
  const fileCache = new Map<string, boolean>();
  const contentCache = new Map<string, string | null>();

  const sortedDetectors = [...FRAMEWORK_DETECTORS].sort(
    (a, b) => a.sort - b.sort
  );

  const detectedFrameworks: FrameworkPreset[] = [];

  for (const detector of sortedDetectors) {
    const matches = await evaluateDetector(
      detector,
      owner,
      name,
      pkg,
      fileCache,
      contentCache
    );
    if (matches) {
      detectedFrameworks.push(detector.preset);
    }
  }

  return removeSupersededFrameworks(detectedFrameworks);
}
