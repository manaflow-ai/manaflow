import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Manaflow - Open Source Applied AI Lab",
  description: "We build open source coding software",
  openGraph: {
    title: "Manaflow - Open Source Applied AI Lab",
    description: "We build open source coding software",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Manaflow - Open Source Applied AI Lab",
    description: "We build open source coding software",
  },
};

export default function ManaflowPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-16 text-black font-mono">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-4 text-3xl font-bold">Manaflow</h1>
        <p className="mb-8 text-neutral-600">
          Open source applied AI lab. We build open source coding software.
        </p>

        <div className="flex flex-col gap-6">
          <div>
            <div className="flex items-center gap-2">
              <a
                href="https://cmux.dev"
                target="_blank"
                className="text-black underline hover:text-neutral-600"
              >
                cmux.dev
              </a>
              <a
                href="https://github.com/manaflow-ai/cmux"
                target="_blank"
                className="text-neutral-500 hover:text-neutral-700 hover:underline text-sm"
              >
                [github]
              </a>
            </div>
            <p className="text-neutral-600 text-sm mt-1">
              Coding agent manager that supports Claude Code, Codex, Gemini CLI,
              Amp, Opencode, and other coding CLIs.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <a
                href="https://0github.com"
                target="_blank"
                className="text-black underline hover:text-neutral-600"
              >
                0github.com
              </a>
              <a
                href="https://news.ycombinator.com/item?id=45760321"
                target="_blank"
                className="text-orange-500 hover:text-orange-600 hover:underline text-sm"
              >
                [hn]
              </a>
            </div>
            <p className="text-neutral-600 text-sm mt-1">
              Heatmap diff viewer for code reviews.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <a
                href="https://x.manaflow.com"
                target="_blank"
                className="text-black underline hover:text-neutral-600"
              >
                x.manaflow.com
              </a>
              <a
                href="https://x.com/xai/status/1997875233068626414"
                target="_blank"
                className="text-neutral-500 hover:text-neutral-700 hover:underline text-sm"
              >
                [x]
              </a>
            </div>
            <p className="text-neutral-600 text-sm mt-1">
              Curated algorithmic X/Twitter feed that lets coding agents
              escalate the most urgent tasks for human review.
            </p>
          </div>

          <div>
            <a
              href="https://preview.new"
              target="_blank"
              className="text-black underline hover:text-neutral-600"
            >
              preview.new
            </a>
            <p className="text-neutral-600 text-sm mt-1">
              Code review agent that takes screenshots of code diffs involving
              UI changes.
            </p>
          </div>
        </div>

        <div className="mt-12 flex gap-4 text-sm">
          <a
            href="https://x.com/manaflowai"
            target="_blank"
            className="text-neutral-500 hover:text-black hover:underline"
          >
            x
          </a>
          <a
            href="https://github.com/manaflow-ai"
            target="_blank"
            className="text-neutral-500 hover:text-black hover:underline"
          >
            github
          </a>
          <a
            href="https://discord.gg/FVevu78A"
            target="_blank"
            className="text-neutral-500 hover:text-black hover:underline"
          >
            discord
          </a>
          <a
            href="https://www.linkedin.com/company/manaflow-ai"
            target="_blank"
            className="text-neutral-500 hover:text-black hover:underline"
          >
            linkedin
          </a>
        </div>
      </div>
    </div>
  );
}
