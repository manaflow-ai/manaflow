"use client";

import {
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
} from "react";

import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";
import {
  detectClientMacArchitecture,
  getNavigatorArchitectureHint,
  pickMacDownloadUrl,
} from "@/lib/utils/mac-architecture";

type MacDownloadLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "popover"
> & {
  urls: MacDownloadUrls;
  fallbackUrl: string;
  autoDetect?: boolean;
  architecture?: MacArchitecture;
};

export function MacDownloadLink({
  urls,
  fallbackUrl,
  autoDetect = false,
  architecture,
  ...anchorProps
}: MacDownloadLinkProps) {
  const sanitizedUrls = useMemo<MacDownloadUrls>(
    () => ({
      universal:
        typeof urls.universal === "string" && urls.universal.trim() !== ""
          ? urls.universal
          : null,
      arm64:
        typeof urls.arm64 === "string" && urls.arm64.trim() !== ""
          ? urls.arm64
          : null,
      x64:
        typeof urls.x64 === "string" && urls.x64.trim() !== ""
          ? urls.x64
          : null,
    }),
    [urls.arm64, urls.universal, urls.x64],
  );

  const autoDefaultUrl = useMemo(
    () => pickMacDownloadUrl(sanitizedUrls, fallbackUrl, null),
    [fallbackUrl, sanitizedUrls],
  );

  const explicitDefaultUrl = useMemo(() => {
    if (architecture) {
      return pickMacDownloadUrl(sanitizedUrls, fallbackUrl, architecture);
    }

    if (autoDetect) {
      const detected = getNavigatorArchitectureHint();

      if (detected) {
        return pickMacDownloadUrl(sanitizedUrls, fallbackUrl, detected);
      }
    }

    return autoDefaultUrl;
  }, [architecture, autoDefaultUrl, autoDetect, fallbackUrl, sanitizedUrls]);

  const [href, setHref] = useState<string>(explicitDefaultUrl);

  useEffect(() => {
    setHref(explicitDefaultUrl);
  }, [explicitDefaultUrl]);

  useEffect(() => {
    if (!autoDetect) {
      return;
    }

    const synchronousHint = getNavigatorArchitectureHint();

    if (synchronousHint) {
      setHref(pickMacDownloadUrl(sanitizedUrls, fallbackUrl, synchronousHint));
    }

    let isMounted = true;

    const run = async () => {
      const detectedArchitecture = await detectClientMacArchitecture();

      if (!isMounted || !detectedArchitecture) {
        return;
      }

      setHref(pickMacDownloadUrl(sanitizedUrls, fallbackUrl, detectedArchitecture));
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [autoDetect, fallbackUrl, sanitizedUrls]);

  return <a {...anchorProps} href={href} />;
}
