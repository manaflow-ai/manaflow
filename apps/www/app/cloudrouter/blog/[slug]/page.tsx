import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { notFound } from "next/navigation";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal"],
  variable: "--font-source-serif",
});

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  content: React.ReactNode;
}

const posts: Record<string, BlogPost> = {
  "introducing-cloudrouter": {
    slug: "introducing-cloudrouter",
    title: "Introducing cloudrouter",
    description:
      "The missing primitive — giving Claude Code and Codex the ability to start up VMs and run experiments with GPUs.",
    date: "2025-06-01",
    content: (
      <>
        <section className="mb-8">
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            This is a placeholder blog post. Replace this content with your
            actual blog post.
          </p>
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Section heading</h2>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Section content goes here. You can include text, images, code
            blocks, and more.
          </p>
          {/* Example image placeholder — replace src with your actual image */}
          {/* <Image
            src="/blog/example.png"
            alt="Description of the image"
            width={672}
            height={378}
            className="mb-4 rounded-lg border border-neutral-200 dark:border-neutral-800"
          /> */}
        </section>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">Another section</h2>
          <p className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            More content here. The format mirrors the CloudRouter landing page —
            serif font, neutral palette, clean sections separated by horizontal
            rules.
          </p>
        </section>
      </>
    ),
  },
};

export function generateStaticParams() {
  return Object.keys(posts).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = posts[slug];
  if (!post) return {};
  return {
    title: `${post.title} — cloudrouter blog`,
    description: post.description,
    openGraph: {
      title: `${post.title} — cloudrouter blog`,
      description: post.description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} — cloudrouter blog`,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = posts[slug];
  if (!post) notFound();

  return (
    <div
      className={`flex min-h-screen flex-col items-center bg-white px-4 py-12 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100 sm:px-6 sm:py-20 ${sourceSerif.className}`}
    >
      <div className="w-full max-w-2xl">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between text-base">
          <Link
            href="/cloudrouter"
            className="flex items-center gap-2 font-bold transition hover:opacity-80"
          >
            <svg
              viewBox="0 0 100 140"
              width="18"
              height="24"
              aria-hidden="true"
            >
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
        <div className="mb-8">
          <time className="text-xs text-neutral-400 dark:text-neutral-500">
            {new Date(post.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">
            {post.title}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {post.description}
          </p>
        </div>

        <hr className="mb-8 border-neutral-200 dark:border-neutral-800" />

        {/* Post content */}
        {post.content}

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
