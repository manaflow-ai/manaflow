import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";
import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

type DirectDownloadPageViewEvent = {
  latestVersion: string | null;
  macDownloadUrls: MacDownloadUrls;
  fallbackUrl: string;
  initialUrl: string;
  queryArchitecture: MacArchitecture | null;
  userId?: string;
};

const hasDownloadUrl = (value: string | null): boolean =>
  typeof value === "string" && value.trim() !== "";

const resolveTarget = (
  event: DirectDownloadPageViewEvent
): MacArchitecture | "fallback" | "unknown" => {
  if (event.initialUrl === event.fallbackUrl) {
    return "fallback";
  }

  const entries: Array<[MacArchitecture, string | null]> = [
    ["universal", event.macDownloadUrls.universal],
    ["arm64", event.macDownloadUrls.arm64],
    ["x64", event.macDownloadUrls.x64],
  ];

  for (const [architecture, url] of entries) {
    if (typeof url === "string" && url === event.initialUrl) {
      return architecture;
    }
  }

  return "unknown";
};

export async function trackDirectDownloadPageView(
  event: DirectDownloadPageViewEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "direct_download_macos_page_viewed",
    properties: {
      latest_version: event.latestVersion,
      query_architecture: event.queryArchitecture ?? "unknown",
      resolved_target: resolveTarget(event),
      has_universal_download: hasDownloadUrl(event.macDownloadUrls.universal),
      has_arm64_download: hasDownloadUrl(event.macDownloadUrls.arm64),
      has_x64_download: hasDownloadUrl(event.macDownloadUrls.x64),
    },
  });
}
