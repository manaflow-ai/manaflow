import Link from "next/link";
import DoubleChevron from "./DoubleChevron";
import FakeCmuxUI from "./FakeCmuxUI";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-start overflow-hidden pt-32 bg-[#fafafa] dark:bg-[#0a0a0a]">

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-30 dark:opacity-20"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)`,
          backgroundSize: '64px 64px'
        }}
      />

      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 text-left">
        {/* Main headline */}
        <h1 className="text-3xl md:text-5xl mb-6 leading-tight text-neutral-900 dark:text-white tracking-tighter" style={{ fontWeight: 420 }}>
          Built for <span className="text-purple-800 dark:text-purple-400">multi-tasking.</span>
        </h1>

        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl">
          cmux is an open-source AI coding agent orchestrator that allows you to run multiple coding agents in parallel.
        </p>

        {/* CTA Buttons */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/download"
            className="inline-flex items-center gap-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 px-6 py-3 rounded-lg text-base font-medium hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            Download for Mac
          </Link>
          <a
            href="https://cmux.sh"
            className="inline-flex items-center gap-2 border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 px-6 py-3 rounded-lg text-base font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            Try Web Version
          </a>
        </div>

        {/* Demo Section */}
        <div className="mt-16 w-full relative pb-16">
          <DoubleChevron height={550} className="top-0" />
          <FakeCmuxUI />
        </div>
      </div>
    </section>
  );
}
