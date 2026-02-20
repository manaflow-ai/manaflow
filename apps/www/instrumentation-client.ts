// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a user loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE } from "@/lib/sentry-release";
import posthog from "posthog-js";

const isDev = process.env.NODE_ENV === "development";

if (!isDev) {
  Sentry.init({
    dsn: "https://96214f39aa409867381a22a79ff3e6a4@o4507547940749312.ingest.us.sentry.io/4510308518854656",
    release: SENTRY_RELEASE,

    // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
    tracesSampleRate: 1,
    // Enable logs to be sent to Sentry
    enableLogs: true,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
    integrations: (integrations) => [
      ...integrations,
      Sentry.thirdPartyErrorFilterIntegration({
        // Specify the application keys that you specified in the Sentry bundler plugin
        filterKeys: ["cmux-www"],
        // Defines how to handle errors that contain third party stack frames.
        // Possible values are:
        // - 'drop-error-if-contains-third-party-frames'
        // - 'drop-error-if-exclusively-contains-third-party-frames'
        // - 'apply-tag-if-contains-third-party-frames'
        // - 'apply-tag-if-exclusively-contains-third-party-frames'
        behaviour: "drop-error-if-contains-third-party-frames",
      }),
    ],
  });
}

// Initialize PostHog analytics client
// https://posthog.com/docs/integrations/js-integration
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey && !isDev) {
  posthog.init(posthogKey, {
    api_host: "/iiiii",
    ui_host: "https://us.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
    debug: process.env.NODE_ENV === "development",
  });
  posthog.register({
    platform: "cmux-www",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
