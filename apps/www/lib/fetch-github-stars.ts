const CMUX_REPO_API_URL = "https://api.github.com/repos/manaflow-ai/manaflow";
export const CMUX_REPO_URL = "https://github.com/manaflow-ai/manaflow";

type GithubRepoResponse = {
  stargazers_count?: number;
};

export type GithubRepoStats = {
  stars: number | null;
  url: string;
};

const FALLBACK_STATS: GithubRepoStats = {
  stars: null,
  url: CMUX_REPO_URL,
};

export async function fetchGithubRepoStats(): Promise<GithubRepoStats> {
  try {
    const response = await fetch(CMUX_REPO_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      next: {
        revalidate: 1800,
        tags: ["github:repo:manaflow-ai/manaflow"],
      },
    });

    if (!response.ok) {
      return FALLBACK_STATS;
    }

    const data = (await response.json()) as GithubRepoResponse;
    const stars =
      typeof data.stargazers_count === "number" && Number.isFinite(data.stargazers_count)
        ? data.stargazers_count
        : null;

    return {
      stars,
      url: CMUX_REPO_URL,
    };
  } catch (error) {
    console.error("Failed to fetch GitHub repo stats", error);
    return FALLBACK_STATS;
  }
}
