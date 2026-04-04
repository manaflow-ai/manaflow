import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MANAFLOW_DEPRECATED } from "@/lib/deprecation";
import { env } from "@/lib/utils/www-env";

/**
 * Check if any Stack Auth cookie exists matching the base name pattern.
 * Stack Auth uses different naming conventions:
 * - Local HTTP: `stack-refresh-{projectId}` / `stack-access`
 * - Production HTTPS: `__Host-stack-refresh-{projectId}` / `__Host-stack-access`
 * - With branch: `__Host-stack-refresh-{projectId}--default` / `__Host-stack-access--default`
 */
function hasStackCookie(
  cookies: NextRequest["cookies"],
  baseName: string
): boolean {
  const allCookies = cookies.getAll();

  return allCookies.some(
    (c) =>
      (c.name === baseName ||
        c.name === `__Host-${baseName}` ||
        c.name.startsWith(`${baseName}--`) ||
        c.name.startsWith(`__Host-${baseName}--`)) &&
      c.value
  );
}

function deprecationProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.nextUrl.hostname;

  // Block ALL API routes, analytics proxies, and error tunnels
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/iiiii/") ||
    pathname.startsWith("/mtrerr")
  ) {
    return NextResponse.json(
      { error: "Manaflow is temporarily unavailable" },
      { status: 503 }
    );
  }

  // manaflow.com: show the existing landing page, don't redirect to itself
  if (hostname === "manaflow.com" || hostname === "www.manaflow.com") {
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/manaflow", request.url));
    }
    // Let the manaflow landing page and its assets render
    return NextResponse.next();
  }

  // Everything else (cmux.sh, 0github.com, preview.new, cloudrouter.dev, etc.)
  // gets a temporary redirect to manaflow.com
  return NextResponse.redirect("https://manaflow.com", 307);
}

export function proxy(request: NextRequest) {
  if (MANAFLOW_DEPRECATED) {
    return deprecationProxy(request);
  }

  const { pathname } = request.nextUrl;
  const hostname = request.nextUrl.hostname;

  if (hostname === "0github.com" && pathname === "/") {
    return NextResponse.rewrite(new URL("/heatmap", request.url));
  }

  if (hostname === "cloudrouter.dev" && pathname === "/") {
    return NextResponse.rewrite(new URL("/cloudrouter", request.url));
  }

  // Handle preview.new domain routing
  if (hostname === "preview.new") {
    // Redirect /preview/* to /* to avoid duplicate URLs
    // (e.g., preview.new/preview → preview.new/)
    if (pathname === "/preview") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url, 301);
    }
    if (pathname.startsWith("/preview/")) {
      const url = request.nextUrl.clone();
      url.pathname = pathname.replace(/^\/preview/, "");
      return NextResponse.redirect(url, 301);
    }

    // Rewrite clean URLs to actual routes
    if (pathname === "/") {
      return NextResponse.rewrite(new URL("/preview", request.url));
    }
    if (pathname === "/test") {
      return NextResponse.rewrite(new URL("/preview/test", request.url));
    }
    if (pathname === "/configure") {
      return NextResponse.rewrite(new URL("/preview/configure", request.url));
    }
  }

  if (hostname === "manaflow.com" && pathname === "/") {
    return NextResponse.rewrite(new URL("/manaflow", request.url));
  }

  // Check if this is a PR review page that requires authentication
  const isPRReviewPage =
    /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(pathname) ||
    /^\/[^/]+\/[^/]+\/compare\//.test(pathname);

  // Skip auth check for the auth page itself
  if (pathname.endsWith("/auth")) {
    return NextResponse.next();
  }

  // Skip auth check for API routes
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Only check cookies for PR review pages
  if (!isPRReviewPage) {
    return NextResponse.next();
  }

  // Check for Stack Auth cookies (handles various naming patterns for local/production/branch variants)
  const hasStackAccessCookie = hasStackCookie(request.cookies, "stack-access");
  const hasStackRefreshCookie = hasStackCookie(
    request.cookies,
    `stack-refresh-${env.NEXT_PUBLIC_STACK_PROJECT_ID}`
  );

  const hasStackAuthCookies = hasStackAccessCookie || hasStackRefreshCookie;

  // If no cookies, redirect to auth page
  if (!hasStackAuthCookies) {
    const url = request.nextUrl.clone();
    url.pathname = `${pathname}/auth`;
    return NextResponse.redirect(url);
  }

  // Cookies exist, allow the request to proceed
  return NextResponse.next();
}

// TEMPORARY DEPRECATION: matcher includes /api/* so the deprecation guard runs.
// To restore, replace with the original matcher that excludes api paths:
//   "/:owner/:repo/pull/:number",
//   "/:owner/:repo/compare/:path*",
//   "/((?!api|_next/static|_next/image|favicon.ico).*)",
export const config = {
  matcher: [
    "/api/:path*",
    "/iiiii/:path*",
    "/mtrerr",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
