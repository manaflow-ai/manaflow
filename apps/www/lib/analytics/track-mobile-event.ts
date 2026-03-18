import {
  type MobileAnalyticsEventName,
  type MobileAnalyticsProperties,
} from "@cmux/shared/mobile-analytics";
import { captureServerPosthogEvent } from "./posthog-server";

function compactProperties(
  properties: MobileAnalyticsProperties,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter((entry) => entry[1] !== undefined),
  );
}

export async function trackMobileEvent(args: {
  distinctId: string;
  event: MobileAnalyticsEventName;
  properties?: MobileAnalyticsProperties;
}): Promise<void> {
  await captureServerPosthogEvent({
    distinctId: args.distinctId,
    event: args.event,
    properties: compactProperties(args.properties ?? {}),
  });
}
