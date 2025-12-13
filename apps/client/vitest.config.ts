import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const testClientEnv = {
  NEXT_PUBLIC_CONVEX_URL: "https://example.com/convex",
  NEXT_PUBLIC_STACK_PROJECT_ID: "stack-project",
  NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: "stack-publishable-key",
  NEXT_PUBLIC_WWW_ORIGIN: "https://www.example.com",
  NEXT_PUBLIC_SERVER_ORIGIN: "https://server.example.com",
};

const testImportMetaEnv = {
  ...testClientEnv,
  MODE: "test",
  DEV: false,
  PROD: false,
  SSR: false,
  BASE_URL: "/",
  TEST: true,
};

export default defineConfig({
  plugins: [
    tsconfigPaths({
      // Only scan from apps/client to avoid dev-docs submodules with unresolved tsconfig extends
      root: import.meta.dirname,
    }),
  ],
  test: {
    environment: "node",
    env: testClientEnv,
  },
  define: {
    "import.meta.env": JSON.stringify(testImportMetaEnv),
  },
});
