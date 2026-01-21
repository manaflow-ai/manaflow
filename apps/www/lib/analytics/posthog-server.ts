import { PostHog } from "posthog-node";

const POSTHOG_HOST = "https://us.i.posthog.com";

type ServerPosthogEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

const missingKeyWarning =
  "[analytics] PostHog client not initialized - missing API key";

function createServerPosthogClient(): PostHog {
  return new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
}

/**
 * Get or create a PostHog client for AI tracing.
 * Returns null if the API key is not configured or in development mode.
 * The caller is responsible for calling shutdown() when done.
 */
export function getPostHogClientForAITracing(): PostHog | null {
  if (process.env.NODE_ENV === "development") {
    return null;
  }

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    console.warn(missingKeyWarning);
    return null;
  }

  return createServerPosthogClient();
}

export async function captureServerPosthogEvent(
  payload: ServerPosthogEvent
): Promise<void> {
  if (process.env.NODE_ENV === "development") {
    return;
  }

  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    console.warn(missingKeyWarning);
    return;
  }

  const posthog = createServerPosthogClient();

  try {
    posthog.capture(payload);
    await posthog.shutdown();
  } catch (error) {
    console.error(
      `[analytics] Failed to capture PostHog event "${payload.event}"`,
      error
    );
  }
}
