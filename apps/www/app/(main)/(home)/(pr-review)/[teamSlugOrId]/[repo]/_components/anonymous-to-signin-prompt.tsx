"use client";

import { useEffect } from "react";
import { useStackApp } from "@stackframe/stack";
import { LogIn } from "lucide-react";

interface AnonymousToSignInPromptProps {
  returnUrl: string;
}

/**
 * Prompt shown to anonymous users trying to access a private repository.
 * Redirects them to sign in with a real account.
 */
export function AnonymousToSignInPrompt({
  returnUrl,
}: AnonymousToSignInPromptProps) {
  const app = useStackApp();

  useEffect(() => {
    // Automatically redirect to sign-in after a brief moment
    const timer = setTimeout(() => {
      const returnTo = encodeURIComponent(returnUrl);
      const signInUrl = `${app.urls.signIn}?after_auth_return_to=${returnTo}`;
      window.location.href = signInUrl;
    }, 1500);

    return () => clearTimeout(timer);
  }, [app.urls.signIn, returnUrl]);

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
                <LogIn className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                Sign In Required
              </h1>
              <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
                This is a private repository. Please sign in with your account to
                continue.
              </p>

              <div className="mt-6">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 dark:border-blue-400 border-t-transparent" />
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    Redirecting to sign in...
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
