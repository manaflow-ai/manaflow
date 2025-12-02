"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

const OAUTH_COMPLETE_KEY = "oauth_popup_complete";

/**
 * OAuth callback page that signals completion to the parent window.
 * This page is opened in a popup, and when the OAuth flow completes, Stack Auth
 * redirects here. We signal the parent via postMessage and localStorage, then close.
 */
export default function OAuthCallbackPage() {
  useEffect(() => {
    // Signal completion to parent window via multiple channels for reliability
    const signalCompletion = () => {
      // Method 1: postMessage to opener (works if same-origin or if opener exists)
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(
            { type: OAUTH_COMPLETE_KEY, success: true },
            window.location.origin
          );
        }
      } catch {
        // Opener might be cross-origin or null
      }

      // Method 2: localStorage event (works across tabs/windows on same origin)
      try {
        localStorage.setItem(OAUTH_COMPLETE_KEY, Date.now().toString());
        // Remove it immediately - we just need the event to fire
        localStorage.removeItem(OAUTH_COMPLETE_KEY);
      } catch {
        // localStorage might be unavailable
      }
    };

    // Signal completion after a small delay to ensure cookies are set
    const signalTimer = setTimeout(signalCompletion, 300);

    // Close the popup after signaling
    const closeTimer = setTimeout(() => {
      window.close();
    }, 600);

    return () => {
      clearTimeout(signalTimer);
      clearTimeout(closeTimer);
    };
  }, []);

  return (
    <div className="min-h-dvh bg-[#05050a] text-white flex items-center justify-center font-sans">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-400">
          Sign in successful. Closing...
        </p>
      </div>
    </div>
  );
}

export { OAUTH_COMPLETE_KEY };
