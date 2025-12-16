import * as Sentry from "@sentry/nextjs";
import { SENTRY_RELEASE } from "@/lib/sentry-release";

if (process.env.NODE_ENV !== "development") {
  Sentry.init({
    dsn: "https://96214f39aa409867381a22a79ff3e6a4@o4507547940749312.ingest.us.sentry.io/4510308518854656",
    release: SENTRY_RELEASE,
    tracesSampleRate: 1,
    enableLogs: true,
    sendDefaultPii: true,
  });
}
