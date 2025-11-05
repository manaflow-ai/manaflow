"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

export default function DirectDownloadPage() {
  return (
    <Suspense fallback={<DirectDownloadFallback />}>
      <DirectDownloadContent />
    </Suspense>
  );
}

function DirectDownloadContent() {
  const searchParams = useSearchParams();
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const info = await fetchLatestRelease();

        if (isMounted) {
          setReleaseInfo(info);
        }
      } catch (error) {
        console.error("[DirectDownloadPage] Failed to load release info", error);
        if (isMounted) {
          setReleaseInfo(FALLBACK_RELEASE_INFO);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  const queryArchitecture = useMemo(
    () => normalizeMacArchitecture(searchParams.get("arch")),
    [searchParams]
  );

  const fallbackUrl =
    releaseInfo?.fallbackUrl ?? FALLBACK_RELEASE_INFO.fallbackUrl;
  const macDownloadUrls = releaseInfo?.macDownloadUrls ?? null;
  const initialUrl = useMemo(() => {
    if (!macDownloadUrls) {
      return fallbackUrl;
    }

    return pickMacDownloadUrl(macDownloadUrls, fallbackUrl, queryArchitecture);
  }, [macDownloadUrls, fallbackUrl, queryArchitecture]);

  return (
    <div className={pageContainerClasses}>
      {macDownloadUrls ? (
        <DirectDownloadRedirector
          macDownloadUrls={macDownloadUrls}
          fallbackUrl={fallbackUrl}
          initialUrl={initialUrl}
          queryArchitecture={queryArchitecture}
        />
      ) : null}
      <DownloadCard initialUrl={initialUrl} />
    </div>
  );
}

function DirectDownloadFallback() {
  return (
    <div className={pageContainerClasses}>
      <DownloadCard initialUrl={FALLBACK_RELEASE_INFO.fallbackUrl} />
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
