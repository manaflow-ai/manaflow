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
  title: "Blog — cloudrouter",
  description: "Updates, guides, and announcements from the cloudrouter team.",
  openGraph: {
    title: "Blog — cloudrouter",
    description:
      "Updates, guides, and announcements from the cloudrouter team.",
    type: "website",
  },
};

const posts = [
  {
    slug: "introducing-cloudrouter",
    title: "Introducing cloudrouter",
    description:
      "Cloud VMs and GPUs for Claude Code and Codex — the missing primitive for AI coding agents.",
    date: "2025-02-10",
  },
];

export default function BlogPage() {
  return (
    <div
      className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-20 ${sourceSerif.className}`}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between text-base">
          <Link href="/cloudrouter" className="flex items-center gap-2 font-bold">
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
              className="text-neutral-900 dark:text-white"
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

        {/* Title */}
        <section className="mb-8">
          <h1 className="mb-6 text-2xl font-bold leading-tight sm:text-3xl">
            Blog
          </h1>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Posts */}
        <div className="flex flex-col gap-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/cloudrouter/blog/${post.slug}`}
              className="group block"
            >
              <article>
                <p className="mb-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {post.date}
                </p>
                <h2 className="mb-1 text-lg font-semibold transition group-hover:text-neutral-600 dark:group-hover:text-neutral-300">
                  {post.title}
                </h2>
                <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                  {post.description}
                </p>
              </article>
            </Link>
          ))}
        </div>

        <hr className="mb-12 mt-8 border-neutral-200 dark:border-neutral-800" />

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
