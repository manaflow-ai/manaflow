"use client";

import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useStackApp } from "@stackframe/stack";
import { Loader2 } from "lucide-react";

type OAuthProvider = "github" | "gitlab" | "bitbucket" | "google";

const VALID_PROVIDERS: OAuthProvider[] = [
  "github",
  "gitlab",
  "bitbucket",
  "google",
];

const PROVIDER_DISPLAY_NAMES: Record<OAuthProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  google: "Google",
};

function isValidProvider(provider: string): provider is OAuthProvider {
  return VALID_PROVIDERS.includes(provider as OAuthProvider);
}

export default function OAuthSignInPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const app = useStackApp();
  const hasInitiated = useRef(false);

  const provider = typeof params.provider === "string" ? params.provider : "";
  const afterAuthReturnTo = searchParams.get("after_auth_return_to");

  useEffect(() => {
    if (hasInitiated.current) return;
    if (!provider || !isValidProvider(provider)) return;

    hasInitiated.current = true;

    const initiateOAuth = async () => {
      try {
        // Use signInWithOAuth for direct OAuth flow
        // The afterCallbackRedirectUrl should be where Stack Auth redirects after OAuth
        await app.signInWithOAuth(provider);
      } catch (error) {
        console.error("[OAuthSignInPage] Failed to initiate OAuth sign-in", error);
        // If OAuth fails, redirect to the default sign-in page
        const fallbackUrl = afterAuthReturnTo
          ? `${app.urls.signIn}?after_auth_return_to=${encodeURIComponent(afterAuthReturnTo)}`
          : app.urls.signIn;
        window.location.href = fallbackUrl;
      }
    };

    // Store the callback URL so the after-sign-in page can use it
    // Stack Auth's afterSignIn handler will check this
    try {
      if (afterAuthReturnTo) {
        sessionStorage.setItem("oauth_callback_url", afterAuthReturnTo);
      }
    } catch {
      // sessionStorage might not be available
    }

    void initiateOAuth();
  }, [provider, afterAuthReturnTo, app]);

  if (!provider || !isValidProvider(provider)) {
    return (
      <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">Invalid OAuth provider</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-400">
          Redirecting to {PROVIDER_DISPLAY_NAMES[provider]}...
        </p>
      </div>
    </div>
  );
}
