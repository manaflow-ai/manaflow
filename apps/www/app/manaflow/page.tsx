import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Manaflow - Open Source Applied AI Lab",
  description:
    "Open source applied AI lab building next-gen devtools",
  openGraph: {
    title: "Manaflow - Open Source Applied AI Lab",
    description:
      "Open source applied AI lab building next-gen devtools",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Manaflow - Open Source Applied AI Lab",
    description:
      "Open source applied AI lab building next-gen devtools",
  },
};

export default function ManaflowPage() {
  return (
    <div className="min-h-screen bg-white px-4 py-16 text-black" style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}>
      <div className="mx-auto max-w-xl">
        <h1 className="mb-2 text-3xl font-bold">Manaflow</h1>
        <p className="mb-6 text-neutral-600">
          Open source applied AI lab building next-gen devtools.
        </p>

        <div className="flex items-center gap-2">
          <a
            href="https://cmux.com"
            target="_blank"
            className="text-black underline hover:text-neutral-600"
          >
            cmux.com
          </a>
          <a
            href="https://github.com/manaflow-ai/cmux"
            target="_blank"
            className="text-neutral-500 hover:text-neutral-700 hover:underline text-sm"
          >
            [github]
          </a>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          The open source terminal built for coding agents.
        </p>
        <img
          src="/cmux-screenshot.jpg"
          alt="cmux — the terminal built for coding agents"
          className="mt-3 w-full rounded-lg -ml-4"
        />

        <div className="mt-6 flex gap-4 text-sm">
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
            href="https://discord.gg/SDbQmzQhRK"
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
