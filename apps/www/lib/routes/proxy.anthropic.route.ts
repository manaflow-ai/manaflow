import { OpenAPIHono } from "@hono/zod-openapi";
import { env } from "@/lib/utils/www-env";
import { jwtVerify } from "jose";

export const proxyAnthropicRouter = new OpenAPIHono();

/**
 * Verify conversation JWT from sandbox proxy.
 * Returns the payload if valid, null if invalid.
 */
async function verifyConversationJwt(token: string): Promise<{
  conversationId: string;
  teamId: string;
} | null> {
  try {
    const secret = new TextEncoder().encode(env.CMUX_TASK_RUN_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    if (
      typeof payload.conversationId === "string" &&
      typeof payload.teamId === "string"
    ) {
      return {
        conversationId: payload.conversationId,
        teamId: payload.teamId,
      };
    }
    return null;
  } catch (e) {
    console.error("[proxy.anthropic] JWT verification failed:", e);
    return null;
  }
}

/**
 * Proxy all requests to Anthropic API.
 *
 * Architecture:
 *   Claude Code → Sandbox Proxy (injects JWT) → This Proxy (verifies JWT, injects API key) → Anthropic
 *
 * The sandbox proxy at ANTHROPIC_BASE_URL adds the conversation JWT.
 * This proxy verifies it and adds the real Anthropic API key.
 */
proxyAnthropicRouter.all("/proxy/anthropic/*", async (c) => {
  // Verify conversation JWT from Authorization header
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer "
  const jwtPayload = await verifyConversationJwt(token);

  if (!jwtPayload) {
    return c.json({ error: "Invalid conversation token" }, 401);
  }

  console.log(
    `[proxy.anthropic] Authenticated request for conversation ${jwtPayload.conversationId}`,
  );

  const path = c.req.path.replace("/proxy/anthropic", "");
  const queryString = c.req.raw.url.includes("?")
    ? "?" + c.req.raw.url.split("?")[1]
    : "";
  const upstreamUrl = `https://api.anthropic.com${path}${queryString}`;

  console.log(`[proxy.anthropic] ${c.req.method} ${path}`);

  // Build upstream request headers
  const headers = new Headers();
  for (const [key, value] of c.req.raw.headers.entries()) {
    const lowerKey = key.toLowerCase();
    // Skip hop-by-hop headers and auth (we add our own)
    if (
      [
        "host",
        "content-length",
        "transfer-encoding",
        "connection",
        "x-api-key",
        "authorization",
      ].includes(lowerKey)
    ) {
      continue;
    }
    headers.set(key, value);
  }

  // Add the real API key
  headers.set("x-api-key", env.ANTHROPIC_API_KEY);

  // Forward the request
  const response = await fetch(upstreamUrl, {
    method: c.req.method,
    headers,
    body:
      c.req.method !== "GET" && c.req.method !== "HEAD"
        ? await c.req.raw.arrayBuffer()
        : undefined,
  });

  // Build response headers, filtering hop-by-hop
  const responseHeaders = new Headers();
  for (const [key, value] of response.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (["transfer-encoding", "connection"].includes(lowerKey)) {
      continue;
    }
    responseHeaders.set(key, value);
  }

  // Return the proxied response (streaming supported)
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
});
