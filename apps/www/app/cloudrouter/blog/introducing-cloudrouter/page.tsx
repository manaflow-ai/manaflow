import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import Link from "next/link";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal"],
  variable: "--font-source-serif",
});

export const metadata: Metadata = {
  title: "Introducing cloudrouter — cloudrouter blog",
  description:
    "Cloud VMs and GPUs for Claude Code and Codex — the missing primitive for AI coding agents.",
  openGraph: {
    title: "Introducing cloudrouter",
    description:
      "Cloud VMs and GPUs for Claude Code and Codex — the missing primitive for AI coding agents.",
    type: "article",
  },
};

export default function IntroducingCloudRouterPost() {
  return (
    <div
      className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-20 ${sourceSerif.className}`}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between text-base">
          <Link
            href="/cloudrouter"
            className="flex items-center gap-2 font-bold"
          >
            <svg
              viewBox="0 0 100 140"
              width="18"
              height="24"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="cr-grad"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
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
          </Link>
          <nav className="flex gap-4 text-neutral-500 dark:text-neutral-400">
            <Link
              href="/cloudrouter#install"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              Install
            </Link>
            <Link
              href="/cloudrouter#features"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              Features
            </Link>
            <Link
              href="/cloudrouter/blog"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              Blog
            </Link>
            <a
              href="https://github.com/manaflow-ai/cloudrouter"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-neutral-900 dark:hover:text-white"
            >
              GitHub
            </a>
          </nav>
        </header>

        {/* Post header */}
        <article>
          <p className="mb-2 text-xs text-neutral-400 dark:text-neutral-500">
            2025-02-10
          </p>
          <h1 className="mb-6 text-2xl font-bold leading-tight sm:text-3xl">
            Introducing cloudrouter
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Cloud VMs and GPUs for Claude Code and Codex — the missing primitive
            for AI coding agents.
          </p>

          {/* Hero image placeholder */}
          <div className="mb-8 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="flex h-64 items-center justify-center bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
              {/* Replace with: <Image src="/blog/introducing-cloudrouter/hero.png" alt="cloudrouter hero" width={672} height={256} className="w-full" /> */}
              Hero image
            </div>
          </div>

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* Section 1 */}
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">
              The problem
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              AI coding agents like Claude Code and Codex are powerful — but
              they&apos;re confined to your local machine. They can&apos;t spin up a VM to
              test a deployment, run GPU workloads, or experiment in an isolated
              environment without manual setup.
            </p>
            <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              This is the missing primitive. Agents need the ability to create
              and manage cloud infrastructure as naturally as they read and write
              files.
            </p>
          </section>

          {/* Image placeholder */}
          <div className="mb-8 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="flex h-48 items-center justify-center bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
              {/* Replace with: <Image src="/blog/introducing-cloudrouter/diagram.png" alt="Architecture diagram" width={672} height={192} className="w-full" /> */}
              Diagram image
            </div>
          </div>

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* Section 2 */}
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">
              How it works
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              cloudrouter installs as a skill for Claude Code, Cursor, and other
              AI agents. Once installed, agents can create cloud sandboxes from a
              local directory, git repo, or template with a single command.
            </p>
            <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Each sandbox is a full VM with Docker support, Chrome CDP for
              browser automation, VS Code in the browser, VNC desktop access, and
              file syncing between local and remote.
            </p>
          </section>

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* Section 3 */}
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">
              What you can do
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              With cloudrouter, your agents can:
            </p>
            <ul className="mb-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              <li>Spin up cloud VMs and GPUs on demand</li>
              <li>Run experiments in isolated environments</li>
              <li>Automate browsers with Chrome CDP</li>
              <li>Transfer files between local and remote</li>
              <li>Access sandboxes via VS Code, terminal, or VNC</li>
            </ul>
          </section>

          {/* Image placeholder */}
          <div className="mb-8 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="flex h-48 items-center justify-center bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500">
              {/* Replace with: <Image src="/blog/introducing-cloudrouter/demo.png" alt="Demo screenshot" width={672} height={192} className="w-full" /> */}
              Demo screenshot
            </div>
          </div>

          <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

          {/* Section 4 */}
          <section className="mb-8">
            <h2 className="mb-4 text-lg font-semibold">
              Get started
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Install cloudrouter as a skill and start creating sandboxes today.
              It&apos;s open source, MIT licensed, and works on macOS, Linux, and
              Windows.
            </p>
            <pre className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
              <code>npx skills add manaflow-ai/cloudrouter</code>
            </pre>
          </section>
        </article>

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
