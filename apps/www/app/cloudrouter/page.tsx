import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { CodeBlock } from "./code-block";
import { SkillContent } from "./skill-content";


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
    <div className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-20 ${sourceSerif.className}`}>
      <style dangerouslySetInnerHTML={{ __html: `.dark .shiki, .dark .shiki span { color: var(--shiki-dark) !important; background-color: var(--shiki-dark-bg) !important; }` }} />
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
          <nav className="flex items-center gap-4 text-neutral-500 dark:text-neutral-400">
            <a href="#install" className="transition hover:text-neutral-900 dark:hover:text-white">
              Install
            </a>
            <a href="#features" className="transition hover:text-neutral-900 dark:hover:text-white">
              Features
            </a>
            <a
              href="https://github.com/manaflow-ai/manaflow/tree/main/packages/cloudrouter"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center transition hover:text-neutral-900 dark:hover:text-white"
              aria-label="manaflow on GitHub"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
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

        {/* Skill reference — rendered from SKILL.md */}
        <SkillContent />

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
