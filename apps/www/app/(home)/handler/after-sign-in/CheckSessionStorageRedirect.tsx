"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

const OAUTH_CALLBACK_KEY = "oauth_callback_url";

type CheckSessionStorageRedirectProps = {
  fallbackPath: string;
};

export function CheckSessionStorageRedirect({
  fallbackPath,
}: CheckSessionStorageRedirectProps) {
  const router = useRouter();

  useEffect(() => {
    let redirectPath = fallbackPath;

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

    console.log("[CheckSessionStorageRedirect] Redirecting to:", redirectPath);
    router.replace(redirectPath);
  }, [router, fallbackPath]);

  return (
    <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-400">Completing sign in...</p>
      </div>
    </div>
  );
}
