import { action, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { fetchInstallationAccessToken } from "./_shared/githubApp";

// GitHub PR type from API
type GitHubPR = {
  number: number;
  title: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  state: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels: Array<{ name: string }>;
  head: {
    ref: string;
  };
  base: {
    ref: string;
  };
};

// Internal query to get monitored repos with their installation IDs
export const getMonitoredReposWithInstallation = internalQuery({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;

    // Get all monitored repos
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_userId_monitored", (q) =>
        q.eq("userId", userId).eq("isMonitored", true)
      )
      .collect();

    // Get installation IDs for each repo
    const reposWithInstallation = await Promise.all(
      repos.map(async (repo) => {
        let installationId: number | undefined;
        if (repo.connectionId) {
          const connection = await ctx.db.get(repo.connectionId);
          installationId = connection?.installationId ?? undefined;
        }
        return {
          ...repo,
          installationId,
        };
      })
    );

    return reposWithInstallation.filter((r) => r.installationId !== undefined);
  },
});

// Fetch PRs from GitHub for a single repo
async function fetchRepoPRs(
  fullName: string,
  accessToken: string
): Promise<GitHubPR[]> {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=open&per_page=30`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "xagi-pr-monitor",
      },
    }
  );

  if (!response.ok) {
    console.error(
      `[prMonitor] Failed to fetch PRs for ${fullName}: ${response.status}`
    );
    return [];
  }

  return (await response.json()) as GitHubPR[];
}

// Test action: Fetch PRs from monitored repos and post one to the feed
export const testFetchAndPostPR = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message: string; pr?: { title: string; url: string; repo: string } }> => {
    // Get monitored repos with installation IDs
    const repos = await ctx.runQuery(
      internal.prMonitor.getMonitoredReposWithInstallation
    );

    if (repos.length === 0) {
      return { success: false, message: "No monitored repos found" };
    }

    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      return { success: false, message: "GitHub App credentials not configured" };
    }

    // Group repos by installation ID
    const reposByInstallation = new Map<number, typeof repos>();
    for (const repo of repos) {
      const installId = repo.installationId!;
      if (!reposByInstallation.has(installId)) {
        reposByInstallation.set(installId, []);
      }
      reposByInstallation.get(installId)!.push(repo);
    }

    // Collect all PRs
    const allPRs: Array<{ pr: GitHubPR; repoFullName: string }> = [];

    for (const [installationId, installationRepos] of reposByInstallation) {
      // Get access token for this installation
      const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
      const accessToken = await fetchInstallationAccessToken(
        installationId,
        appId,
        normalizedPrivateKey
      );

      if (!accessToken) {
        console.log(
          `[prMonitor] Could not get access token for installation ${installationId}`
        );
        continue;
      }

      // Fetch PRs for each repo in this installation
      for (const repo of installationRepos) {
        console.log(`[prMonitor] Fetching PRs for ${repo.fullName}`);
        const prs = await fetchRepoPRs(repo.fullName, accessToken);
        console.log(`[prMonitor] Found ${prs.length} open PRs in ${repo.fullName}`);

        for (const pr of prs) {
          allPRs.push({ pr, repoFullName: repo.fullName });
        }
      }
    }

    if (allPRs.length === 0) {
      return { success: false, message: "No open PRs found in monitored repos" };
    }

    // Pick a random PR
    const randomIndex = Math.floor(Math.random() * allPRs.length);
    const selected = allPRs[randomIndex];
    const { pr, repoFullName } = selected;

    // Create a post about this PR
    const content = `**${repoFullName}**

[${pr.title}](${pr.html_url})

by @${pr.user.login} | ${pr.head.ref} -> ${pr.base.ref}${pr.labels.length > 0 ? `\n\nLabels: ${pr.labels.map((l) => l.name).join(", ")}` : ""}`;

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Algorithm",
    });

    return {
      success: true,
      message: `Posted PR #${pr.number} from ${repoFullName}`,
      pr: {
        title: pr.title,
        url: pr.html_url,
        repo: repoFullName,
      },
    };
  },
});
