import { runCommandCapture } from "../crown/utils";

export function extractPathFromDiff(rawPath: string): string {
  const trimmed = rawPath.trim();
  const arrowIndex = trimmed.indexOf(" => ");
  if (arrowIndex === -1) {
    return trimmed;
  }

  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.indexOf("}");
  if (
    braceStart !== -1 &&
    braceEnd !== -1 &&
    braceEnd > braceStart &&
    braceStart < arrowIndex &&
    braceEnd > arrowIndex
  ) {
    const prefix = trimmed.slice(0, braceStart);
    const braceContent = trimmed.slice(braceStart + 1, braceEnd);
    const suffix = trimmed.slice(braceEnd + 1);
    const braceParts = braceContent.split(" => ");
    const replacement = braceParts[braceParts.length - 1] ?? "";
    return `${prefix}${replacement}${suffix}`;
  }

  const parts = trimmed.split(" => ");
  return parts[parts.length - 1] ?? trimmed;
}

export function parseFileList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function filterTextFiles(
  workspaceDir: string,
  baseRevision: string,
  files: readonly string[]
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const fileSet = new Set(files);
  const args = ["diff", "--numstat", `${baseRevision}..HEAD`, "--", ...files];

  const output = await runCommandCapture("git", args, { cwd: workspaceDir });
  const textFiles = new Set<string>();

  output.split("\n").forEach((line) => {
    if (!line.trim()) {
      return;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      return;
    }
    const [addedRaw, deletedRaw, ...pathParts] = parts;
    if (!addedRaw || !deletedRaw || pathParts.length === 0) {
      return;
    }
    const added = addedRaw.trim();
    const deleted = deletedRaw.trim();
    if (added === "-" || deleted === "-") {
      // Binary diff shows "-" for text stats.
      return;
    }
    const rawPath = pathParts.join("\t").trim();
    if (!rawPath) {
      return;
    }
    const normalizedPath = extractPathFromDiff(rawPath);
    if (fileSet.has(normalizedPath)) {
      textFiles.add(normalizedPath);
      return;
    }
    if (fileSet.has(rawPath)) {
      textFiles.add(rawPath);
      return;
    }
    textFiles.add(normalizedPath);
  });

  return files.filter((file) => textFiles.has(file));
}

export async function detectRemoteHead(
  workspaceDir: string
): Promise<string> {
  try {
    const symbolicRefRaw = await runCommandCapture(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: workspaceDir }
    );
    const symbolicRef = symbolicRefRaw.split("\n")[0]?.trim();
    if (symbolicRef) {
      return symbolicRef;
    }
  } catch {
    // Fall back to parsing remote show output.
  }

  try {
    const remoteInfo = await runCommandCapture(
      "git",
      ["remote", "show", "origin"],
      { cwd: workspaceDir }
    );
    for (const line of remoteInfo.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("HEAD branch:")) {
        const branchName = trimmed.slice("HEAD branch:".length).trim();
        if (branchName) {
          return `origin/${branchName}`;
        }
      }
    }
  } catch {
    // Swallow and throw below with unified error.
  }

  throw new Error(
    "Unable to determine remote HEAD branch from origin (no symbolic ref or HEAD branch information)"
  );
}

async function tryFetchBranch(
  workspaceDir: string,
  branch: string
): Promise<boolean> {
  // Extract the branch name without origin/ prefix for fetching
  const branchName = branch.startsWith("origin/")
    ? branch.slice("origin/".length)
    : branch.startsWith("refs/remotes/origin/")
      ? branch.slice("refs/remotes/origin/".length)
      : branch;

  try {
    await runCommandCapture(
      "git",
      ["fetch", "origin", branchName, "--depth=1"],
      { cwd: workspaceDir }
    );
    return true;
  } catch {
    return false;
  }
}

async function tryDeepen(workspaceDir: string): Promise<boolean> {
  try {
    await runCommandCapture("git", ["fetch", "--deepen=100"], {
      cwd: workspaceDir,
    });
    return true;
  } catch {
    return false;
  }
}

export async function resolveMergeBase(
  workspaceDir: string,
  baseBranchOverride?: string | null
): Promise<{ baseBranch: string; mergeBase: string }> {
  const normalizedOverride = baseBranchOverride?.trim();
  const candidateBranches: string[] = [];

  if (normalizedOverride) {
    // Prefer remote refs over local branches since local branches may be stale
    // after git fetch (we fetch but don't pull/update local branches)
    if (!normalizedOverride.startsWith("origin/")) {
      candidateBranches.push(`origin/${normalizedOverride}`);
    }
    if (
      !normalizedOverride.startsWith("refs/remotes/") &&
      !normalizedOverride.startsWith("origin/")
    ) {
      candidateBranches.push(`refs/remotes/origin/${normalizedOverride}`);
    }
    // Fall back to local refs if remote refs don't exist
    candidateBranches.push(normalizedOverride);
    if (!normalizedOverride.startsWith("refs/heads/")) {
      candidateBranches.push(`refs/heads/${normalizedOverride}`);
    }
  }

  let baseBranch = "";
  for (const candidate of candidateBranches) {
    try {
      await runCommandCapture(
        "git",
        ["rev-parse", "--verify", "--quiet", `${candidate}^{}`],
        { cwd: workspaceDir }
      );
      baseBranch = candidate;
      break;
    } catch {
      // Try next candidate.
    }
  }

  // If no override-based branch was found, try to detect remote HEAD
  if (!baseBranch) {
    try {
      baseBranch = await detectRemoteHead(workspaceDir);
    } catch {
      // Remote HEAD detection failed, try fetching origin/main or origin/master
      for (const defaultBranch of ["origin/main", "origin/master"]) {
        const fetched = await tryFetchBranch(workspaceDir, defaultBranch);
        if (fetched) {
          try {
            await runCommandCapture(
              "git",
              ["rev-parse", "--verify", "--quiet", `${defaultBranch}^{}`],
              { cwd: workspaceDir }
            );
            baseBranch = defaultBranch;
            break;
          } catch {
            // Continue to next candidate
          }
        }
      }
    }
  }

  if (!baseBranch) {
    throw new Error(
      "Unable to determine base branch: no override provided and remote HEAD detection failed"
    );
  }

  // Try merge-base, and if it fails, attempt to fetch/deepen and retry
  const tryMergeBase = async (): Promise<string | null> => {
    try {
      const mergeBaseRaw = await runCommandCapture(
        "git",
        ["merge-base", "HEAD", baseBranch],
        { cwd: workspaceDir }
      );
      return mergeBaseRaw.split("\n")[0]?.trim() || null;
    } catch {
      return null;
    }
  };

  let mergeBase = await tryMergeBase();

  // If merge-base failed, the base branch ref might be missing or shallow clone
  if (!mergeBase) {
    // Try fetching the specific branch first
    await tryFetchBranch(workspaceDir, baseBranch);
    mergeBase = await tryMergeBase();
  }

  // If still no merge base, try deepening the shallow clone
  if (!mergeBase) {
    await tryDeepen(workspaceDir);
    mergeBase = await tryMergeBase();
  }

  if (!mergeBase) {
    throw new Error(
      `Command "git merge-base HEAD ${baseBranch}" failed: unable to find common ancestor (possibly shallow clone without shared history)`
    );
  }

  return { baseBranch, mergeBase };
}
