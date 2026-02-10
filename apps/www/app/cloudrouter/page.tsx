import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { CopyButton } from "./copy-button";


const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal"],
  variable: "--font-source-serif",
});

export const metadata: Metadata = {
  title: "cloudrouter — Cloud VMs/GPUs for Claude Code/Codex",
  description:
    "Cloud sandboxes for development. Instant remote VMs with VS Code, terminal, VNC, and browser automation via Chrome CDP.",
  openGraph: {
    title: "cloudrouter — Cloud VMs/GPUs for Claude Code/Codex",
    description:
      "Cloud sandboxes for development. Instant remote VMs with VS Code, terminal, VNC, and browser automation via Chrome CDP.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "cloudrouter — Cloud VMs/GPUs for Claude Code/Codex",
    description:
      "Cloud sandboxes for development. Instant remote VMs with VS Code, terminal, VNC, and browser automation via Chrome CDP.",
  },
};

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 pr-16 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
        <code>{children}</code>
      </pre>
      <CopyButton text={children} />
    </div>
  );
}

const features = [
  {
    title: "Instant cloud sandboxes",
    description:
      "Spin up a remote VM from a local directory, git repo, or template. Built-in Docker support and automatic file syncing.",
  },
  {
    title: "AI agent skill",
    description:
      "Install as a skill for Claude Code, Cursor, and other agents. Give them the power to create sandboxes, run code, and automate browsers.",
  },
  {
    title: "Browser automation",
    description:
      "Full Chrome CDP integration. Navigate, click, type, take screenshots, and read accessibility trees — all from the CLI.",
  },
  {
    title: "Multiple access methods",
    description:
      "VS Code in browser, VNC desktop, interactive terminal, or one-off command execution. Pick what fits your workflow.",
  },
  {
    title: "File transfer",
    description:
      "Upload and download files between local and sandbox. Watch mode for auto re-upload on changes with exclude patterns.",
  },
  {
    title: "Open source",
    description: "MIT licensed. Built in Go, distributed as npm packages for macOS, Linux, and Windows.",
  },
];

export default function CloudRouterPage() {
  return (
    <div className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-20 ${sourceSerif.className}`}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between text-base">
          <span className="flex items-center gap-2 font-bold">
            <svg viewBox="0 0 100 140" width="18" height="24" aria-hidden="true">
              <defs>
                <linearGradient id="cr-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00D4FF" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <path
                d="M0 0L97 67L0 135V111L52.5 67L0 23Z"
                fill="url(#cr-grad)"
              />
            </svg>
            <span className="text-lg">cloudrouter</span>
          </span>
          <nav className="flex gap-4 text-neutral-500 dark:text-neutral-400">
            <a href="#install" className="transition hover:text-neutral-900 dark:hover:text-white">
              Install
            </a>
            <a href="#features" className="transition hover:text-neutral-900 dark:hover:text-white">
              Features
            </a>
            <a
              href="https://github.com/manaflow-ai/manaflow"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900 dark:hover:text-white"
              aria-label="GitHub"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </nav>
        </header>

        {/* Hero */}
        <section className="mb-8">
          <h1 className="mb-6 text-2xl font-bold leading-tight sm:text-3xl">
            Cloud VMs/GPUs for Claude Code/Codex
          </h1>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            The missing primitive — giving Claude Code and Codex the ability to start up VMs and run experiments with GPUs.
            Agents start up VMs from your local directory, run commands, transfer files,
            control browsers, and run GPUs directly from the command line.
          </p>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Install as agent skill */}
        <section id="install" className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">Install</h2>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Install cloudrouter as a skill for Claude Code, Codex, or other coding agents.
          </p>
          <CodeBlock>{`npx skills add manaflow-ai/cloudrouter`}</CodeBlock>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Manual installation */}
        <section id="manual-install" className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">Manual installation</h2>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            You can also install cloudrouter as a standalone CLI.
          </p>
          <CodeBlock>{`npm install -g @manaflow-ai/cloudrouter`}</CodeBlock>
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
            Then authenticate:
          </p>
          <div className="mt-2">
            <CodeBlock>{`cloudrouter login`}</CodeBlock>
          </div>
          <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
            Both <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">cloudrouter</code> and <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">cr</code> work as aliases.
          </p>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Quick start */}
        <section className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">Quick start</h2>
          <CodeBlock>
            {[
              "# Create a sandbox from the current directory",
              "cloudrouter start .",
              "",
              "# Open VS Code in the browser",
              "cloudrouter code cr_abc123",
              "",
              "# Or get a terminal",
              "cloudrouter pty cr_abc123",
              "",
              "# Run a command",
              'cloudrouter exec cr_abc123 "npm install && npm run dev"',
              "",
              "# Open VNC desktop",
              "cloudrouter vnc cr_abc123",
            ].join("\n")}
          </CodeBlock>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Browser automation */}
        <section className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">Browser automation</h2>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Every sandbox includes Chrome CDP integration. Navigate, interact with elements
            using accessibility tree refs, take screenshots, and scrape data.
          </p>
          <CodeBlock>
            {[
              "# Open a URL in the sandbox browser",
              'cloudrouter computer open cr_abc123 "https://example.com"',
              "",
              "# Get the accessibility tree with element refs",
              "cloudrouter computer snapshot cr_abc123",
              "# → @e1 [input] Email  @e2 [input] Password  @e3 [button] Sign In",
              "",
              "# Interact with elements",
              'cloudrouter computer fill cr_abc123 @e1 "user@example.com"',
              'cloudrouter computer fill cr_abc123 @e2 "password123"',
              "cloudrouter computer click cr_abc123 @e3",
              "",
              "# Take a screenshot",
              "cloudrouter computer screenshot cr_abc123 result.png",
            ].join("\n")}
          </CodeBlock>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Features */}
        <section id="features" className="mb-8 scroll-mt-8">
          <h2 className="mb-6 text-lg font-semibold">Features</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title}>
                <h3 className="mb-1 text-sm font-semibold">{feature.title}</h3>
                <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* File transfer */}
        <section className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">File transfer</h2>
          <CodeBlock>
            {[
              "# Upload files to sandbox",
              "cloudrouter upload cr_abc123 ./src /home/user/project/src",
              "",
              "# Download from sandbox",
              "cloudrouter download cr_abc123 /home/user/project/dist ./dist",
              "",
              "# Watch mode — auto re-upload on changes",
              "cloudrouter upload cr_abc123 ./src /home/user/project/src --watch",
            ].join("\n")}
          </CodeBlock>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Sandbox management */}
        <section className="mb-8 scroll-mt-8">
          <h2 className="mb-4 text-lg font-semibold">Sandbox management</h2>
          <CodeBlock>
            {[
              "# List running sandboxes",
              "cloudrouter ls",
              "",
              "# Check status",
              "cloudrouter status cr_abc123",
              "",
              "# Stop a sandbox",
              "cloudrouter stop cr_abc123",
              "",
              "# Delete a sandbox",
              "cloudrouter delete cr_abc123",
            ].join("\n")}
          </CodeBlock>
        </section>

        <hr className="mb-12 border-neutral-200 dark:border-neutral-800" />

        {/* Footer */}
        <footer className="flex flex-col items-center gap-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
          <div className="flex gap-4">
            <a
              href="https://github.com/manaflow-ai/cloudrouter"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              GitHub
            </a>
            <a
              href="https://twitter.com/manaflowai"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              Twitter
            </a>
            <a
              href="https://discord.gg/SDbQmzQhRK"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              Discord
            </a>
          </div>
          <span>
            cloudrouter by{" "}
            <a
              href="https://manaflow.com"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              manaflow
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
