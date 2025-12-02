"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type OAuthProvider = "github" | "gitlab" | "bitbucket" | "google";

type UseOAuthPopupOptions = {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
};

type UseOAuthPopupReturn = {
  signInWithPopup: (provider: OAuthProvider) => void;
  cancelSignIn: () => void;
  signingInProvider: OAuthProvider | null;
  isSigningIn: boolean;
};

const OAUTH_COMPLETE_KEY = "oauth_popup_complete";

export function useOAuthPopup(
  options?: UseOAuthPopupOptions
): UseOAuthPopupReturn {
  const [signingInProvider, setSigningInProvider] =
    useState<OAuthProvider | null>(null);

  // Use ref to track popup window across renders
  const popupRef = useRef<Window | null>(null);
  // Track if we're in the process of completing (to avoid double-handling)
  const isCompletingRef = useRef(false);

  // Memoize callbacks in refs to avoid stale closures
  const onSuccessRef = useRef(options?.onSuccess);
  const onErrorRef = useRef(options?.onError);
  useEffect(() => {
    onSuccessRef.current = options?.onSuccess;
    onErrorRef.current = options?.onError;
  }, [options?.onSuccess, options?.onError]);

  // Cleanup function
  const cleanup = useCallback(() => {
    popupRef.current = null;
    isCompletingRef.current = false;
  }, []);

  // Handle successful completion (from postMessage or storage event)
  const handleComplete = useCallback(() => {
    if (isCompletingRef.current) return; // Prevent double-handling
    isCompletingRef.current = true;
    cleanup();
    // Don't clear signingInProvider - let the page reload handle it
    if (onSuccessRef.current) {
      onSuccessRef.current();
    } else {
      window.location.reload();
    }
  }, [cleanup]);

  // Cancel sign-in (called by user or when detecting popup close)
  const cancelSignIn = useCallback(() => {
    // Try to close popup if still open
    if (popupRef.current) {
      try {
        popupRef.current.close();
      } catch {
        // Ignore errors closing popup
      }
    }
    cleanup();
    setSigningInProvider(null);
  }, [cleanup]);

  // Check if popup was closed (called on focus/visibility events)
  const checkPopupClosed = useCallback(() => {
    const popup = popupRef.current;
    if (!popup || isCompletingRef.current) return;

    // Delay check to avoid false positives during cross-origin navigation
    setTimeout(() => {
      if (!popupRef.current || isCompletingRef.current) return;

      try {
        if (popupRef.current.closed) {
          cancelSignIn();
        }
      } catch {
        // Error accessing popup - could be cross-origin, don't cancel
      }
    }, 500);
  }, [cancelSignIn]);

  // Listen for completion signals from the popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === OAUTH_COMPLETE_KEY && event.data?.success) {
        handleComplete();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === OAUTH_COMPLETE_KEY) {
        handleComplete();
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("storage", handleStorage);
    };
  }, [handleComplete]);

  // Listen for focus/visibility to detect popup close
  useEffect(() => {
    if (!signingInProvider) return;

    const handleFocus = () => {
      checkPopupClosed();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkPopupClosed();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [signingInProvider, checkPopupClosed]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const signInWithPopup = useCallback(
    (provider: OAuthProvider) => {
      // Cleanup any existing popup
      if (popupRef.current) {
        try {
          popupRef.current.close();
        } catch {
          // Ignore
        }
      }
      cleanup();

      setSigningInProvider(provider);

      // Calculate centered position
      const width = 600;
      const height = 700;
      const screenLeft = window.screenLeft ?? window.screenX ?? 0;
      const screenTop = window.screenTop ?? window.screenY ?? 0;
      const screenWidth = window.outerWidth || window.innerWidth || width;
      const screenHeight = window.outerHeight || window.innerHeight || height;
      const left = Math.floor(screenLeft + (screenWidth - width) / 2);
      const top = Math.floor(screenTop + (screenHeight - height) / 2);

      const features = [
        `width=${width}`,
        `height=${height}`,
        `left=${left}`,
        `top=${top}`,
        "resizable=yes",
        "scrollbars=yes",
      ].join(",");

      // Build the OAuth URL with callback as return destination
      // Use relative path - the after-sign-in handler only accepts relative paths for security
      const returnTo = encodeURIComponent("/sign-in/oauth/callback");
      const oauthUrl = `/sign-in/oauth/${provider}?after_auth_return_to=${returnTo}`;

      // Open popup directly to the OAuth URL
      const popup = window.open(oauthUrl, `oauth-${provider}`, features);

      if (!popup) {
        // Popup was blocked - fall back to redirect
        console.warn("[useOAuthPopup] Popup blocked, falling back to redirect");
        window.location.href = oauthUrl;
        return;
      }

      popupRef.current = popup;
      popup.focus();
    },
    [cleanup]
  );

  return {
    signInWithPopup,
    cancelSignIn,
    signingInProvider,
    isSigningIn: signingInProvider !== null,
  };
}
