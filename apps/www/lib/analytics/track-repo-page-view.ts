import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

type RepoPageViewEvent = {
  repo: string;
  pageType: "pull_request" | "comparison";
  pullNumber?: number;
  comparison?: string;
  userId?: string;
};

export async function trackRepoPageView(
  event: RepoPageViewEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "repo_page_viewed",
    properties: {
      repo: event.repo,
      page_type: event.pageType,
      pull_number: event.pullNumber,
      comparison: event.comparison,
    },
  });
}
