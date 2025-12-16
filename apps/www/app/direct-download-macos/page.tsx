import { waitUntil } from "@vercel/functions";
import { unstable_cache as cache } from "next/cache";

import { DirectDownloadRedirector } from "@/app/direct-download-macos/redirector";
import {
  fetchLatestRelease,
  type ReleaseInfo,
} from "@/lib/fetch-latest-release";
import { RELEASE_PAGE_URL } from "@/lib/releases";
import {
  normalizeMacArchitecture,
  pickMacDownloadUrl,
} from "@/lib/utils/mac-architecture";
import { trackDirectDownloadPageView } from "@/lib/analytics/track-direct-download";

export const dynamic = "force-dynamic";

const pageContainerClasses =
  "min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center px-6 py-12";
const cardClasses =
  "w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/40";
const headingClasses = "text-2xl font-semibold tracking-tight";
const paragraphClasses = "mt-3 text-sm text-neutral-300 leading-relaxed";
const linkClasses =
  "mt-6 inline-flex items-center justify-center rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/10";

const FALLBACK_RELEASE_INFO: ReleaseInfo = {
  latestVersion: null,
  fallbackUrl: RELEASE_PAGE_URL,
  macDownloadUrls: {
    universal: null,
    arm64: null,
    x64: null,
  },
};

type DirectDownloadPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const searchParamValue = (
  params: DirectDownloadPageProps["searchParams"],
  key: string
): string | null => {
  if (!params) {
    return null;
  }

  const value = params[key];

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return null;
};

const loadReleaseInfo = async (): Promise<ReleaseInfo> => {
  try {
    return await fetchLatestRelease();
  } catch {
    return FALLBACK_RELEASE_INFO;
  }
};

const getCachedReleaseInfo = cache(
  async () => loadReleaseInfo(),
  ["direct-download-release-info"],
  {
    revalidate: 60 * 60, // 1 hour, aligns with GitHub release cadence
  }
);

export default async function DirectDownloadPage({
  searchParams,
}: DirectDownloadPageProps) {
  const releaseInfo = await getCachedReleaseInfo();
  const queryArchitecture = normalizeMacArchitecture(
    searchParamValue(searchParams, "arch")
  );
  const macDownloadUrls = releaseInfo.macDownloadUrls;
  const fallbackUrl = releaseInfo.fallbackUrl;
  const latestVersion = releaseInfo.latestVersion;
  const initialUrl = pickMacDownloadUrl(
    macDownloadUrls,
    fallbackUrl,
    queryArchitecture
  );

  waitUntil(
    trackDirectDownloadPageView({
      latestVersion,
      macDownloadUrls,
      fallbackUrl,
      initialUrl,
      queryArchitecture,
    })
  );

  return (
    <div className={pageContainerClasses}>
      <DirectDownloadRedirector
        macDownloadUrls={macDownloadUrls}
        fallbackUrl={fallbackUrl}
        initialUrl={initialUrl}
        queryArchitecture={queryArchitecture}
      />
      <DownloadCard initialUrl={initialUrl} />
    </div>
  );
}

function DownloadCard({ initialUrl }: { initialUrl: string }) {
  return (
    <div className={cardClasses}>
      <h1 className={headingClasses}>Preparing your download…</h1>
      <p className={paragraphClasses}>
        If nothing happens shortly, use the manual download below.
      </p>
      <a className={linkClasses} href={initialUrl}>
        Download manually
      </a>
    </div>
  );
}
