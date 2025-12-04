import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { sentryVitePlugin } from "@sentry/vite-plugin";

import { relatedProjects } from "@vercel/related-projects";

const NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW = relatedProjects().find(
  (p) => p.project.name === "cmux-www"
)?.preview.branch;

// Ensure all env is loaded
await import("./src/client-env.ts");

const SentryVitePlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
      org: "manaflow",
      project: "cmux-client-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ["**/*.map"],
      },
      telemetry: false,
    })
  : undefined;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
    SentryVitePlugin,
  ],
  resolve: {
    // Dedupe so Monaco services (e.g. hoverService) are registered once
    dedupe: ["monaco-editor"],
  },
  optimizeDeps: {
    // Skip pre-bundling to avoid shipping a second Monaco runtime copy
    exclude: ["monaco-editor"],
  },
  define: {
    "process.env": {},
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development"
    ),
    "process.env.NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW": JSON.stringify(
      NEXT_PUBLIC_RELATED_WWW_ORIGIN_PREVIEW
    ),
    global: "globalThis",
  },
  envPrefix: "NEXT_PUBLIC_",
  // TODO: make this safe
  server: {
    allowedHosts: true,
  },
});
