import { getRandomKitty } from "@/components/kitties";
import CmuxLogoMarkAnimated from "@/components/logo/cmux-logo-mark-animated";
import clsx from "clsx";

interface CmuxLoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function CmuxLoadingOverlay({
  visible,
  message,
}: CmuxLoadingOverlayProps) {
  return (
    <div
      className={clsx(
        "absolute inset-0 w-screen h-dvh flex flex-col items-center justify-center bg-white dark:bg-black z-[var(--z-global-blocking)] transition-opacity",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <CmuxLogoMarkAnimated height={40} duration={2.9} />
        {message ? (
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            {message}
          </div>
        ) : null}
      </div>
      <pre className="text-xs font-mono text-neutral-200 dark:text-neutral-800 absolute bottom-0 left-0 pl-4 pb-4">
        {getRandomKitty()}
      </pre>
    </div>
  );
}
