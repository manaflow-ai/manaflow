import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin, PluginOption } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolveWorkspacePackages } from "./electron-vite-plugin-resolve-workspace";
import { sentryVitePlugin } from "@sentry/vite-plugin";

function createExternalizeDepsPlugin(
  options?: Parameters<typeof externalizeDepsPlugin>[0]
): PluginOption {
  const plugin = externalizeDepsPlugin(options);
  if (typeof plugin === "object" && plugin !== null && !Array.isArray(plugin)) {
    const typedPlugin = plugin as Plugin & { exclude?: string[] };
    typedPlugin.name = "externalize-deps";
    const excludeOption = options?.exclude ?? [];
    const normalizedExclude = Array.isArray(excludeOption)
      ? excludeOption
      : [excludeOption];
    typedPlugin.exclude = normalizedExclude.filter(
      (entry): entry is string => typeof entry === "string"
    );
  }
  return plugin;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const SentryVitePlugin = process.env.SENTRY_AUTH_TOKEN ? sentryVitePlugin({
  org: "manaflow",
  project: "cmux-client-electron",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    filesToDeleteAfterUpload: ["**/*.map"],
  },
  telemetry: false
}) : undefined;

export default defineConfig({
  main: {
    plugins: [
      createExternalizeDepsPlugin({
        exclude: [
          "@cmux/server",
          "@cmux/server/**",
          "@cmux/shared",
          "@cmux/convex",
          "@cmux/www-openapi-client",
          "@sentry/electron",
        ],
      }),
      resolveWorkspacePackages(),
      SentryVitePlugin,
    ],
    envDir: repoRoot,
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/main/bootstrap.ts"),
        },
        treeshake: "smallest",
      },
      sourcemap: true,
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  preload: {
    plugins: [
      createExternalizeDepsPlugin({
        exclude: ["@cmux/server", "@cmux/server/**", "@sentry/electron"],
      }),
      resolveWorkspacePackages(),
      SentryVitePlugin,
    ],
    envDir: repoRoot,
    build: {
      rollupOptions: {
        input: {
          index: resolve("electron/preload/index.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
        treeshake: "smallest",
      },
      sourcemap: true,
    },
    envPrefix: "NEXT_PUBLIC_",
  },
  renderer: {
    root: ".",
    envDir: repoRoot,
    base: "./",
    build: {
      rollupOptions: {
        input: {
          index: resolve("index-electron.html"),
        },
        treeshake: "recommended",
      },
      sourcemap: true,
    },
    resolve: {
      alias: {
        "@": resolve("src"),
        "@cmux/www-openapi-client/client.gen": resolve(
          repoRoot,
          "packages/www-openapi-client/src/client/client.gen.ts"
        ),
      },
      // Dedupe so Monaco services (e.g. hoverService) are registered once
      dedupe: ["monaco-editor"],
    },
    optimizeDeps: {
      // Skip pre-bundling to avoid shipping a second Monaco runtime copy
      exclude: ["monaco-editor"],
      // Pre-include commonly used dependencies to prevent mid-session optimization
      // which causes page reloads and "optimized info should be defined" errors
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "convex/react",
        "convex/server",
        "@tanstack/react-router",
        "@tanstack/react-router-with-query",
        "@tanstack/react-query",
        "@tanstack/react-query-devtools",
        "@tanstack/react-router-devtools",
        "@tanstack/react-virtual",
        "@sentry/react",
        "@heroui/react",
        "@stackframe/react",
        "@convex-dev/react-query",
        "antd",
        "sonner",
        "@monaco-editor/react",
        "zod",
        "@t3-oss/env-core",
        "jose",
        "clsx",
        "tailwind-merge",
        "class-variance-authority",
        "lucide-react",
        "cmdk",
        "framer-motion",
        "prismjs",
        "fuzzysort",
        "vscode-icons-js",
        "socket.io-client",
        "date-fns",
        "react-markdown",
        "remark-gfm",
        "react-textarea-autosize",
        "posthog-js",
        "@posthog/react",
        "@mantine/hooks",
        // Radix UI
        "@radix-ui/react-tooltip",
        "@radix-ui/react-popover",
        "@radix-ui/react-dialog",
        "@radix-ui/react-slot",
        "@radix-ui/react-dropdown-menu",
        // Base UI
        "@base-ui-components/react/context-menu",
        "@base-ui-components/react/menu",
        // Lexical editor
        "lexical",
        "@lexical/code",
        "@lexical/link",
        "@lexical/list",
        "@lexical/markdown",
        "@lexical/rich-text",
        "@lexical/react/LexicalComposer",
        "@lexical/react/LexicalComposerContext",
        "@lexical/react/LexicalContentEditable",
        "@lexical/react/LexicalErrorBoundary",
        "@lexical/react/LexicalHistoryPlugin",
        "@lexical/react/LexicalAutoFocusPlugin",
        "@lexical/react/LexicalLinkPlugin",
        "@lexical/react/LexicalListPlugin",
        "@lexical/react/LexicalMarkdownShortcutPlugin",
        "@lexical/react/LexicalOnChangePlugin",
        "@lexical/react/LexicalRichTextPlugin",
        // Xterm
        "@xterm/xterm",
        "@xterm/addon-attach",
        "@xterm/addon-fit",
        "@xterm/addon-search",
        "@xterm/addon-unicode11",
        "@xterm/addon-web-links",
        "@xterm/addon-webgl",
      ],
    },
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
    envPrefix: "NEXT_PUBLIC_",
  },
});
