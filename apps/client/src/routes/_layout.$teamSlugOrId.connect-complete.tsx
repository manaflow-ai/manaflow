import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const GITHUB_INSTALL_COMPLETE_MESSAGE_TYPE =
  "manaflow/github-install-complete";

export const Route = createFileRoute("/_layout/$teamSlugOrId/connect-complete")(
  {
    component: ConnectComplete,
    validateSearch: z.object({
      popup: z.boolean().optional(),
    }),
  }
);

function ConnectComplete() {
  const { teamSlugOrId } = Route.useParams();
  const { popup } = Route.useSearch();
  const CLOSE_AFTER_SECONDS = 6;
  const [seconds, setSeconds] = useState(CLOSE_AFTER_SECONDS);
  const triedAutoClose = useRef(false);

  useEffect(() => {
    // Check if this is a web popup flow via query param or window.opener
    const isWebPopup = popup === true || window.opener !== null;

    // For web popups, immediately post message and close
    if (isWebPopup) {
      try {
        window.opener?.postMessage?.(
          { type: GITHUB_INSTALL_COMPLETE_MESSAGE_TYPE },
          window.location.origin
        );
        window.opener?.focus?.();
        // Small delay to ensure message is sent before closing
        setTimeout(() => {
          window.close();
        }, 100);
      } catch (_e) {
        // ignored - will fall back to countdown
      }
      return;
    }

    // For non-popup (Electron flow), try deep link
    const href = `manaflow://github-connect-complete?team=${encodeURIComponent(
      teamSlugOrId
    )}`;
    try {
      window.location.href = href;
    } catch {
      // non-fatal; user can return manually
    }
  }, [teamSlugOrId, popup]);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    if (seconds === 0 && !triedAutoClose.current) {
      triedAutoClose.current = true;
      try {
        window.opener?.postMessage?.(
          { type: GITHUB_INSTALL_COMPLETE_MESSAGE_TYPE },
          window.location.origin
        );
        window.opener?.focus?.();
        window.close();
      } catch (_e) {
        // ignored
      }
    }
  }, [seconds]);

  const handleClose = () => {
    try {
      window.close();
    } catch (_e) {
      // If browser blocks programmatic close, fall back to navigation option
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-4 py-10 bg-gradient-to-b from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-md">
        <div className="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 shadow-xl backdrop-blur-sm">
          <div className="p-8">
            <div className="mx-auto mb-6 grid place-items-center">
              <div className="h-14 w-14 rounded-full bg-neutral-100 dark:bg-neutral-900 ring-8 ring-neutral-50 dark:ring-neutral-950 grid place-items-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <h1 className="text-xl font-semibold text-center text-neutral-900 dark:text-neutral-100">
              GitHub Connected
            </h1>
            <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
              You can now close this window and return to your Manaflow tab.
            </p>
            <p
              className="mt-4 text-center text-xs text-neutral-500 dark:text-neutral-500"
              aria-live="polite"
            >
              This window will close automatically in{" "}
              <span className="tabular-nums">{seconds}</span>s.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus:ring-neutral-700"
              >
                Close Window
              </button>

              <div className="mt-1 text-[11px] text-center text-neutral-500 dark:text-neutral-500">
                If this window doesn't close, use the button above.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
