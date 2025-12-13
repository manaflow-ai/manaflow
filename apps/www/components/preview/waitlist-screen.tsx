"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

type WaitlistScreenProps = {
  provider: "gitlab" | "bitbucket";
  userEmail?: string | null;
};

export function WaitlistScreen({ provider, userEmail }: WaitlistScreenProps) {
  const providerName = provider === "gitlab" ? "GitLab" : "Bitbucket";
  const providerColor = provider === "gitlab" ? "#fc6d26" : "#0052cc";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <div className="max-w-md space-y-6">
        {/* Icon */}
        <div
          className="mx-auto w-16 h-16 rounded-full flex items-center justify-center"
          style={{ backgroundColor: `${providerColor}20` }}
        >
          {provider === "gitlab" ? (
            <svg
              className="w-8 h-8"
              viewBox="0 0 24 24"
              fill={providerColor}
            >
              <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
            </svg>
          ) : (
            <svg
              className="w-8 h-8"
              viewBox="0 0 24 24"
              fill={providerColor}
            >
              <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
            </svg>
          )}
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-semibold text-white">
          You&apos;re on the waitlist!
        </h1>

        {/* Description */}
        <div className="space-y-3 text-neutral-400">
          <p>
            Thanks for your interest in using Preview with {providerName}!
          </p>
          <p>
            {providerName} integration is currently in beta and we&apos;re
            gradually rolling it out to users. We&apos;ve added you to our
            waitlist.
          </p>
          {userEmail && (
            <p>
              We&apos;ll send an email to{" "}
              <span className="text-white font-medium">{userEmail}</span> as
              soon as {providerName} support is ready for you.
            </p>
          )}
          {!userEmail && (
            <p>
              We&apos;ll email you as soon as {providerName} support is ready.
            </p>
          )}
        </div>

        {/* CTA */}
        <div className="pt-4 space-y-3">
          <p className="text-sm text-neutral-500">
            In the meantime, you can use Preview with GitHub repositories.
          </p>
          <Button
            asChild
            variant="outline"
            className="border-neutral-700 bg-transparent text-white hover:bg-neutral-800"
          >
            <Link href="/preview">Back to Preview</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
