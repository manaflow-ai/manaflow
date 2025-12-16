import { init } from "@sentry/electron/renderer";
import {
  init as reactInit,
  tanstackRouterBrowserTracingIntegration,
} from "@sentry/react";
import { SENTRY_ELECTRON_DSN } from "./sentry-config.ts";
import { router } from "./router";

init(
  {
    dsn: SENTRY_ELECTRON_DSN,
    integrations: [tanstackRouterBrowserTracingIntegration(router)],
    // Setting a sample rate is required for sending performance data.
    // Adjust this value in production or use tracesSampler for finer control.
    tracesSampleRate: 1.0,
  },
  reactInit
);


import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
