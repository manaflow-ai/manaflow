import { init, tanstackRouterBrowserTracingIntegration } from "@sentry/react";
import { router } from "./router";
import { SENTRY_WEB_DSN } from "./sentry-config";

init({
  dsn: SENTRY_WEB_DSN,
  integrations: [tanstackRouterBrowserTracingIntegration(router)],
  // Setting a sample rate is required for sending performance data.
  // Adjust this value in production or use tracesSampler for finer control.
  tracesSampleRate: 1.0,
});

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
