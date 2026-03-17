import type { Metadata } from "next";
import Link from "next/link";
import { Source_Serif_4 } from "next/font/google";
import { CloudrouterHeader } from "./header";
import { CodeBlock } from "./code-block";
import { InstallBar } from "./install-bar";
import { SkillContent } from "./skill-content";
import { TerminalDemo } from "./terminal-demo";


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

const instances = [
  { gpu: "T4", vram: "16 GB", bestFor: "Inference, fine-tuning small models" },
  { gpu: "L4", vram: "24 GB", bestFor: "Inference, image generation" },
  { gpu: "A10G", vram: "24 GB", bestFor: "Training medium models" },
  { gpu: "L40S", vram: "48 GB", bestFor: "Inference, video generation" },
  { gpu: "A100", vram: "40 GB", bestFor: "Training large models (7B–70B)" },
  { gpu: "A100-80GB", vram: "80 GB", bestFor: "Very large models" },
  { gpu: "H100", vram: "80 GB", bestFor: "Fast training, research" },
  { gpu: "H200", vram: "141 GB", bestFor: "Maximum memory capacity" },
  { gpu: "B200", vram: "192 GB", bestFor: "Latest gen, frontier models" },
] as const;

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
    <div
      className={`flex min-h-screen flex-col items-center overflow-x-hidden bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-16 ${sourceSerif.className}`}
    >
      <style dangerouslySetInnerHTML={{ __html: `.dark .shiki, .dark .shiki span { color: var(--shiki-dark) !important; background-color: var(--shiki-dark-bg) !important; }` }} />
      <div className="w-full min-w-0 max-w-3xl">
        <CloudrouterHeader />

        {/* Hero */}
        <section className="mb-8">
          <h1 className="mb-3 text-xl font-bold leading-tight sm:whitespace-nowrap sm:text-2xl">
            Skill for Claude Code/Codex to spin up VMs and GPUs
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            Give Claude Code, Codex, and other agents the ability to spin up cloud sandboxes,
            run commands, transfer files, and automate browsers — all from the CLI as a skill.
          </p>
        </section>

        {/* Install command */}
        <InstallBar />

        {/* Terminal Demo */}
        <TerminalDemo />

        {/* Docs content below */}
        <div className="mx-auto mt-20 w-full min-w-0 max-w-2xl">
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

          {/* Providers */}
          <section id="providers" className="mb-8 scroll-mt-8">
            <h2 className="mb-4 text-lg font-semibold">Providers</h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              cloudrouter connects to sandbox providers that provision the actual VMs and GPUs.
              After authenticating with <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">cloudrouter login</code>,
              you can create sandboxes on any supported provider.
            </p>

            <h3 className="mb-2 text-sm font-semibold">Currently supported</h3>
            <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                    <th className="px-4 py-2 font-semibold">Provider</th>
                    <th className="px-4 py-2 font-semibold">Flag</th>
                    <th className="px-4 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">E2B</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">-p e2b</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">Default provider. Supports Docker.</td>
                  </tr>
                  <tr className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">Modal</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">-p modal</td>
                    <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">Alternative provider with GPU support.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              We are actively working to support <span className="font-semibold">all major sandbox providers</span> including
              Vercel, Daytona, Morph, Freestyle, and others. If you have a preferred provider,{" "}
              <a
                href="mailto:founders@manaflow.ai"
                className="underline transition hover:text-neutral-900 dark:hover:text-white"
              >
                contact us
              </a>.
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
                'cloudrouter ssh cr_abc123 "npm install && npm run dev"',
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
                'cloudrouter browser open cr_abc123 "https://example.com"',
                "",
                "# Get the accessibility tree with element refs",
                "cloudrouter browser snapshot cr_abc123",
                "# → @e1 [input] Email  @e2 [input] Password  @e3 [button] Sign In",
                "",
                "# Interact with elements",
                'cloudrouter browser fill cr_abc123 @e1 "user@example.com"',
                'cloudrouter browser fill cr_abc123 @e2 "password123"',
                "cloudrouter browser click cr_abc123 @e3",
                "",
                "# Take a screenshot",
                "cloudrouter browser screenshot cr_abc123 result.png",
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

          {/* Instances / GPU options */}
          <section id="instances" className="mb-8 scroll-mt-8">
            <h2 className="mb-2 text-lg font-semibold">Instances</h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Standard sandboxes are available instantly. GPU instances can be added with{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">--gpu</code>.
              Multi-GPU supported via <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">--gpu H100:2</code>.
            </p>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                    <th className="px-4 py-2 font-semibold">GPU</th>
                    <th className="px-4 py-2 font-semibold">VRAM</th>
                    <th className="px-4 py-2 font-semibold">Best for</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((row) => (
                    <tr key={row.gpu} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{row.gpu}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-neutral-600 dark:text-neutral-400">{row.vram}</td>
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">{row.bestFor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* File transfer */}
          <section className="mb-8 scroll-mt-8">
            <h2 className="mb-4 text-lg font-semibold">File transfer</h2>
            <CodeBlock>
              {[
                "# Upload files to sandbox",
                "cloudrouter upload cr_abc123 ./src",
                "",
                "# Upload to a specific remote path",
                "cloudrouter upload cr_abc123 ./src -r /home/user/project/src",
                "",
                "# Download from sandbox",
                "cloudrouter download cr_abc123 ./dist",
                "",
                "# Watch mode — auto re-upload on changes",
                "cloudrouter upload cr_abc123 ./src --watch",
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

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* Skill reference — rendered from SKILL.md */}
          <section className="mb-8 scroll-mt-8">
            <h2 className="mb-4 text-lg font-semibold">Full skill reference</h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Copy this skill file directly into your coding agent.
            </p>
            <SkillContent />
          </section>

          <hr className="mb-12 border-neutral-200 dark:border-neutral-800" />
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
          <div className="flex flex-wrap justify-center gap-4">
            <a
              href="https://github.com/manaflow-ai/manaflow"
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
            <Link href="/privacy-policy" className="transition hover:text-neutral-900 dark:hover:text-white">
              Privacy
            </Link>
            <Link href="/terms-of-service" className="transition hover:text-neutral-900 dark:hover:text-white">
              Terms
            </Link>
            <Link href="/eula" className="transition hover:text-neutral-900 dark:hover:text-white">
              EULA
            </Link>
            <Link href="/contact" className="transition hover:text-neutral-900 dark:hover:text-white">
              Contact
            </Link>
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
