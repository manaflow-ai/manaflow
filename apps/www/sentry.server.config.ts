// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE } from "@/lib/sentry-release";
import { attachStackAuthToEvent } from "@/lib/utils/sentry";

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
  beforeSend: (event, _hint) => attachStackAuthToEvent(event),
});
