import { captureServerPosthogEvent } from "@/lib/analytics/posthog-server";

type HeatmapReviewEvent = {
  repo: string;
  pullNumber: number;
  language: string;
  model: string;
  userId?: string;
};

export async function trackHeatmapReviewRequested(
  event: HeatmapReviewEvent
): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: event.userId ?? "anonymous",
    event: "heatmap_review_requested",
    properties: {
      repo: event.repo,
      pull_number: event.pullNumber,
      tooltip_language: event.language,
      model: event.model,
    },
  });
}
