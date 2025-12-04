import { isElectron } from "@/lib/electron";
import { X } from "lucide-react";
import { useState, useEffect } from "react";

const BANNER_DISMISSED_KEY = "cmux-web-banner-dismissed";

export function WebAppBanner() {
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem(BANNER_DISMISSED_KEY);
    setIsDismissed(dismissed === "true");
  }, []);

  if (isElectron || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(BANNER_DISMISSED_KEY, "true");
    setIsDismissed(true);
  };

  return (
    <div className="bg-[#1e3a5f] text-white/90 text-xs py-1 px-3 flex items-center justify-center gap-2">
      <span className="text-white/70">
        Open source desktop app available at{" "}
        <a
          href="https://cmux.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/90 hover:text-white underline underline-offset-2"
        >
          cmux.dev
        </a>
      </span>
      <button
        onClick={handleDismiss}
        className="text-white/50 hover:text-white/80 p-0.5 -mr-1"
        aria-label="Dismiss banner"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
