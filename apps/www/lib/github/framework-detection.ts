import { createGitHubClient } from "@/lib/github/octokit";
import { type FrameworkPreset } from "@/components/preview/preview-configure-client";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

function chooseFrameworkFromPackageJson(pkg: PackageJson): FrameworkPreset | null {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasAny = (...keys: string[]) => keys.some((key) => deps[key]);

  if (hasAny("next")) return "next";
  if (hasAny("nuxt")) return "nuxt";
  if (hasAny("@remix-run/node", "@remix-run/serve", "remix")) return "remix";
  if (hasAny("@sveltejs/kit")) return "sveltekit";
  if (hasAny("@angular/core")) return "angular";
  if (hasAny("react-scripts")) return "cra";
  if (hasAny("vue", "@vue/cli-service")) return "vue";
  if (hasAny("vite")) return "vite";

  const scripts = pkg.scripts ?? {};
  const scriptValues = Object.values(scripts);
  if (scriptValues.some((val) => val.includes("next"))) return "next";
  if (scriptValues.some((val) => val.includes("nuxt"))) return "nuxt";
  if (scriptValues.some((val) => val.includes("remix"))) return "remix";
  if (scriptValues.some((val) => val.includes("svelte"))) return "sveltekit";
  if (scriptValues.some((val) => val.includes("ng "))) return "angular";
  if (scriptValues.some((val) => val.includes("vue"))) return "vue";
  if (scriptValues.some((val) => val.includes("vite"))) return "vite";
  return null;
}

async function fetchRepoJson(owner: string, name: string, path: string): Promise<PackageJson | null> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo: name,
      path,
    });
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

async function repoHasFile(owner: string, name: string, path: string): Promise<boolean> {
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

export async function detectFrameworkPreset(repoFullName: string): Promise<FrameworkPreset> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return "other";
  }

  const pkg = await fetchRepoJson(owner, name, "package.json");
  const pkgGuess = pkg ? chooseFrameworkFromPackageJson(pkg) : null;
  if (pkgGuess) {
    return pkgGuess;
  }

  const fileGuesses: Array<[FrameworkPreset, string[]]> = [
    ["next", ["next.config.js", "next.config.ts", "next.config.mjs"]],
    ["nuxt", ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"]],
    ["remix", ["remix.config.js", "remix.config.ts"]],
    ["sveltekit", ["svelte.config.js", "svelte.config.ts"]],
    ["angular", ["angular.json"]],
    ["vite", ["vite.config.ts", "vite.config.js", "vite.config.mjs"]],
    ["vue", ["vue.config.js", "vue.config.ts"]],
  ];

  for (const [preset, paths] of fileGuesses) {
    const found = await paths.reduce<Promise<boolean>>(async (accPromise, candidate) => {
      const acc = await accPromise;
      if (acc) return true;
      return repoHasFile(owner, name, candidate);
    }, Promise.resolve(false));
    if (found) {
      return preset;
    }
  }

  return "other";
}
