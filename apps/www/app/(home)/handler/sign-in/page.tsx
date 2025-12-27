import { redirect } from "next/navigation";

import { stackServerApp } from "@/lib/utils/stack";
import { StackHandler } from "@stackframe/stack";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  params?: Promise<Record<string, string | string[] | undefined>>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

/**
 * Custom sign-in handler that preserves the after_auth_return_to query param
 * when the user is already authenticated.
 *
 * This is necessary because Stack Auth's default StackHandler redirects
 * already-authenticated users to the afterSignIn URL without preserving
 * query parameters. This breaks the Electron deep link flow.
 */
export default async function SignInPage({ searchParams: searchParamsPromise }: SignInPageProps) {
  const user = await stackServerApp.getUser();
  const searchParams = await searchParamsPromise;
  const afterAuthReturnTo = getSingleValue(searchParams?.after_auth_return_to);

  // If user is already authenticated, redirect to after-sign-in with the return URL
  if (user) {
    console.log("[SignInPage] User already authenticated, redirecting to after-sign-in", {
      afterAuthReturnTo,
    });

    if (afterAuthReturnTo) {
      redirect(`/handler/after-sign-in?after_auth_return_to=${encodeURIComponent(afterAuthReturnTo)}`);
    } else {
      redirect("/handler/after-sign-in");
    }
  }

  // User is not authenticated, render the default Stack Auth sign-in handler
  // Pass the route as "sign-in" for StackHandler to process
  const routeProps = {
    params: Promise.resolve({ stack: ["sign-in"] }),
    searchParams: searchParamsPromise,
  };

  return <StackHandler fullPage app={stackServerApp} routeProps={routeProps} />;
}
