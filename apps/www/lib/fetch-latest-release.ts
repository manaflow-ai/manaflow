import {
  DMG_SUFFIXES,
  GITHUB_RELEASES_URL,
  MacArchitecture,
  MacDownloadUrls,
  RELEASE_PAGE_URL,
} from "@/lib/releases";

export type ReleaseInfo = {
  latestVersion: string | null;
  macDownloadUrls: MacDownloadUrls;
  fallbackUrl: string;
};

type GithubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
};

const emptyDownloads: MacDownloadUrls = {
  universal: null,
  arm64: null,
  x64: null,
};

const normalizeVersion = (tag: string): string =>
  tag.startsWith("v") ? tag.slice(1) : tag;

/**
 * Check if a tag matches the cmux CLI release pattern (e.g., v1.0.208).
 * This filters out sub-component releases like host-screenshot-collector-v0.1.0-...
 */
const isCmuxCliRelease = (tagName: string): boolean => {
  return /^v\d+\.\d+\.\d+$/.test(tagName);
};

const deriveReleaseInfo = (data: GithubRelease | null): ReleaseInfo => {
  if (!data) {
    return {
      latestVersion: null,
      macDownloadUrls: { ...emptyDownloads },
      fallbackUrl: RELEASE_PAGE_URL,
    };
  }

  const latestVersion =
    typeof data.tag_name === "string" && data.tag_name.trim() !== ""
      ? normalizeVersion(data.tag_name)
      : null;

  const macDownloadUrls: MacDownloadUrls = { ...emptyDownloads };

  if (Array.isArray(data.assets)) {
    for (const asset of data.assets) {
      const assetName = asset.name?.toLowerCase();

      if (typeof assetName !== "string") {
        continue;
      }

      for (const architecture of Object.keys(DMG_SUFFIXES) as MacArchitecture[]) {
        const suffix = DMG_SUFFIXES[architecture];

        if (assetName.endsWith(suffix)) {
          const downloadUrl = asset.browser_download_url;

          if (typeof downloadUrl === "string" && downloadUrl.trim() !== "") {
            macDownloadUrls[architecture] = downloadUrl;
          }
        }
      }
    }
  }

  return {
    latestVersion,
    macDownloadUrls,
    fallbackUrl: RELEASE_PAGE_URL,
  };
};

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!response.ok) {
      return deriveReleaseInfo(null);
    }

    const releases = (await response.json()) as GithubRelease[];

    // Find the first stable release that matches the cmux CLI pattern (v1.0.xxx)
    // Exclude drafts and prereleases to match the behavior of /releases/latest
    const cmuxRelease = releases.find(
      (release) =>
        typeof release.tag_name === "string" &&
        !release.draft &&
        !release.prerelease &&
        isCmuxCliRelease(release.tag_name)
    );

    return deriveReleaseInfo(cmuxRelease ?? null);
  } catch (error) {
    console.error("Failed to retrieve latest GitHub release", error);

    return deriveReleaseInfo(null);
  }
}
