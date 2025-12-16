"use client";

import { useEffect, useRef } from "react";

import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";
import {
  detectClientMacArchitecture,
  getNavigatorArchitectureHint,
  pickMacDownloadUrl,
} from "@/lib/utils/mac-architecture";

type DirectDownloadRedirectorProps = {
  macDownloadUrls: MacDownloadUrls;
  fallbackUrl: string;
  initialUrl: string;
  queryArchitecture: MacArchitecture | null;
};

export function DirectDownloadRedirector({
  macDownloadUrls,
  fallbackUrl,
  initialUrl,
  queryArchitecture,
}: DirectDownloadRedirectorProps) {
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    const followUrl = (
      architecture: MacArchitecture | null,
      _reason: string
    ) => {
      if (hasRedirectedRef.current) {
        return;
      }

      const target = pickMacDownloadUrl(
        macDownloadUrls,
        fallbackUrl,
        architecture
      );
      hasRedirectedRef.current = true;
      window.location.replace(target);
    };

    const forcedArchitecture = queryArchitecture;

    if (forcedArchitecture) {
      followUrl(forcedArchitecture, "query-parameter");
      return;
    }

    const synchronousHint = getNavigatorArchitectureHint();

    if (synchronousHint) {
      followUrl(synchronousHint, "navigator-hint");
      return;
    }

    let isMounted = true;

    const run = async () => {
      try {
        const detectedArchitecture = await detectClientMacArchitecture();

        if (!isMounted) {
          return;
        }

        if (detectedArchitecture) {
          followUrl(detectedArchitecture, "async-detection");
          return;
        }

        followUrl(null, "async-detection-null");
      } catch (_error) {
        followUrl(null, "async-detection-error");
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [fallbackUrl, initialUrl, macDownloadUrls, queryArchitecture]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (hasRedirectedRef.current) {
        return;
      }

      hasRedirectedRef.current = true;
      window.location.replace(initialUrl);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [initialUrl]);

  return null;
}
