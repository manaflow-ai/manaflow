import { isElectron } from "@/lib/electron";

export function WebVersionBanner() {
  if (isElectron) {
    return null;
  }

  return (
    <div className="w-full border-b border-white/10 bg-[#0b2040] text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 px-3 py-2 text-xs sm:text-sm">
        <span className="font-medium text-white/90">
          Using cmux.sh in the browser?
        </span>
        <a
          href="https://cmux.dev"
          className="rounded-sm px-2 py-1 text-white underline decoration-white/60 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
          target="_blank"
          rel="noreferrer"
        >
          Download the Electron app at cmux.dev
        </a>
        <span className="text-white/80">Open source and ready for desktop.</span>
      </div>
    </div>
  );
}
