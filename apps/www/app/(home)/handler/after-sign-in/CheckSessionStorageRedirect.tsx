"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OpenCmuxClient } from "./OpenCmuxClient";

const OAUTH_CALLBACK_KEY = "oauth_callback_url";

type CheckSessionStorageRedirectProps = {
  fallbackPath: string;
  electronFallbackHref?: string | null;
};

export function CheckSessionStorageRedirect({
  fallbackPath,
  electronFallbackHref,
}: CheckSessionStorageRedirectProps) {
  const router = useRouter();
  const [useElectronDeeplink, setUseElectronDeeplink] = useState(false);

  useEffect(() => {
    let redirectPath: string | null = null;

    try {
      const storedCallback = sessionStorage.getItem(OAUTH_CALLBACK_KEY);
      if (storedCallback) {
        // Validate it's a relative path for security
        if (storedCallback.startsWith("/") && !storedCallback.startsWith("//")) {
          redirectPath = storedCallback;
        }
        sessionStorage.removeItem(OAUTH_CALLBACK_KEY);
      }
    } catch {
      // sessionStorage not available
    }

    // If we have a stored web callback URL, use it
    if (redirectPath) {
      console.log("[CheckSessionStorageRedirect] Redirecting to stored callback:", redirectPath);
      router.replace(redirectPath);
      return;
    }

    // If we have an electron fallback href (with auth tokens), use electron deeplink
    // This is the default behavior for users coming from Electron without a web returnUrl
    if (electronFallbackHref) {
      console.log("[CheckSessionStorageRedirect] No stored callback, using electron deeplink");
      setUseElectronDeeplink(true);
      return;
    }

    // Final fallback to web path
    console.log("[CheckSessionStorageRedirect] Redirecting to fallback:", fallbackPath);
    router.replace(fallbackPath);
  }, [router, fallbackPath, electronFallbackHref]);

  // If using electron deeplink, render the OpenCmuxClient component
  if (useElectronDeeplink && electronFallbackHref) {
    return <OpenCmuxClient href={electronFallbackHref} />;
  }

  return (
    <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-400">Completing sign in...</p>
      </div>
    </div>
  );
}
