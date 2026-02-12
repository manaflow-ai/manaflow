"use client";

import { isElectron } from "@/lib/electron";
import { getElectronBridge } from "@/lib/electron";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import { SignIn, useUser } from "@stackframe/react";
import { AnimatePresence, motion } from "framer-motion";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

export function SignInComponent() {
  const user = useUser({ or: "return-null" });
  const showSignIn = !user;
  const [protocolStatus, setProtocolStatus] = useState<
    | { ok: true; isPackaged: boolean; isDefaultProtocolClient: boolean }
    | { ok: false; error: string }
    | null
  >(null);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = getElectronBridge();
    if (!bridge?.app?.getProtocolStatus) return;

    bridge.app
      .getProtocolStatus()
      .then((res) => {
        setProtocolStatus(res);
      })
      .catch((error: unknown) => {
        console.error("[SignIn] Failed to get protocol status:", error);
        setProtocolStatus({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, []);

  const browserSignInSupported = useMemo(() => {
    if (!isElectron) return true;
    if (!protocolStatus) return true; // optimistic until we know otherwise
    if (!protocolStatus.ok) return true;
    return protocolStatus.isDefaultProtocolClient;
  }, [protocolStatus]);

  const showEmbeddedSignIn =
    !isElectron || import.meta.env.DEV || !browserSignInSupported;

  return (
    <AnimatePresence mode="wait">
      {showSignIn ? (
        <motion.div
          key="signin"
          className="absolute inset-0 w-screen h-dvh flex items-center justify-center bg-white dark:bg-black z-[var(--z-global-blocking)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {isElectron ? (
            <div
              className="absolute top-0 left-0 right-0 h-[24px]"
              style={{ WebkitAppRegion: "drag" } as CSSProperties}
            />
          ) : null}
          {isElectron ? (
            <div className="flex flex-col items-center gap-4 p-6 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
              <div className="text-center">
                <p className="text-neutral-900 dark:text-neutral-100 font-medium">
                  Sign in required
                </p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  We'll open your browser to continue.
                </p>
                {!browserSignInSupported ? (
                  <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                    The <code className="font-mono">cmux://</code> deeplink isn&apos;t registered on this machine for
                    this app build. Restart cmux to re-register, or use the embedded sign-in below.
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => {
                  if (!browserSignInSupported) return;
                  const url = `${WWW_ORIGIN}/handler/sign-in`;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
                disabled={!browserSignInSupported}
                className={`px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 ${browserSignInSupported ? "hover:opacity-90" : "opacity-50 cursor-not-allowed"}`}
              >
                Sign in with browser
              </button>
              <p className="text-xs text-neutral-500 dark:text-neutral-500 text-center">
                After signing in, you'll be returned automatically.
              </p>
              {showEmbeddedSignIn ? <SignIn /> : null}
            </div>
          ) : (
            <SignIn />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
