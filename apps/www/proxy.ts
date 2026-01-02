import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.nextUrl.hostname;

  if (hostname === "0github.com" && pathname === "/") {
    return NextResponse.rewrite(new URL("/heatmap", request.url));
  }

  if (hostname === "preview.new" && pathname === "/") {
    return NextResponse.rewrite(new URL("/preview", request.url));
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

export const config = {
  matcher: [
    /*
     * Match all PR review and comparison pages:
     * - /:owner/:repo/pull/:number
     * - /:owner/:repo/compare/...
     * But exclude:
     * - /api routes
     * - /_next (Next.js internals)
     * - Static files
     */
    "/:owner/:repo/pull/:number",
    "/:owner/:repo/compare/:path*",
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
