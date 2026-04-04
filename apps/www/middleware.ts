import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MANAFLOW_DEPRECATED } from "@/lib/deprecation";
import { proxy, config as proxyConfig } from "./proxy";

function deprecationMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.nextUrl.hostname;

  // Block ALL API routes, analytics proxies, and error tunnels
  if (
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

export function middleware(request: NextRequest) {
  if (MANAFLOW_DEPRECATED) {
    return deprecationMiddleware(request);
  }
  return proxy(request);
}

export { proxyConfig as config };
