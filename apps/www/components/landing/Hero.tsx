import Link from "next/link";
import FakeCmuxUI from "./FakeCmuxUI";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-start overflow-visible pt-20 pb-20 bg-transparent">

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 text-left">
        {/* Main headline */}
        <h1 className="text-2xl md:text-4xl mb-4 leading-tight text-neutral-900 dark:text-white tracking-tighter" style={{ fontWeight: 420 }}>
          Built for <span className="text-[#3B82F6]">multi-tasking.</span>
        </h1>

        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl">
          Manaflow is an open-source AI coding agent orchestrator that allows you to run multiple coding agents in parallel.
        </p>

        {/* CTA Buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <a
            href="https://cmux.sh"
            className="inline-flex items-center gap-2 bg-white text-black border border-neutral-300 pl-4 pr-6 py-3 rounded-lg text-base font-medium shadow-sm transition hover:bg-neutral-100"
          >
            <svg className="w-6 h-6 shrink-0" viewBox="4 2 16 20" fill="none">
              <defs>
                <linearGradient id="heroCtaLogoGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00D4FF" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <path
                d="M6 4L18 12L6 20V15.5L12.5 12L6 8.5V4Z"
                fill="url(#heroCtaLogoGradient)"
              />
            </svg>
            Try Web Version
          </a>
          <Link
            href="/direct-download-macos"
            className="inline-flex items-center gap-2 bg-black text-white border border-neutral-700 pl-4 pr-6 py-3 rounded-lg text-base font-medium shadow-sm transition hover:bg-neutral-800"
          >
            <svg className="w-6 h-6 shrink-0 relative -top-px" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            Download for Mac
          </Link>
        </div>

        {/* Demo Section */}
        <div className="mt-12 w-full relative pb-24">
          <FakeCmuxUI />
        </div>
      </div>
    </section>
  );
}
