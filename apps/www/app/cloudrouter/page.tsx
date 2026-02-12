import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { CloudrouterHeader } from "./header";
import { CodeBlock } from "./code-block";
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

export default function CloudRouterPage() {
  return (
    <div
      className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-16 ${sourceSerif.className}`}
    >
      <style dangerouslySetInnerHTML={{ __html: `.dark .shiki, .dark .shiki span { color: var(--shiki-dark) !important; background-color: var(--shiki-dark-bg) !important; }` }} />
      <div className="w-full max-w-3xl">
        <CloudrouterHeader />

        {/* Hero */}
        <section className="mb-10 text-center">
          <h1 className="mb-3 text-2xl font-bold leading-tight sm:text-3xl">
            Cloud VMs and GPUs for AI coding agents
          </h1>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
            Give Claude Code, Codex, and other agents the ability to spin up cloud sandboxes,
            run commands, transfer files, and automate browsers — all from the CLI.
          </p>
        </section>

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

          {/* Skill reference — rendered from SKILL.md */}
          <SkillContent />

          <hr className="mb-12 border-neutral-200 dark:border-neutral-800" />
        </div>

        {/* Footer */}
        <footer className="flex flex-col items-center gap-4 text-center text-xs text-neutral-400 dark:text-neutral-500">
          <div className="flex gap-4">
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
