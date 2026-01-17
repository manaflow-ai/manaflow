/**
 * PostHog analytics for Convex
 * Uses fetch API directly (compatible with Convex V8 runtime)
 *
 * Usage:
 *   capturePosthogEvent({ ... }); // non-blocking
 *   capturePosthogEvent({ ... }); // non-blocking
 *   await drainPosthogEvents();   // wait for all at the end
 */

import { env } from "./convex-env";

const POSTHOG_HOST = "https://us.i.posthog.com";

type PostHogEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

// Pending fetch promises for the current handler execution
const pendingEvents: Promise<void>[] = [];

/**
 * Capture a PostHog event (non-blocking).
 * Call drainPosthogEvents() at the end of your handler to ensure all events are sent.
 */
export function capturePosthogEvent(payload: PostHogEvent): void {
  const apiKey = env.POSTHOG_API_KEY;
  if (!apiKey) {
    return;
  }

  const promise = fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      distinct_id: payload.distinctId,
      event: payload.event,
      properties: {
        ...payload.properties,
        $lib: "convex",
      },
    }),
  })
    .then((response) => {
      if (!response.ok) {
        console.error(
          `[posthog] Failed to capture event "${payload.event}": ${response.status} ${response.statusText}`
        );
      }
    })
    .catch((error) => {
      console.error(
        `[posthog] Failed to capture event "${payload.event}"`,
        error
      );
    });

  pendingEvents.push(promise);
}

/**
 * Wait for all pending PostHog events to be sent.
 * Call this at the end of your handler before returning.
 */
export async function drainPosthogEvents(): Promise<void> {
  if (pendingEvents.length === 0) {
    return;
  }

  await Promise.all(pendingEvents);
  pendingEvents.length = 0; // Clear the array
}
