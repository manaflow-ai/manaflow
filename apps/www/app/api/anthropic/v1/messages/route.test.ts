import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";

function setRequiredEnv(convexUrl: string): void {
  process.env.STACK_SECRET_SERVER_KEY ||= "test";
  process.env.STACK_SUPER_SECRET_ADMIN_KEY ||= "test";
  process.env.STACK_DATA_VAULT_SECRET ||= "x".repeat(32);
  process.env.CMUX_GITHUB_APP_ID ||= "1";
  process.env.CMUX_GITHUB_APP_PRIVATE_KEY ||= "test";
  process.env.MORPH_API_KEY ||= "test";
  process.env.ANTHROPIC_API_KEY ||= "test";
  process.env.CMUX_TASK_RUN_JWT_SECRET ||= "test";

  process.env.NEXT_PUBLIC_STACK_PROJECT_ID ||= "test";
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY ||= "test";
  process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl;
}

async function startHangingServer(): Promise<{
  server: Server;
  baseUrl: string;
  requestReceived: Promise<void>;
  upstreamClosed: Promise<void>;
}> {
  let requestReceivedResolve: (() => void) | null = null;
  const requestReceived = new Promise<void>((resolve) => {
    requestReceivedResolve = resolve;
  });

  let upstreamClosedResolve: (() => void) | null = null;
  const upstreamClosed = new Promise<void>((resolve) => {
    upstreamClosedResolve = resolve;
  });

  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/anthropic/v1/messages") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    requestReceivedResolve?.();

    // Never respond; we'll validate that the client abort closes the connection.
    res.on("close", () => {
      upstreamClosedResolve?.();
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://${address.address}:${address.port}`;
  return { server, baseUrl, requestReceived, upstreamClosed };
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("/api/anthropic/v1/messages abort behavior", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    }
  });

  test(
    "aborting the request cancels the upstream fetch",
    { timeout: 5_000 },
    async () => {
      const started = await startHangingServer();
      server = started.server;
      setRequiredEnv(started.baseUrl);

      // Import after env is set: env is validated at module import time.
      const route = await import("./route");

      const abortController = new AbortController();
      const request = new NextRequest(
        "http://localhost/api/anthropic/v1/messages",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            stream: true,
            model: "test-model",
            messages: [{ role: "user", content: "hello" }],
          }),
          signal: abortController.signal,
        }
      );

      const responsePromise = route.POST(request);

      await started.requestReceived;
      abortController.abort(new Error("test abort"));

      const response = await responsePromise;
      expect(response.status).toBe(500);

      // Ensure the upstream connection was closed promptly.
      const didClose = await Promise.race([
        started.upstreamClosed.then(() => true),
        sleep(500).then(() => false),
      ]);
      expect(didClose).toBe(true);
    }
  );
});
